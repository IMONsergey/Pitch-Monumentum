type AnyRecord = Record<string, any>;
type Runtime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  getSelectedIds(): string[];
  reload(): Promise<void>;
};

type Crop = { left: number; top: number; right: number; bottom: number };
type Focal = { x: number; y: number };

const css = `
  .pitch-crop-overlay{position:fixed;z-index:1100;display:none;pointer-events:none;box-shadow:0 0 0 1px #b9ff66,0 0 0 9999px #03060966}.pitch-crop-overlay.open{display:block}
  .pitch-crop-guide{position:absolute;border:1px dashed #d8ff9e;box-shadow:0 0 0 1px #0007;pointer-events:none}
  .pitch-crop-handle{position:absolute;pointer-events:auto;background:#d7ff8b;border:1px solid #15220a;box-shadow:0 1px 5px #0008;border-radius:3px}.pitch-crop-handle[data-edge=left],.pitch-crop-handle[data-edge=right]{top:50%;width:8px;height:34px;transform:translate(-50%,-50%);cursor:ew-resize}.pitch-crop-handle[data-edge=right]{left:100%}.pitch-crop-handle[data-edge=top],.pitch-crop-handle[data-edge=bottom]{left:50%;width:34px;height:8px;transform:translate(-50%,-50%);cursor:ns-resize}.pitch-crop-handle[data-edge=bottom]{top:100%}
  .pitch-focal-handle{position:absolute;width:20px;height:20px;border-radius:50%;border:2px solid #fff;background:#1119;box-shadow:0 0 0 2px #0008;transform:translate(-50%,-50%);pointer-events:auto;cursor:move}.pitch-focal-handle:before,.pitch-focal-handle:after{content:"";position:absolute;background:#fff;opacity:.9}.pitch-focal-handle:before{width:28px;height:1px;left:-6px;top:7px}.pitch-focal-handle:after{width:1px;height:28px;left:7px;top:-6px}
  .pitch-crop-toolbar{position:absolute;left:50%;top:-42px;transform:translateX(-50%);display:flex;align-items:center;gap:5px;padding:5px;border:1px solid #353f4b;border-radius:8px;background:#0c1117ee;box-shadow:0 10px 28px #0009;pointer-events:auto;white-space:nowrap}.pitch-crop-toolbar button{height:26px;border:1px solid #394451;border-radius:6px;background:#141a21;color:#c9d1da;padding:0 8px;font:9px/1 ui-sans-serif,system-ui;cursor:pointer}.pitch-crop-toolbar button.active{border-color:#6e8d43;background:#1c2715;color:#dbff9d}.pitch-crop-toolbar button.primary{border-color:#4d6e33;background:#172211;color:#ddffa2}.pitch-crop-toolbar .sep{width:1px;height:18px;background:#2d3641;margin:0 1px}.pitch-crop-readout{font:9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#8994a3;padding:0 3px}
`;

let activeId: string | null = null;
let draftCrop: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
let draftFocal: Focal = { x: .5, y: .5 };
let lastFit = "cover";
let dragging: { kind: "crop" | "focal"; edge?: keyof Crop; startX: number; startY: number; crop: Crop; focal: Focal } | null = null;

function runtime(): Runtime | undefined { return (window as any).__pitchEditorRuntime as Runtime | undefined; }
function clamp(value: number, min = 0, max = 1): number { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0)); }
function cropOf(element: AnyRecord): Crop { return { left: element.crop?.left ?? 0, top: element.crop?.top ?? 0, right: element.crop?.right ?? 0, bottom: element.crop?.bottom ?? 0 }; }
function focalOf(element: AnyRecord): Focal { return { x: element.focalPoint?.x ?? .5, y: element.focalPoint?.y ?? .5 }; }
function status(message: string): void { const node = document.getElementById("spikeStatus"); if (node) node.textContent = message; }

function selectedImage(): { slide: AnyRecord; element: AnyRecord } | undefined {
  const editor = runtime(); const project = editor?.getProject(); const ids = editor?.getSelectedIds() ?? [];
  if (!project || ids.length !== 1) return undefined;
  for (const slide of project.deck.slides as AnyRecord[]) {
    const element = slide.scene.find((item: AnyRecord) => item.id === ids[0]);
    if (element?.type === "image") return { slide, element };
  }
  return undefined;
}

function imageNode(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#spikeScene [data-id="${CSS.escape(id)}"]`);
}

function effectiveFocal(crop: Crop, focal: Focal): Focal {
  return { x: clamp(focal.x, crop.left, 1 - crop.right), y: clamp(focal.y, crop.top, 1 - crop.bottom) };
}

