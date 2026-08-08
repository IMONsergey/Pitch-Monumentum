import type { VectorPathData } from "../../../packages/deck-model/src/index.js";
import { moveVectorAnchor, vectorAnchors, vectorPathToSvg } from "../../../packages/vector-engine/src/index.js";
import { moveVectorHandle, replaceVectorPathOperations, type VectorHandleKind } from "../../../packages/vector-engine/src/path-edit.js";
import { vectorPathBounds } from "../../../packages/vector-engine/src/path-utils.js";

type AnyRecord = Record<string, any>;
type Runtime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  getSelectedIds(): string[];
  select(ids: string[]): void;
  reload(): Promise<void>;
};

const NS = "http://www.w3.org/2000/svg";
let editingId: string | null = null;
let overlay: SVGSVGElement | null = null;
let workingPath: VectorPathData | null = null;
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
  return overlay;
}

function localToSlide(element: AnyRecord, path: VectorPathData, x: number, y: number): { x: number; y: number } {
  const box = vectorPathBounds(path);
  return {
    x: element.geometry.x + ((x - box.left) / box.width) * element.geometry.width,
    y: element.geometry.y + ((y - box.top) / box.height) * element.geometry.height,
  };
}

function slideToLocal(element: AnyRecord, path: VectorPathData, x: number, y: number): { x: number; y: number } {
  const box = vectorPathBounds(path);
  return {
    x: box.left + ((x - element.geometry.x) / Math.max(.001, element.geometry.width)) * box.width,
    y: box.top + ((y - element.geometry.y) / Math.max(.001, element.geometry.height)) * box.height,
  };
}

function pointerToSlide(event: PointerEvent): { x: number; y: number } {
  const stage = document.getElementById("spikeStage")!;
  const rect = stage.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * 1920 / rect.width,
    y: (event.clientY - rect.top) * 1080 / rect.height,
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
  const element = editableVector();
  if (!svg) return;
  svg.innerHTML = "";
  if (!element || !workingPath) { svg.style.display = "none"; return; }
  svg.style.display = "block";
  for (const anchor of vectorAnchors(workingPath)) {
    const a = localToSlide(element, workingPath, anchor.x, anchor.y);
    for (const [kind, handle] of [["in", anchor.inHandle], ["out", anchor.outHandle]] as const) {
      if (!handle) continue;
      const h = localToSlide(element, workingPath, handle.x, handle.y);
      svg.appendChild(handleLine(a.x, a.y, h.x, h.y));
      const handleNode = circle(h.x, h.y, 5, "#0D0E11", "#4C7DFF");
      handleNode.dataset.commandIndex = String(anchor.commandIndex);
      handleNode.dataset.vectorHandle = kind;
      svg.appendChild(handleNode);
    }
    const anchorNode = circle(a.x, a.y, 6, "#FFFFFF", "#335CFF");
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
  drag = { pointerId: event.pointerId, commandIndex: index, kind, original: structuredClone(workingPath) };
  overlay?.setPointerCapture(event.pointerId);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
}

function onPointerMove(event: PointerEvent): void {
  const element = editableVector();
  if (!drag || drag.pointerId !== event.pointerId || !element) return;
  const slidePoint = pointerToSlide(event);
  const local = slideToLocal(element, drag.original, slidePoint.x, slidePoint.y);
  workingPath = drag.kind === "anchor"
    ? moveVectorAnchor(drag.original, drag.commandIndex, local.x, local.y, true)
    : moveVectorHandle(drag.original, drag.commandIndex, drag.kind, local.x, local.y);
  previewPath(); renderOverlay();
}

async function commitVectorPath(): Promise<void> {
  const editor = runtime();
  const project = editor?.getProject();
  const slide = editor?.getSlide();
  if (!editor || !project || !slide || !editingId || !workingPath) return;
  const operations = replaceVectorPathOperations(slide, editingId, workingPath);
  const response = await fetch("/api/mutate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: `Edit vector nodes ${editingId}`, operations, expectedDeckHash: project.deckHash }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  await editor.reload();
  editor.select([editingId]);
  const refreshed = editableVector();
  workingPath = refreshed?.pathData ? structuredClone(refreshed.pathData) : workingPath;
  renderOverlay();
}

function onPointerUp(event: PointerEvent): void {
  if (!drag || drag.pointerId !== event.pointerId) return;
  overlay?.releasePointerCapture(event.pointerId);
  drag = null;
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", onPointerUp, true);
  window.removeEventListener("pointercancel", onPointerUp, true);
  void commitVectorPath().then(() => status("Vector nodes committed · stable ID preserved · one version")).catch(error => status(`Vector edit failed: ${error instanceof Error ? error.message : String(error)}`));
}

function enter(elementId: string): void {
  const editor = runtime();
  const slide = editor?.getSlide();
  const element = slide?.scene?.find((item: AnyRecord) => item.id === elementId);
  if (!element?.pathData) return;
  editingId = elementId; workingPath = structuredClone(element.pathData); editor?.select([elementId]);
  renderOverlay(); status("Edit Vector · drag anchors or Bézier handles · Esc exits");
}

function exit(): void {
  editingId = null; workingPath = null; drag = null;
  if (overlay) { overlay.innerHTML = ""; overlay.style.display = "none"; }
  status("Select tool");
}

export function installPitchVectorNodeUI(): void {
  ensureOverlay();
  document.getElementById("spikeScene")?.addEventListener("dblclick", event => {
    const host = (event.target as Element).closest<HTMLElement>(".spike-el[data-id]");
    if (!host) return;
    const editor = runtime();
    const element = editor?.getSlide()?.scene?.find((item: AnyRecord) => item.id === host.dataset.id);
    if (element?.type === "shape" && element.shape === "custom" && element.pathData) {
      event.preventDefault(); event.stopPropagation(); enter(element.id);
    }
  }, true);
  window.addEventListener("keydown", event => { if (event.key === "Escape" && editingId) { event.preventDefault(); exit(); } }, true);
  window.addEventListener("pitch:editor-state", () => { if (editingId) requestAnimationFrame(renderOverlay); });
}
