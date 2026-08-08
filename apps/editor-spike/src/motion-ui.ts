type AnyRecord = Record<string, any>;

type Runtime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  getSelectedIds(): string[];
  reload(): Promise<void>;
};

const css = `
  .pitch-motion-toggle{border-color:#4f5d3c!important;color:#dcff9a!important}
  .pitch-motion-drawer{position:fixed;left:240px;right:300px;bottom:40px;height:258px;background:#0d1116f7;border-top:1px solid #323945;z-index:400;display:none;box-shadow:0 -18px 50px #0007;backdrop-filter:blur(18px)}
  .pitch-motion-drawer.open{display:grid;grid-template-rows:42px 1fr}.pitch-motion-head{display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--line)}
  .pitch-motion-head b{font-size:12px}.pitch-motion-head small{color:var(--muted)}.pitch-motion-body{display:grid;grid-template-columns:260px minmax(320px,1fr) 310px;min-height:0}
  .pitch-motion-col{padding:10px 12px;overflow:auto;border-right:1px solid var(--line)}.pitch-motion-col:last-child{border-right:0}.pitch-motion-col h4{margin:0 0 8px;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#8c96a5}
  .pitch-motion-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}.pitch-motion-field{display:flex;flex-direction:column;gap:3px}.pitch-motion-field label{font-size:9px;color:#6f7988}
  .pitch-motion-field input,.pitch-motion-field select{height:29px;min-width:0;border:1px solid var(--line);border-radius:6px;background:#12171d;color:var(--text);padding:0 7px;font-size:10px}.pitch-motion-btn{height:29px;border:1px solid #455133;border-radius:6px;background:#171e13;color:#d9f5a2;cursor:pointer;font-size:10px;padding:0 9px}.pitch-motion-btn.secondary{border-color:var(--line);background:#151a20;color:#a8b0bd}.pitch-motion-btn.danger{border-color:#583a40;background:#211419;color:#e9a4ae}
  .pitch-build{display:grid;grid-template-columns:24px 1fr auto;gap:7px;align-items:center;border:1px solid #262d36;border-radius:7px;padding:6px 7px;margin-bottom:5px;background:#101419}.pitch-build-index{font-size:9px;color:#707b8a}.pitch-build-main{min-width:0}.pitch-build-main b{display:block;font-size:10px}.pitch-build-main small{display:block;color:#778190;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pitch-motion-empty{color:#697484;font-size:10px;line-height:1.5}.pitch-motion-actions{display:flex;gap:5px}.pitch-motion-history{font-size:9px;color:#687382;margin-left:auto}
`;

