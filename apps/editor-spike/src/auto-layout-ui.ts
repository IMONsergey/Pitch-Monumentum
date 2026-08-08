type AnyRecord = Record<string, any>;

const layoutDebug: AnyRecord = { invocations: 0, lastSelection: [], lastCreatedFrameId: null, lastError: null, lastAction: null };
(window as any).__pitchAutoLayoutDebug = layoutDebug;

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector(selector) as T | null;

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function selectedIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#spikeScene .spike-el.selected[data-id]"))
    .map((element) => element.dataset.id)
    .filter((id): id is string => Boolean(id));
}

async function project(): Promise<any> {
  return api("/api/project");
}

function findElement(state: any, elementId: string): { slide: AnyRecord; element: AnyRecord } | null {
  for (const slide of state.deck.slides as AnyRecord[]) {
    const element = slide.scene.find((item: AnyRecord) => item.id === elementId);
    if (element) return { slide, element };
  }
  return null;
}

function status(text: string): void {
  const node = document.getElementById("spikeStatus");
  if (node) node.textContent = text;
}

function installStyles(): void {
  if (document.getElementById("pitch-layout-style")) return;
  const style = document.createElement("style");
  style.id = "pitch-layout-style";
  style.textContent = `
    .pitch-layout-button{border:1px solid #313845;background:#171b21;color:#f3f5f7;padding:7px 10px;border-radius:8px;cursor:pointer}.pitch-layout-button:hover{border-color:#667085}
    .pitch-layout-panel{position:fixed;right:18px;top:70px;z-index:10020;width:270px;background:#111419f5;border:1px solid #313845;border-radius:12px;box-shadow:0 20px 60px #0009;color:#f3f5f7;padding:12px;display:none;backdrop-filter:blur(16px)}.pitch-layout-panel.visible{display:block}
    .pitch-layout-panel h3{font:700 12px Inter,system-ui;margin:0 0 10px}.pitch-layout-panel label{display:block;color:#8c96a5;font:10px Inter,system-ui;text-transform:uppercase;letter-spacing:.06em;margin:9px 0 4px}.pitch-layout-panel input,.pitch-layout-panel select{width:100%;height:32px;background:#1a1f27;color:#f3f5f7;border:1px solid #313845;border-radius:7px;padding:0 8px;font:12px Inter,system-ui}.pitch-layout-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.pitch-layout-actions{display:flex;gap:7px;margin-top:12px}.pitch-layout-actions button{flex:1;height:32px;border-radius:7px;border:1px solid #313845;background:#1a1f27;color:#f3f5f7;cursor:pointer}.pitch-layout-actions .apply{background:#c7ff5e;color:#090b0e;border-color:#c7ff5e;font-weight:700}
  `;
  document.head.appendChild(style);
}

function installPanel(): HTMLElement {
  const existing = document.getElementById("pitchLayoutPanel");
  if (existing) return existing;
  const panel = document.createElement("div");
  panel.id = "pitchLayoutPanel";
  panel.className = "pitch-layout-panel";
  panel.innerHTML = `
    <h3>Auto Layout</h3>
    <div class="pitch-layout-grid">
      <div><label>Direction</label><select data-layout=direction><option value=horizontal>Horizontal</option><option value=vertical>Vertical</option></select></div>
      <div><label>Gap · DU</label><input data-layout=gap type=number min=0 step=1 value=24></div>
    </div>
    <label>Padding · DU</label><div class="pitch-layout-grid"><input data-layout=paddingV type=number min=0 step=1 value=24 title="Vertical"><input data-layout=paddingH type=number min=0 step=1 value=24 title="Horizontal"></div>
    <div class="pitch-layout-grid">
      <div><label>Justify</label><select data-layout=justify><option value=start>Start</option><option value=center>Center</option><option value=end>End</option><option value=spaceBetween>Space between</option><option value=spaceAround>Space around</option><option value=spaceEvenly>Space evenly</option></select></div>
      <div><label>Align</label><select data-layout=align><option value=start>Start</option><option value=center>Center</option><option value=end>End</option><option value=stretch>Stretch</option></select></div>
    </div>
    <div class="pitch-layout-actions"><button data-layout-action=close>Close</button><button data-layout-action=apply class=apply>Apply</button></div>
  `;
  document.body.appendChild(panel);
  panel.querySelector("[data-layout-action=close]")?.addEventListener("click", () => panel.classList.remove("visible"));
  panel.querySelector("[data-layout-action=apply]")?.addEventListener("click", () => void applyPanel());
  return panel;
}

function layoutFromPanel(panel: HTMLElement, current?: AnyRecord): AnyRecord {
  const number = (name: string, fallback: number) => Number((panel.querySelector(`[data-layout=${name}]`) as HTMLInputElement | null)?.value ?? fallback);
  const value = (name: string, fallback: string) => (panel.querySelector(`[data-layout=${name}]`) as HTMLSelectElement | null)?.value ?? fallback;
  const vertical = number("paddingV", current?.padding?.top ?? 24);
  const horizontal = number("paddingH", current?.padding?.left ?? 24);
  return {
    direction: value("direction", current?.direction ?? "horizontal"),
    gapDU: number("gap", current?.gapDU ?? 24),
    padding: { top: vertical, right: horizontal, bottom: vertical, left: horizontal },
    justify: value("justify", current?.justify ?? "start"),
    align: value("align", current?.align ?? "start"),
    wrap: current?.wrap ?? false,
    widthSizing: current?.widthSizing ?? "fixed",
    heightSizing: current?.heightSizing ?? "fixed",
  };
}

