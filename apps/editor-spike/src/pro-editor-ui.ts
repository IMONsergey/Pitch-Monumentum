type AnyRecord = Record<string, any>;

type PitchEditorRuntime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  getSelectedIds(): string[];
  select(ids: string[]): void;
  command(input: AnyRecord): Promise<AnyRecord>;
  reload(): Promise<void>;
};

const style = `
  .pitch-pro-toolbar{display:flex;align-items:center;gap:5px;min-width:0;overflow-x:auto;scrollbar-width:none;padding:0 6px}
  .pitch-pro-toolbar::-webkit-scrollbar{display:none}
  .pitch-tool-group{display:flex;align-items:center;gap:3px;padding-right:6px;margin-right:3px;border-right:1px solid var(--line)}
  .pitch-tool{height:30px;border:1px solid var(--line);background:#151a20;color:var(--text);border-radius:7px;padding:0 8px;cursor:pointer;white-space:nowrap;font-size:11px}
  .pitch-tool:hover{border-color:#495364;background:#1c222a}.pitch-tool:active{transform:translateY(1px)}
  .pitch-side-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:9px}
  .pitch-side-tab{border:1px solid var(--line);border-radius:7px;padding:6px;background:#0d1014;color:var(--muted);cursor:pointer;font-size:11px}
  .pitch-side-tab.active{color:var(--text);border-color:#485263;background:#191e25}
  #pitchLayers{display:none}.pitch-layer{display:flex;align-items:center;gap:7px;min-height:30px;padding:4px 5px;border-radius:6px;cursor:pointer;color:var(--text);user-select:none}
  .pitch-layer:hover{background:#181d24}.pitch-layer.selected{background:#222a34}.pitch-layer.locked{color:#7d8796}
  .pitch-layer-type{width:16px;text-align:center;color:#8792a3;font-size:10px}.pitch-layer-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
  .pitch-layer-lock{border:0;background:transparent;color:#7d8796;padding:2px 4px;cursor:pointer;font-size:11px}.pitch-layer-lock:hover{color:var(--text)}
  .pitch-shortcuts{padding:8px 5px;color:#6f7988;font-size:9px;line-height:1.55;border-top:1px solid var(--line);margin-top:8px}
  .spike-el.locked{pointer-events:none}.spike-el.locked::after{content:"";position:absolute;inset:0;border:1px dashed rgba(80,90,105,.35);pointer-events:none}
`;

let clipboard: AnyRecord | null = null;
let activeSideTab: "slides" | "layers" = "slides";

function runtime(): PitchEditorRuntime {
  const value = (window as any).__pitchEditorRuntime as PitchEditorRuntime | undefined;
  if (!value) throw new Error("Pitch editor runtime is not available");
  return value;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char);
}

function iconFor(type: string): string {
  if (type === "text") return "T";
  if (type === "image") return "▧";
  if (type === "frame") return "F";
  if (type === "group") return "G";
  if (type === "chart") return "▥";
  if (type === "table") return "#";
  if (type === "line") return "／";
  return "◆";
}

function layerTree(slide: AnyRecord): AnyRecord[] {
  const index = new Map<string, AnyRecord>((slide?.scene ?? []).map((element: AnyRecord) => [element.id, element]));
  const parents = new Map<string, string>();
  for (const element of slide?.scene ?? []) {
    if (element.type !== "frame" && element.type !== "group") continue;
    for (const childId of element.childIds ?? []) parents.set(childId, element.id);
  }
  const build = (element: AnyRecord, depth: number): AnyRecord => ({
    element,
    depth,
    children: element.type === "frame" || element.type === "group"
      ? (element.childIds ?? []).map((id: string) => index.get(id)).filter(Boolean).map((child: AnyRecord) => build(child, depth + 1))
      : [],
  });
  return (slide?.scene ?? [])
    .filter((element: AnyRecord) => !parents.has(element.id))
    .sort((a: AnyRecord, b: AnyRecord) => b.zIndex - a.zIndex || a.id.localeCompare(b.id))
    .map((element: AnyRecord) => build(element, 0));
}

function flattenTree(nodes: AnyRecord[]): AnyRecord[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}

function setSideTab(tab: "slides" | "layers"): void {
  activeSideTab = tab;
  const slides = document.querySelector<HTMLElement>("#spikeSlides");
  const layers = document.querySelector<HTMLElement>("#pitchLayers");
  if (slides) slides.style.display = tab === "slides" ? "block" : "none";
  if (layers) layers.style.display = tab === "layers" ? "block" : "none";
  document.querySelectorAll<HTMLElement>(".pitch-side-tab").forEach((button) => button.classList.toggle("active", button.dataset.sideTab === tab));
  renderLayers();
}