let open = false;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
async function api(path: string, payload?: unknown): Promise<any> {
  const response = await fetch(path, { method: payload === undefined ? "POST" : "POST", headers: { "content-type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}
function esc(value: unknown): string { return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[char] ?? char); }
function status(message: string): void { const node = document.getElementById("spikeStatus"); if (node) node.textContent = message; }
function currentMotion(project: AnyRecord, slideId: string): AnyRecord { return project.motion?.slides?.find((item: AnyRecord) => item.slideId === slideId) ?? { slideId, tracks: [], builds: [] }; }

async function run(payload: AnyRecord): Promise<void> {
  const editor = runtime();
  const project = editor?.getProject();
  if (!editor || !project) return;
  try {
    status(`Motion · ${payload.command}…`);
    await api("/api/motion-command", { ...payload, expectedDeckHash: project.deckHash, expectedMotionHash: project.motionHash });
    await editor.reload();
    render();
    status(`Motion · ${payload.command} committed`);
  } catch (error) { status(`Motion failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function selectedElement(): AnyRecord | undefined {
  const editor = runtime();
  const slide = editor?.getSlide();
  const selected = editor?.getSelectedIds() ?? [];
  if (!slide || selected.length !== 1) return undefined;
  return slide.scene.find((element: AnyRecord) => element.id === selected[0]);
}

function startValue(element: AnyRecord | undefined, property: string): number {
  if (!element) return 0;
  if (property === "opacity") return element.opacity ?? 1;
  if (property === "scaleX" || property === "scaleY") return 1;
  return element.geometry?.[property] ?? 0;
}

function render(): void {
  const drawer = document.getElementById("pitchMotionDrawer");
  if (!drawer) return;
  drawer.classList.toggle("open", open);
  const editor = runtime();
  const project = editor?.getProject();
  const slide = editor?.getSlide();
  if (!open || !project || !slide) return;
  const motion = currentMotion(project, slide.id);
  const selected = editor?.getSelectedIds() ?? [];
  const element = selectedElement();
  const transition = motion.transition ?? { type: "none", durationMs: 350 };
  const history = project.motionHistory ?? {};

  drawer.innerHTML = `
    <div class="pitch-motion-head"><b>Motion Studio</b><small>${esc(slide.title)}</small><span class="pitch-motion-history">${motion.builds.length} builds · ${motion.tracks.length} tracks</span><div class="pitch-motion-actions"><button class="pitch-motion-btn secondary" data-motion-history=undo ${history.canUndo ? "" : "disabled"}>Undo</button><button class="pitch-motion-btn secondary" data-motion-history=redo ${history.canRedo ? "" : "disabled"}>Redo</button><button class="pitch-motion-btn secondary" data-motion-close>Close</button></div></div>
    <div class="pitch-motion-body">
      <section class="pitch-motion-col"><h4>Slide transition</h4>
        <div class="pitch-motion-row"><div class="pitch-motion-field"><label>Type</label><select data-motion=transitionType>${["none","fade","push","wipe","dissolve"].map((value) => `<option value="${value}" ${transition.type === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div class="pitch-motion-field"><label>Duration · ms</label><input data-motion=transitionDuration type=number min=0 step=50 value="${transition.durationMs ?? 350}"></div></div>
        <button class="pitch-motion-btn" data-motion-action=transition>Apply transition</button>
        <h4 style="margin-top:17px">Build selected</h4>
        <div class="pitch-motion-row"><div class="pitch-motion-field"><label>Effect</label><select data-motion=buildEffect>${["appear","fade","scale","slide","wipe","pulse"].map((value) => `<option value="${value}">${value}</option>`).join("")}</select></div><div class="pitch-motion-field"><label>Trigger</label><select data-motion=buildTrigger>${["onClick","withPrevious","afterPrevious"].map((value) => `<option value="${value}">${value}</option>`).join("")}</select></div></div>
        <div class="pitch-motion-row"><div class="pitch-motion-field"><label>Kind</label><select data-motion=buildKind>${["entrance","emphasis","exit"].map((value) => `<option value="${value}">${value}</option>`).join("")}</select></div><div class="pitch-motion-field"><label>Duration · ms</label><input data-motion=buildDuration type=number min=0 step=50 value="400"></div></div>
        <button class="pitch-motion-btn" data-motion-action=build ${selected.length ? "" : "disabled"}>Add build · ${selected.length || 0} selected</button>
      </section>
      <section class="pitch-motion-col"><h4>Build order</h4>
        ${motion.builds.length ? motion.builds.map((build: AnyRecord, index: number) => `<div class="pitch-build"><span class="pitch-build-index">${String(index + 1).padStart(2,"0")}</span><div class="pitch-build-main"><b>${esc(build.effect)} · ${esc(build.kind)}</b><small>${esc(build.trigger)} · ${build.durationMs} ms · ${esc(build.elementIds.join(", "))}</small></div><button class="pitch-motion-btn danger" data-delete-build="${esc(build.id)}">×</button></div>`).join("") : `<div class="pitch-motion-empty">No builds yet. Select objects and add entrance, emphasis or exit behavior. Build order is canonical and branch-safe.</div>`}
      </section>
      <section class="pitch-motion-col"><h4>Keyframes</h4>
        ${element ? `<div class="pitch-motion-empty" style="margin-bottom:8px">Target: <b style="color:var(--text)">${esc(element.name || element.id)}</b></div>
        <div class="pitch-motion-row"><div class="pitch-motion-field"><label>Property</label><select data-motion=trackProperty>${["x","y","rotation","opacity","scaleX","scaleY"].map((value) => `<option value="${value}">${value}</option>`).join("")}</select></div><div class="pitch-motion-field"><label>Duration · ms</label><input data-motion=trackDuration type=number min=1 step=50 value="700"></div></div>
        <div class="pitch-motion-row"><div class="pitch-motion-field"><label>From</label><input data-motion=trackFrom type=number step=.1 value="${startValue(element,"x")}"></div><div class="pitch-motion-field"><label>To</label><input data-motion=trackTo type=number step=.1 value="${startValue(element,"x") + 160}"></div></div>
        <button class="pitch-motion-btn" data-motion-action=track>Add / replace track</button>
        <h4 style="margin-top:17px">Tracks on slide</h4>${motion.tracks.map((track: AnyRecord) => `<div class="pitch-build"><span class="pitch-build-index">◆</span><div class="pitch-build-main"><b>${esc(track.property)}</b><small>${esc(track.elementId)} · ${track.keyframes.length} keyframes</small></div><button class="pitch-motion-btn danger" data-delete-track="${esc(track.id)}">×</button></div>`).join("") || `<div class="pitch-motion-empty">No keyframe tracks.</div>`}` : `<div class="pitch-motion-empty">Select one object to animate exact properties with keyframes.</div>`}
      </section>
    </div>`;

  drawer.querySelector("[data-motion-close]")?.addEventListener("click", () => { open = false; render(); });
  drawer.querySelector("[data-motion-action=transition]")?.addEventListener("click", () => {
    const type = (drawer.querySelector("[data-motion=transitionType]") as HTMLSelectElement).value;
    const durationMs = Number((drawer.querySelector("[data-motion=transitionDuration]") as HTMLInputElement).value);
    void run({ command: "setSlideTransition", slideId: slide.id, transition: type === "none" ? null : { type, durationMs, advance: "manual" } });
  });
  drawer.querySelector("[data-motion-action=build]")?.addEventListener("click", () => void run({
    command: "addBuild", slideId: slide.id, elementIds: editor?.getSelectedIds() ?? [],
    kind: (drawer.querySelector("[data-motion=buildKind]") as HTMLSelectElement).value,
    effect: (drawer.querySelector("[data-motion=buildEffect]") as HTMLSelectElement).value,
    trigger: (drawer.querySelector("[data-motion=buildTrigger]") as HTMLSelectElement).value,
    durationMs: Number((drawer.querySelector("[data-motion=buildDuration]") as HTMLInputElement).value), easing: "easeInOut",
  }));
  drawer.querySelector("[data-motion-action=track]")?.addEventListener("click", () => {
    if (!element) return;
    const property = (drawer.querySelector("[data-motion=trackProperty]") as HTMLSelectElement).value;
    const durationMs = Number((drawer.querySelector("[data-motion=trackDuration]") as HTMLInputElement).value);
    const from = Number((drawer.querySelector("[data-motion=trackFrom]") as HTMLInputElement).value);
    const to = Number((drawer.querySelector("[data-motion=trackTo]") as HTMLInputElement).value);
    void run({ command: "setTrack", slideId: slide.id, elementId: element.id, property, keyframes: [{ timeMs: 0, value: from }, { timeMs: durationMs, value: to, easing: "easeInOut" }] });
  });
  drawer.querySelector("[data-motion=trackProperty]")?.addEventListener("change", (event) => {
    if (!element) return;
    const property = (event.target as HTMLSelectElement).value;
    const start = startValue(element, property);
    (drawer.querySelector("[data-motion=trackFrom]") as HTMLInputElement).value = String(start);
    (drawer.querySelector("[data-motion=trackTo]") as HTMLInputElement).value = String(property === "opacity" ? 0 : property.startsWith("scale") ? 1.2 : start + 160);
  });
  drawer.querySelectorAll<HTMLElement>("[data-delete-build]").forEach((button) => button.addEventListener("click", () => void run({ command: "deleteBuild", slideId: slide.id, buildId: button.dataset.deleteBuild })));
  drawer.querySelectorAll<HTMLElement>("[data-delete-track]").forEach((button) => button.addEventListener("click", () => void run({ command: "deleteTrack", slideId: slide.id, trackId: button.dataset.deleteTrack })));
  drawer.querySelectorAll<HTMLButtonElement>("[data-motion-history]").forEach((button) => button.addEventListener("click", async () => {
    const editorRuntime = runtime(); if (!editorRuntime) return;
    try { await api(button.dataset.motionHistory === "undo" ? "/api/motion-undo" : "/api/motion-redo"); await editorRuntime.reload(); render(); } catch (error) { status(`Motion history failed: ${error instanceof Error ? error.message : String(error)}`); }
  }));
}

export function installPitchMotionUI(): void {
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const top = document.querySelector<HTMLElement>(".spike-top");
  const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (top && spacer) {
    const button = document.createElement("button"); button.className = "spike-btn pitch-motion-toggle"; button.textContent = "Motion";
    button.addEventListener("click", () => { open = !open; render(); }); top.insertBefore(button, spacer);
  }
  const drawer = document.createElement("div"); drawer.id = "pitchMotionDrawer"; drawer.className = "pitch-motion-drawer"; document.body.appendChild(drawer);
  window.addEventListener("pitch:editor-state", render);
  render();
}
