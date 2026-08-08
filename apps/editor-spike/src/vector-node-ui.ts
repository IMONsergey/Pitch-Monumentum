import type { VectorPathData } from "../../../packages/deck-model/src/index.js";
import { deleteVectorAnchor, splitVectorSegment } from "../../../packages/vector-path/src/edit.js";
import { nearestVectorSegment } from "../../../packages/vector-path/src/hit-test.js";
import { moveVectorAnchor, moveVectorHandle, vectorAnchors, vectorPathBounds, vectorPathToSvg } from "../../../packages/vector-path/src/index.js";

type AnyRecord = Record<string, any>;
type Runtime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  getSelectedIds(): string[];
  select(ids: string[]): void;
  command(input: AnyRecord): Promise<AnyRecord>;
};

type VectorHandleKind = "in" | "out";

const NS = "http://www.w3.org/2000/svg";
let editingId: string | null = null;
let overlay: SVGSVGElement | null = null;
let workingPath: VectorPathData | null = null;
let sourceBounds: ReturnType<typeof vectorPathBounds> | null = null;
let sourceGeometry: AnyRecord | null = null;
let selectedAnchor: number | null = null;
let drag: { pointerId: number; commandIndex: number; kind: "anchor" | VectorHandleKind; original: VectorPathData } | null = null;

function runtime(): Runtime | undefined {
  return (window as any).__pitchEditorRuntime as Runtime | undefined;
}

function status(message: string): void {
  const node = document.getElementById("spikeStatus");
  if (node) node.textContent = message;
}

function editableVector(): AnyRecord | undefined {
  const editor = runtime();
  const slide = editor?.getSlide();
  return slide?.scene?.find((element: AnyRecord) => element.id === editingId && element.type === "shape" && element.shape === "custom" && element.pathData);
}

function ensureOverlay(): SVGSVGElement | null {
  const stage = document.getElementById("spikeStage");
  if (!stage) return null;
  if (overlay && overlay.isConnected) return overlay;
  overlay = document.createElementNS(NS, "svg");
  overlay.id = "pitchVectorNodeOverlay";
  overlay.setAttribute("viewBox", "0 0 1920 1080");
  overlay.style.cssText = "position:absolute;inset:0;width:1920px;height:1080px;z-index:10020;overflow:visible;pointer-events:none";
  stage.appendChild(overlay);
  overlay.addEventListener("pointerdown", onPointerDown);
  overlay.addEventListener("dblclick", onSegmentDoubleClick, true);
  return overlay;
}

function affine() {
  if (!sourceBounds || !sourceGeometry) return undefined;
  const sx = sourceGeometry.width / Math.max(.000001, sourceBounds.width);
  const sy = sourceGeometry.height / Math.max(.000001, sourceBounds.height);
  const radians = (sourceGeometry.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = sourceGeometry.x + sourceGeometry.width / 2;
  const cy = sourceGeometry.y + sourceGeometry.height / 2;
  const bcx = sourceBounds.left + sourceBounds.width / 2;
  const bcy = sourceBounds.top + sourceBounds.height / 2;
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const e = cx - a * bcx - c * bcy;
  const f = cy - b * bcx - d * bcy;
  return { sx, sy, radians, cos, sin, cx, cy, bcx, bcy, a, b, c, d, e, f };
}

function localToSlide(x: number, y: number): { x: number; y: number } {
  const m = affine();
  if (!m) return { x, y };
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function slideToLocal(x: number, y: number): { x: number; y: number } {
  const m = affine();
  if (!m) return { x, y };
  const dx = x - m.cx;
  const dy = y - m.cy;
  const unrotatedX = dx * m.cos + dy * m.sin;
  const unrotatedY = -dx * m.sin + dy * m.cos;
  return {
    x: m.bcx + unrotatedX / Math.max(.000001, m.sx),
    y: m.bcy + unrotatedY / Math.max(.000001, m.sy),
  };
}

function clientToSlide(event: { clientX: number; clientY: number }): { x: number; y: number } {
  const stage = document.getElementById("spikeStage")!;
  const rect = stage.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * 1920 / Math.max(1, rect.width),
    y: (event.clientY - rect.top) * 1080 / Math.max(1, rect.height),
  };
}

function circle(x: number, y: number, radius: number, fill: string, stroke: string): SVGCircleElement {
  const node = document.createElementNS(NS, "circle");
  node.setAttribute("cx", String(x)); node.setAttribute("cy", String(y)); node.setAttribute("r", String(radius));
  node.setAttribute("fill", fill); node.setAttribute("stroke", stroke); node.setAttribute("stroke-width", "2");
  node.style.pointerEvents = "auto"; node.style.cursor = "move";
  return node;
}

function handleLine(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
  const line = document.createElementNS(NS, "line");
  line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1)); line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2));
  line.setAttribute("stroke", "#4C7DFF"); line.setAttribute("stroke-width", "1.5"); line.setAttribute("stroke-dasharray", "5 4");
  return line;
}