function renderLayers(): void {
  const container = document.querySelector<HTMLElement>("#pitchLayers");
  if (!container) return;
  const editor = runtime();
  const slide = editor.getSlide();
  if (!slide) { container.innerHTML = ""; return; }
  const selected = new Set(editor.getSelectedIds());
  const rows = flattenTree(layerTree(slide));
  container.innerHTML = rows.map(({ element, depth }) => `
    <div class="pitch-layer${selected.has(element.id) ? " selected" : ""}${element.locked ? " locked" : ""}" data-layer-id="${escapeHtml(element.id)}" style="padding-left:${5 + depth * 15}px">
      <span class="pitch-layer-type">${escapeHtml(iconFor(element.type))}</span>
      <span class="pitch-layer-name" title="${escapeHtml(element.id)}">${escapeHtml(element.name || element.id)}</span>
      <button class="pitch-layer-lock" data-lock-id="${escapeHtml(element.id)}" title="${element.locked ? "Unlock" : "Lock"}">${element.locked ? "●" : "○"}</button>
    </div>`).join("") + `
    <div class="pitch-shortcuts">↑↓←→ nudge · Shift ×10<br>⌘/Ctrl+D duplicate · Delete remove<br>⌘/Ctrl+G group · Shift+⌘/Ctrl+G ungroup<br>⌘/Ctrl+C / V Pitch clipboard · [ ] arrange</div>`;

  container.querySelectorAll<HTMLElement>("[data-layer-id]").forEach((row) => row.addEventListener("click", (event) => {
    if ((event.target as Element).closest("[data-lock-id]")) return;
    const id = row.dataset.layerId!;
    const current = editor.getSelectedIds();
    editor.select((event as MouseEvent).shiftKey
      ? current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
      : [id]);
  }));
  container.querySelectorAll<HTMLButtonElement>("[data-lock-id]").forEach((button) => button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const id = button.dataset.lockId!;
    const element = slide.scene.find((item: AnyRecord) => item.id === id);
    await editor.command({ command: "lock", selectedIds: [id], locked: !element?.locked });
  }));
}

async function command(input: AnyRecord): Promise<AnyRecord> {
  return runtime().command(input);
}

function selectionRequired(): string[] {
  return runtime().getSelectedIds();
}

function insertGeometry(kind: "text" | "shape" | "frame"): AnyRecord {
  if (kind === "text") return { x: 600, y: 440, width: 720, height: 120 };
  if (kind === "frame") return { x: 600, y: 300, width: 720, height: 480 };
  return { x: 760, y: 390, width: 400, height: 260 };
}

function installToolbar(): void {
  const top = document.querySelector<HTMLElement>(".spike-top");
  const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (!top || !spacer) return;
  const toolbar = document.createElement("div");
  toolbar.className = "pitch-pro-toolbar";
  toolbar.innerHTML = `
    <div class="pitch-tool-group">
      <button class="pitch-tool" data-pitch-action="insertText">+ Text</button>
      <button class="pitch-tool" data-pitch-action="insertShape">+ Shape</button>
      <button class="pitch-tool" data-pitch-action="insertFrame">+ Frame</button>
    </div>
    <div class="pitch-tool-group">
      <button class="pitch-tool" data-pitch-action="group">Group</button>
      <button class="pitch-tool" data-pitch-action="ungroup">Ungroup</button>
    </div>
    <div class="pitch-tool-group">
      <button class="pitch-tool" data-align="left">L</button>
      <button class="pitch-tool" data-align="horizontalCenter">HC</button>
      <button class="pitch-tool" data-align="right">R</button>
      <button class="pitch-tool" data-align="top">T</button>
      <button class="pitch-tool" data-align="verticalCenter">VC</button>
      <button class="pitch-tool" data-align="bottom">B</button>
      <button class="pitch-tool" data-distribute="horizontal">↔</button>
      <button class="pitch-tool" data-distribute="vertical">↕</button>
    </div>
    <div class="pitch-tool-group">
      <button class="pitch-tool" data-arrange="sendToBack">Back</button>
      <button class="pitch-tool" data-arrange="sendBackward">−1</button>
      <button class="pitch-tool" data-arrange="bringForward">+1</button>
      <button class="pitch-tool" data-arrange="bringToFront">Front</button>
    </div>`;
  top.insertBefore(toolbar, spacer);

  toolbar.querySelectorAll<HTMLButtonElement>("[data-pitch-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.pitchAction!;
    const selectedIds = selectionRequired();
    if (action === "insertText") await command({ command: "insertText", geometry: insertGeometry("text"), text: "Text" });
    else if (action === "insertShape") await command({ command: "insertShape", geometry: insertGeometry("shape"), shape: "rect", fill: "#E9EDF2" });
    else if (action === "insertFrame") await command({ command: "insertFrame", geometry: insertGeometry("frame") });
    else if (action === "group" && selectedIds.length >= 2) await command({ command: "group", selectedIds });
    else if (action === "ungroup" && selectedIds.length) await command({ command: "ungroup", selectedIds });
  }));
  toolbar.querySelectorAll<HTMLButtonElement>("[data-align]").forEach((button) => button.addEventListener("click", () => void command({ command: "align", selectedIds: selectionRequired(), alignment: button.dataset.align })));
  toolbar.querySelectorAll<HTMLButtonElement>("[data-distribute]").forEach((button) => button.addEventListener("click", () => void command({ command: "distribute", selectedIds: selectionRequired(), axis: button.dataset.distribute })));
  toolbar.querySelectorAll<HTMLButtonElement>("[data-arrange]").forEach((button) => button.addEventListener("click", () => void command({ command: "arrange", selectedIds: selectionRequired(), arrangement: button.dataset.arrange })));
}

