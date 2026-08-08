type AnyRecord = Record<string, any>;
type Runtime = { getProject(): AnyRecord | null; getSelectedIds(): string[]; reload(): Promise<void> };

const css = `
  .pitch-media-section select{width:100%;height:29px;border:1px solid var(--line);border-radius:6px;background:#101419;color:var(--text);padding:0 7px;font-size:11px}
  .pitch-media-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.pitch-media-actions{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.pitch-media-action{flex:1;min-width:90px;height:29px;border:1px solid #4c5b3b;border-radius:6px;background:#171e14;color:#d9f5a2;font-size:10px;cursor:pointer}.pitch-media-action.secondary{border-color:var(--line);background:#151a20;color:#aab2bd}.pitch-media-action.crop{border-color:#59743b;background:#1c2914;color:#e0ffa6}
`;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function status(message: string): void { const node = document.getElementById("spikeStatus"); if (node) node.textContent = message; }
function esc(value: unknown): string { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char); }

function selectedImage(): AnyRecord | null {
  const editor = runtime(); const project = editor?.getProject(); const selected = editor?.getSelectedIds() ?? [];
  if (!project || selected.length !== 1) return null;
  for (const slide of project.deck.slides as AnyRecord[]) {
    const element = slide.scene.find((item: AnyRecord) => item.id === selected[0]);
    if (element?.type === "image") return { slide, element };
  }
  return null;
}

async function run(payload: AnyRecord): Promise<void> {
  const editor = runtime(); const project = editor?.getProject(); if (!editor || !project) return;
  try {
    const response = await fetch("/api/media-command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, expectedDeckHash: project.deckHash }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || response.statusText);
    await editor.reload(); status(`Media · ${data.commandReason ?? payload.command}`);
  } catch (error) { status(`Media failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function number(root: HTMLElement, key: string): number {
  const value = Number((root.querySelector(`[data-media=${key}]`) as HTMLInputElement).value);
  if (!Number.isFinite(value)) throw new Error(`${key} must be numeric`);
  return value;
}

function render(): void {
  const panel = document.querySelector<HTMLElement>(".spike-right.pitch-inspector");
  if (!panel || panel.querySelector(".pitch-media-section")) return;
  const found = selectedImage(); if (!found) return;
  const { slide, element } = found;
  const crop = element.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const focal = element.focalPoint ?? { x: .5, y: .5 };
  const clip = element.clipShape ?? ((element.cornerRadiusDU ?? 0) > 0 ? "roundRect" : "rect");
  const section = document.createElement("div"); section.className = "pitch-section pitch-media-section";
  section.innerHTML = `<h4>Image · media</h4>
    <div class="pitch-field"><label>Asset ID</label><input data-media=asset value="${esc(element.assetId)}"></div>
    <div class="pitch-field" style="margin-top:7px"><label>Alt text</label><input data-media=alt value="${esc(element.alt || "")}"></div>
    <div class="pitch-media-grid"><div class="pitch-field"><label>Fit</label><select data-media=fit>${["cover","contain","stretch"].map((value) => `<option value="${value}" ${element.fit === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div class="pitch-field"><label>Clip</label><select data-media=clip>${["rect","roundRect","ellipse"].map((value) => `<option value="${value}" ${clip === value ? "selected" : ""}>${value}</option>`).join("")}</select></div></div>
    <div class="pitch-media-grid"><div class="pitch-field"><label>Radius · DU</label><input data-media=radius type=number min=0 step=1 value="${element.cornerRadiusDU ?? 0}"></div><div class="pitch-field"><label>Focal X · %</label><input data-media=focalX type=number min=0 max=100 step=1 value="${Math.round(focal.x * 100)}"></div></div>
    <div class="pitch-media-grid"><div class="pitch-field"><label>Focal Y · %</label><input data-media=focalY type=number min=0 max=100 step=1 value="${Math.round(focal.y * 100)}"></div><div class="pitch-field"><label>Crop left · %</label><input data-media=left type=number min=0 max=99 step=.5 value="${crop.left * 100}"></div></div>
    <div class="pitch-media-grid"><div class="pitch-field"><label>Crop top · %</label><input data-media=top type=number min=0 max=99 step=.5 value="${crop.top * 100}"></div><div class="pitch-field"><label>Crop right · %</label><input data-media=right type=number min=0 max=99 step=.5 value="${crop.right * 100}"></div></div>
    <div class="pitch-media-grid"><div class="pitch-field"><label>Crop bottom · %</label><input data-media=bottom type=number min=0 max=99 step=.5 value="${crop.bottom * 100}"></div></div>
    <div class="pitch-media-actions"><button class="pitch-media-action crop" data-media-action=crop>Edit crop on canvas</button><button class="pitch-media-action" data-media-action=apply>Apply · one version</button><button class="pitch-media-action secondary" data-media-action=reset>Reset crop/focal</button></div>
    <div class="pitch-inspector-note">Crop, focal point, clip shape, fit, asset and radius are canonical image properties. Double-click a selected image to enter Crop Mode directly.</div>`;
  panel.appendChild(section);

  section.querySelector("[data-media-action=apply]")?.addEventListener("click", () => {
    try {
      const changes = {
        assetId: (section.querySelector("[data-media=asset]") as HTMLInputElement).value.trim(),
        alt: (section.querySelector("[data-media=alt]") as HTMLInputElement).value,
        fit: (section.querySelector("[data-media=fit]") as HTMLSelectElement).value,
        clipShape: (section.querySelector("[data-media=clip]") as HTMLSelectElement).value,
        cornerRadiusDU: Math.max(0, number(section, "radius")),
        focalPoint: { x: number(section, "focalX") / 100, y: number(section, "focalY") / 100 },
        crop: { left: number(section, "left") / 100, top: number(section, "top") / 100, right: number(section, "right") / 100, bottom: number(section, "bottom") / 100 },
      };
      void run({ command: "setImageProperties", slideId: slide.id, elementId: element.id, changes });
    } catch (error) { status(`Media failed: ${error instanceof Error ? error.message : String(error)}`); }
  });
  section.querySelector("[data-media-action=reset]")?.addEventListener("click", () => void run({ command: "setImageProperties", slideId: slide.id, elementId: element.id, changes: { crop: null, focalPoint: null } }));
  section.querySelector("[data-media-action=crop]")?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("pitch:media-crop-mode")));
}

export function installPitchMediaUI(): void {
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  window.addEventListener("pitch:editor-state", () => requestAnimationFrame(render));
  requestAnimationFrame(render);
}