function renderOverlay(): void {
  const svg = ensureOverlay();
  const m = affine();
  if (!svg) return;
  svg.innerHTML = "";
  if (!editingId || !workingPath || !sourceBounds || !sourceGeometry || !m) { svg.style.display = "none"; return; }
  svg.style.display = "block";

  const preview = document.createElementNS(NS, "path");
  preview.setAttribute("d", vectorPathToSvg(workingPath));
  preview.setAttribute("fill", "none");
  preview.setAttribute("stroke", "#335CFF");
  preview.setAttribute("stroke-width", "6");
  preview.setAttribute("stroke-opacity", ".65");
  preview.setAttribute("vector-effect", "non-scaling-stroke");
  preview.dataset.vectorSegmentSurface = "true";
  preview.style.pointerEvents = "stroke";
  preview.style.cursor = "copy";
  preview.setAttribute("transform", `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
  svg.appendChild(preview);

  for (const anchor of vectorAnchors(workingPath)) {
    const a = localToSlide(anchor.x, anchor.y);
    for (const [kind, handle] of [["in", anchor.inHandle], ["out", anchor.outHandle]] as const) {
      if (!handle) continue;
      const h = localToSlide(handle.x, handle.y);
      svg.appendChild(handleLine(a.x, a.y, h.x, h.y));
      const handleNode = circle(h.x, h.y, 5, "#0D0E11", "#4C7DFF");
      handleNode.dataset.commandIndex = String(anchor.commandIndex);
      handleNode.dataset.vectorHandle = kind;
      svg.appendChild(handleNode);
    }
    const anchorNode = circle(a.x, a.y, 6, selectedAnchor === anchor.commandIndex ? "#335CFF" : "#FFFFFF", selectedAnchor === anchor.commandIndex ? "#FFFFFF" : "#335CFF");
    anchorNode.dataset.commandIndex = String(anchor.commandIndex);
    anchorNode.dataset.vectorAnchor = "true";
    svg.appendChild(anchorNode);
  }
}

function previewPath(): void {
  if (!editingId || !workingPath) return;
  const path = document.querySelector<SVGPathElement>(`#spikeScene [data-id="${CSS.escape(editingId)}"] svg path`);
  if (path) path.setAttribute("d", vectorPathToSvg(workingPath));
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target as SVGElement;
  const index = Number(target.dataset.commandIndex);
  if (!workingPath || !Number.isInteger(index)) return;
  const kind = target.dataset.vectorAnchor === "true" ? "anchor" : target.dataset.vectorHandle as VectorHandleKind | undefined;
  if (!kind) return;
  event.preventDefault(); event.stopPropagation();
  selectedAnchor = index;
  drag = { pointerId: event.pointerId, commandIndex: index, kind, original: structuredClone(workingPath) };
  overlay?.setPointerCapture(event.pointerId);
  renderOverlay();
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId || !workingPath) return;
  const slidePoint = clientToSlide(event);
  const local = slideToLocal(slidePoint.x, slidePoint.y);
  workingPath = drag.kind === "anchor"
    ? moveVectorAnchor(drag.original, drag.commandIndex, local.x, local.y, true)
    : moveVectorHandle(drag.original, drag.commandIndex, drag.kind, local.x, local.y);
  previewPath(); renderOverlay();
}