function installLayers(): void {
  const left = document.querySelector<HTMLElement>(".spike-left");
  const slides = document.querySelector<HTMLElement>("#spikeSlides");
  if (!left || !slides) return;
  const tabs = document.createElement("div");
  tabs.className = "pitch-side-tabs";
  tabs.innerHTML = `<button class="pitch-side-tab active" data-side-tab="slides">Slides</button><button class="pitch-side-tab" data-side-tab="layers">Layers</button>`;
  left.insertBefore(tabs, slides);
  const layers = document.createElement("div");
  layers.id = "pitchLayers";
  slides.insertAdjacentElement("afterend", layers);
  tabs.querySelectorAll<HTMLButtonElement>("[data-side-tab]").forEach((button) => button.addEventListener("click", () => setSideTab(button.dataset.sideTab as "slides" | "layers")));
}

function isTextEditing(): boolean {
  return Boolean(document.querySelector("[data-pitch-text-editing=true]"));
}

function installKeyboard(): void {
  window.addEventListener("keydown", async (event) => {
    if (isTextEditing()) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches("input,textarea,select,[contenteditable=true]")) return;
    const selectedIds = selectionRequired();
    const modifier = event.metaKey || event.ctrlKey;
    const step = event.shiftKey ? 10 : 1;

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && selectedIds.length) {
      event.preventDefault();
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      await command({ command: "nudge", selectedIds, dx, dy });
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
      event.preventDefault(); await command({ command: "delete", selectedIds }); return;
    }
    if (modifier && event.key.toLowerCase() === "d" && selectedIds.length) {
      event.preventDefault(); await command({ command: "duplicate", selectedIds }); return;
    }
    if (modifier && event.key.toLowerCase() === "g" && selectedIds.length) {
      event.preventDefault();
      await command({ command: event.shiftKey ? "ungroup" : "group", selectedIds });
      return;
    }
    if (modifier && event.key.toLowerCase() === "c" && selectedIds.length) {
      event.preventDefault();
      const result = await command({ command: "copy", selectedIds });
      clipboard = result.clipboard ?? null;
      return;
    }
    if (modifier && event.key.toLowerCase() === "v" && clipboard) {
      event.preventDefault(); await command({ command: "paste", clipboard, offsetDU: 32 }); return;
    }
    if (event.key === "[" && selectedIds.length) {
      event.preventDefault(); await command({ command: "arrange", selectedIds, arrangement: modifier ? "sendToBack" : "sendBackward" }); return;
    }
    if (event.key === "]" && selectedIds.length) {
      event.preventDefault(); await command({ command: "arrange", selectedIds, arrangement: modifier ? "bringToFront" : "bringForward" });
    }
  }, true);
}

export function installPitchProEditorUI(): void {
  const styleNode = document.createElement("style");
  styleNode.textContent = style;
  document.head.appendChild(styleNode);
  installToolbar();
  installLayers();
  installKeyboard();
  window.addEventListener("pitch:editor-state", () => {
    if (activeSideTab === "layers") renderLayers();
  });
  renderLayers();
}