function previewImage(): void {
  if (!activeId) return;
  const node = imageNode(activeId); const img = node?.querySelector<HTMLImageElement>("img.pitch-asset-image"); if (!img) return;
  const crop = draftCrop;
  const visibleWidth = Math.max(.001, 1 - crop.left - crop.right);
  const visibleHeight = Math.max(.001, 1 - crop.top - crop.bottom);
  const focal = effectiveFocal(crop, draftFocal);
  const positionX = clamp((focal.x - crop.left) / visibleWidth) * 100;
  const positionY = clamp((focal.y - crop.top) / visibleHeight) * 100;
  img.style.left = `${-(crop.left / visibleWidth) * 100}%`;
  img.style.top = `${-(crop.top / visibleHeight) * 100}%`;
  img.style.width = `${100 / visibleWidth}%`;
  img.style.height = `${100 / visibleHeight}%`;
  img.style.objectPosition = `${positionX}% ${positionY}%`;
}

function overlay(): HTMLElement { return document.getElementById("pitchCropOverlay")!; }

function updateOverlay(): void {
  const root = overlay();
  if (!activeId) { root.classList.remove("open"); return; }
  const node = imageNode(activeId); if (!node) { root.classList.remove("open"); return; }
  const rect = node.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) { root.classList.remove("open"); return; }
  root.classList.add("open");
  root.style.left = `${rect.left}px`; root.style.top = `${rect.top}px`; root.style.width = `${rect.width}px`; root.style.height = `${rect.height}px`;
  const guide = root.querySelector<HTMLElement>(".pitch-crop-guide")!;
  guide.style.left = `${draftCrop.left * 100}%`; guide.style.top = `${draftCrop.top * 100}%`;
  guide.style.right = `${draftCrop.right * 100}%`; guide.style.bottom = `${draftCrop.bottom * 100}%`;
  const visibleWidth = Math.max(.001, 1 - draftCrop.left - draftCrop.right);
  const visibleHeight = Math.max(.001, 1 - draftCrop.top - draftCrop.bottom);
  const focal = effectiveFocal(draftCrop, draftFocal);
  const focalNode = root.querySelector<HTMLElement>(".pitch-focal-handle")!;
  focalNode.style.left = `${((focal.x - draftCrop.left) / visibleWidth) * 100}%`;
  focalNode.style.top = `${((focal.y - draftCrop.top) / visibleHeight) * 100}%`;
  root.querySelectorAll<HTMLButtonElement>("[data-crop-fit]").forEach(button => button.classList.toggle("active", button.dataset.cropFit === lastFit));
  const readout = root.querySelector<HTMLElement>(".pitch-crop-readout")!;
  readout.textContent = `L${Math.round(draftCrop.left * 100)} T${Math.round(draftCrop.top * 100)} R${Math.round(draftCrop.right * 100)} B${Math.round(draftCrop.bottom * 100)}`;
  previewImage();
}