async function commitVectorPath(reason = "Edit vector nodes"): Promise<void> {
  const editor = runtime();
  if (!editor || !editingId || !workingPath) return;
  const id = editingId;
  await editor.command({ command: "setVectorPath", elementId: id, pathData: workingPath, fitBounds: true });
  const refreshed = editableVector();
  if (refreshed?.pathData) {
    workingPath = structuredClone(refreshed.pathData);
    sourceBounds = vectorPathBounds(refreshed.pathData);
    sourceGeometry = structuredClone(refreshed.geometry);
    editor.select([id]);
    renderOverlay();
  } else exit();
  status(`${reason} · stable ID preserved · one version`);
}

function onPointerUp(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId) return;
  overlay?.releasePointerCapture(event.pointerId);
  drag = null;
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", onPointerUp, true);
  window.removeEventListener("pointercancel", onPointerUp, true);
  void commitVectorPath().catch(error => status(`Vector edit failed: ${error instanceof Error ? error.message : String(error)}`));
}

function onSegmentDoubleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!workingPath || target?.dataset.vectorSegmentSurface !== "true") return;
  event.preventDefault(); event.stopPropagation();
  const slidePoint = clientToSlide(event);
  const local = slideToLocal(slidePoint.x, slidePoint.y);
  const hit = nearestVectorSegment(workingPath, local, 48);
  if (!hit) return;
  try {
    workingPath = splitVectorSegment(workingPath, hit.commandIndex, hit.t);
    selectedAnchor = hit.commandIndex;
    previewPath(); renderOverlay();
    void commitVectorPath("Add vector point").catch(error => status(`Add point failed: ${error instanceof Error ? error.message : String(error)}`));
  } catch (error) {
    status(`Add point blocked: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function enter(elementId: string): void {
  const editor = runtime();
  const slide = editor?.getSlide();
  const element = slide?.scene?.find((item: AnyRecord) => item.id === elementId);
  if (!element?.pathData) return;
  editingId = elementId;
  workingPath = structuredClone(element.pathData);
  sourceBounds = vectorPathBounds(element.pathData);
  sourceGeometry = structuredClone(element.geometry);
  selectedAnchor = null;
  editor?.select([elementId]);
  renderOverlay();
  status(`Edit Vector${(element.geometry.rotation ?? 0) ? ` · rotated ${element.geometry.rotation}°` : ""} · drag anchors/handles · double-click segment adds point · Delete removes point · Esc exits`);
}

function exit(): void {
  editingId = null; workingPath = null; sourceBounds = null; sourceGeometry = null; selectedAnchor = null; drag = null;
  if (overlay) { overlay.innerHTML = ""; overlay.style.display = "none"; }
  status("Select tool");
}

export function installPitchVectorNodeUI(): void {
  ensureOverlay();
  document.getElementById("spikeScene")?.addEventListener("dblclick", event => {
    const host = (event.target as Element).closest<HTMLElement>(".spike-el[data-id]");
    if (!host) return;
    const element = runtime()?.getSlide()?.scene?.find((item: AnyRecord) => item.id === host.dataset.id);
    if (element?.type === "shape" && element.shape === "custom" && element.pathData) {
      event.preventDefault(); event.stopPropagation(); enter(element.id);
    }
  }, true);
  window.addEventListener("keydown", event => {
    const target = event.target as HTMLElement | null;
    if (target?.matches("input,textarea,select,[contenteditable=true]")) return;
    if (event.key === "Escape" && editingId) { event.preventDefault(); exit(); return; }
    if (event.key === "Enter" && !editingId) {
      const ids = runtime()?.getSelectedIds() ?? [];
      const element = ids.length === 1 ? runtime()?.getSlide()?.scene?.find((item: AnyRecord) => item.id === ids[0]) : undefined;
      if (element?.type === "shape" && element.shape === "custom" && element.pathData) { event.preventDefault(); enter(element.id); }
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && editingId && workingPath && selectedAnchor !== null) {
      event.preventDefault();
      try {
        workingPath = deleteVectorAnchor(workingPath, selectedAnchor);
        selectedAnchor = null;
        previewPath(); renderOverlay();
        void commitVectorPath("Delete vector point").catch(error => status(`Delete point failed: ${error instanceof Error ? error.message : String(error)}`));
      } catch (error) {
        status(`Delete point blocked: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, true);
  window.addEventListener("pitch:editor-state", () => {
    if (!editingId) return;
    const element = editableVector();
    if (!element?.pathData) exit();
    else requestAnimationFrame(renderOverlay);
  });
}