function fillPanel(panel: HTMLElement, layout: AnyRecord): void {
  const set = (name: string, value: unknown) => {
    const control = panel.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-layout=${name}]`);
    if (control) control.value = String(value);
  };
  set("direction", layout.direction ?? "horizontal");
  set("gap", layout.gapDU ?? 24);
  set("paddingV", layout.padding?.top ?? 24);
  set("paddingH", layout.padding?.left ?? 24);
  set("justify", layout.justify ?? "start");
  set("align", layout.align ?? "start");
}

async function openOrWrap(): Promise<void> {
  if (document.querySelector("[data-pitch-text-editing=true]")) return;
  layoutDebug.invocations += 1;
  layoutDebug.lastError = null;
  const ids = selectedIds();
  layoutDebug.lastSelection = [...ids];
  try {
    if (!ids.length) return status("Select a frame or at least two objects for Auto Layout");
    const current = await project();

    if (ids.length === 1) {
      const found = findElement(current, ids[0]);
      if (found && (found.element.type === "frame" || found.element.type === "group") && found.element.layout) {
        const panel = installPanel();
        panel.dataset.slideId = found.slide.id;
        panel.dataset.elementId = found.element.id;
        panel.dataset.deckHash = current.deckHash;
        fillPanel(panel, found.element.layout);
        panel.classList.add("visible");
        layoutDebug.lastAction = "open-panel";
        return;
      }
      return status("Select two or more objects to create Auto Layout");
    }

    let slide: AnyRecord | null = null;
    for (const candidate of current.deck.slides as AnyRecord[]) {
      if (ids.every((id) => candidate.scene.some((element: AnyRecord) => element.id === id))) { slide = candidate; break; }
    }
    if (!slide) throw new Error("Selected objects must belong to one slide");
    status(`Wrapping ${ids.length} objects in Auto Layout…`);
    layoutDebug.lastAction = "wrap-request";
    const result = await api("/api/wrap-auto-layout", {
      method: "POST",
      body: JSON.stringify({ slideId: slide.id, selectedIds: ids, direction: "horizontal", gapDU: 24, paddingDU: 24, expectedDeckHash: current.deckHash }),
    });
    layoutDebug.lastCreatedFrameId = result.createdFrameId;
    layoutDebug.lastAction = "wrap-success";
    (document.getElementById("spikeRefresh") as HTMLButtonElement | null)?.click();
    const frameId = result.createdFrameId;
    setTimeout(() => {
      const frame = document.querySelector<HTMLElement>(`#spikeScene [data-id="${CSS.escape(frameId)}"]`);
      frame?.click();
      status(`Auto Layout frame created · ${frameId}`);
    }, 500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    layoutDebug.lastError = message;
    layoutDebug.lastAction = "error";
    status(`Auto Layout failed: ${message}`);
  }
}

async function applyPanel(): Promise<void> {
  const panel = installPanel();
  const slideId = panel.dataset.slideId;
  const elementId = panel.dataset.elementId;
  if (!slideId || !elementId) return;
  try {
    const current = await project();
    const found = findElement(current, elementId);
    if (!found) throw new Error(`Auto-layout frame disappeared: ${elementId}`);
    const layout = layoutFromPanel(panel, found.element.layout);
    status("Recalculating Auto Layout…");
    layoutDebug.lastAction = "apply-request";
    await api("/api/auto-layout", {
      method: "POST",
      body: JSON.stringify({ slideId, elementId, layout, expectedDeckHash: current.deckHash }),
    });
    layoutDebug.lastAction = "apply-success";
    panel.classList.remove("visible");
    (document.getElementById("spikeRefresh") as HTMLButtonElement | null)?.click();
    setTimeout(() => status("Auto Layout committed through one deck mutation"), 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    layoutDebug.lastError = message;
    layoutDebug.lastAction = "error";
    status(`Auto Layout failed: ${message}`);
  }
}

export function installPitchAutoLayoutUI(): void {
  installStyles();
  installPanel();
  const header = document.querySelector(".spike-top");
  if (header && !document.getElementById("pitchAutoLayoutButton")) {
    const button = document.createElement("button");
    button.id = "pitchAutoLayoutButton";
    button.className = "pitch-layout-button";
    button.textContent = "Auto Layout  ⇧A";
    button.title = "Wrap selection in Auto Layout or edit selected frame";
    const spacer = header.querySelector(".spacer");
    header.insertBefore(button, spacer ?? null);
    button.addEventListener("click", () => void openOrWrap());
  }
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "a" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !document.querySelector("[data-pitch-text-editing=true]")) {
      event.preventDefault();
      event.stopPropagation();
      void openOrWrap();
    }
  }, true);
}