async function mediaCommand(payload: AnyRecord): Promise<void> {
  const editor = runtime(); const project = editor?.getProject(); const found = selectedImage(); if (!editor || !project || !found || found.element.id !== activeId) return;
  const response = await fetch("/api/media-command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, slideId: found.slide.id, elementId: activeId, expectedDeckHash: project.deckHash }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || response.statusText);
  await editor.reload();
  const current = selectedImage();
  if (current?.element.id === activeId) {
    draftCrop = cropOf(current.element); draftFocal = focalOf(current.element); lastFit = current.element.fit ?? "cover";
    requestAnimationFrame(updateOverlay);
  }
}

function start(): void {
  const found = selectedImage(); if (!found) { status("Crop mode requires one selected image"); return; }
  activeId = found.element.id; draftCrop = cropOf(found.element); draftFocal = focalOf(found.element); lastFit = found.element.fit ?? "cover";
  status("Crop mode · drag crop edges or focal target · Enter/Esc to finish"); requestAnimationFrame(updateOverlay);
}
function stop(): void { activeId = null; dragging = null; overlay().classList.remove("open"); status("Crop mode closed"); }

function beginCrop(event: PointerEvent, edge: keyof Crop): void {
  if (!activeId) return; event.preventDefault(); event.stopPropagation();
  dragging = { kind: "crop", edge, startX: event.clientX, startY: event.clientY, crop: { ...draftCrop }, focal: { ...draftFocal } };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}
function beginFocal(event: PointerEvent): void {
  if (!activeId) return; event.preventDefault(); event.stopPropagation();
  dragging = { kind: "focal", startX: event.clientX, startY: event.clientY, crop: { ...draftCrop }, focal: { ...draftFocal } };
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function move(event: PointerEvent): void {
  if (!dragging || !activeId) return;
  const node = imageNode(activeId); if (!node) return; const rect = node.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  if (dragging.kind === "focal") {
    const x = clamp((event.clientX - rect.left) / rect.width); const y = clamp((event.clientY - rect.top) / rect.height);
    const visibleWidth = 1 - draftCrop.left - draftCrop.right; const visibleHeight = 1 - draftCrop.top - draftCrop.bottom;
    draftFocal = { x: draftCrop.left + x * visibleWidth, y: draftCrop.top + y * visibleHeight };
  } else {
    const visibleWidth = Math.max(.02, 1 - dragging.crop.left - dragging.crop.right); const visibleHeight = Math.max(.02, 1 - dragging.crop.top - dragging.crop.bottom);
    const dx = (event.clientX - dragging.startX) / rect.width; const dy = (event.clientY - dragging.startY) / rect.height;
    const next = { ...dragging.crop };
    if (dragging.edge === "left") next.left = clamp(dragging.crop.left + dx * visibleWidth, 0, .98 - dragging.crop.right);
    if (dragging.edge === "right") next.right = clamp(dragging.crop.right - dx * visibleWidth, 0, .98 - dragging.crop.left);
    if (dragging.edge === "top") next.top = clamp(dragging.crop.top + dy * visibleHeight, 0, .98 - dragging.crop.bottom);
    if (dragging.edge === "bottom") next.bottom = clamp(dragging.crop.bottom - dy * visibleHeight, 0, .98 - dragging.crop.top);
    draftCrop = next;
    draftFocal = effectiveFocal(draftCrop, draftFocal);
  }
  updateOverlay();
}

async function end(): Promise<void> {
  if (!dragging) return; const kind = dragging.kind; dragging = null;
  try {
    if (kind === "focal") await mediaCommand({ command: "setImageFocalPoint", focalPoint: draftFocal });
    else await mediaCommand({ command: "setImageCrop", crop: draftCrop });
  } catch (error) { status(`Crop failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function installOverlay(): void {
  const root = document.createElement("div"); root.id = "pitchCropOverlay"; root.className = "pitch-crop-overlay";
  root.innerHTML = `<div class="pitch-crop-toolbar"><button data-crop-fit="cover">Cover</button><button data-crop-fit="contain">Contain</button><button data-crop-fit="stretch">Stretch</button><span class="sep"></span><span class="pitch-crop-readout"></span><button data-crop-reset>Reset</button><button class="primary" data-crop-done>Done</button></div><div class="pitch-crop-guide"><span class="pitch-crop-handle" data-edge="left"></span><span class="pitch-crop-handle" data-edge="right"></span><span class="pitch-crop-handle" data-edge="top"></span><span class="pitch-crop-handle" data-edge="bottom"></span></div><span class="pitch-focal-handle" title="Focal point"></span>`;
  document.body.appendChild(root);
  root.querySelectorAll<HTMLElement>("[data-edge]").forEach(handle => handle.addEventListener("pointerdown", event => beginCrop(event, handle.dataset.edge as keyof Crop)));
  root.querySelector<HTMLElement>(".pitch-focal-handle")?.addEventListener("pointerdown", beginFocal);
  root.querySelectorAll<HTMLButtonElement>("[data-crop-fit]").forEach(button => button.addEventListener("click", () => {
    const fit = button.dataset.cropFit; if (!fit) return; lastFit = fit; updateOverlay(); void mediaCommand({ command: "setImageFit", fit }).catch(error => status(`Fit failed: ${String(error)}`));
  }));
  root.querySelector("[data-crop-reset]")?.addEventListener("click", () => {
    draftCrop = { left: 0, top: 0, right: 0, bottom: 0 }; draftFocal = { x: .5, y: .5 }; updateOverlay();
    void mediaCommand({ command: "setImageProperties", changes: { crop: null, focalPoint: null } }).catch(error => status(`Reset failed: ${String(error)}`));
  });
  root.querySelector("[data-crop-done]")?.addEventListener("click", stop);
  window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", () => void end(), true); window.addEventListener("pointercancel", () => { dragging = null; }, true);
}

export function installPitchCropModeUI(): void {
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style); installOverlay();
  window.addEventListener("pitch:media-crop-mode", start as EventListener);
  window.addEventListener("pitch:editor-state", () => {
    if (!activeId) return;
    const found = selectedImage(); if (!found || found.element.id !== activeId) { stop(); return; }
    if (!dragging) { draftCrop = cropOf(found.element); draftFocal = focalOf(found.element); lastFit = found.element.fit ?? "cover"; requestAnimationFrame(updateOverlay); }
  });
  window.addEventListener("resize", () => requestAnimationFrame(updateOverlay));
  window.addEventListener("scroll", () => requestAnimationFrame(updateOverlay), true);
  document.addEventListener("dblclick", event => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("#spikeScene [data-id]");
    if (!target) return; const found = selectedImage(); if (found?.element.id === target.dataset.id) { event.preventDefault(); start(); }
  }, true);
  window.addEventListener("keydown", event => {
    if (!activeId) return;
    if (event.key === "Escape" || event.key === "Enter") { event.preventDefault(); stop(); }
  }, true);
}
