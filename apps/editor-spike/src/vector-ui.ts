import { buildFreehandVector, buildPenVector, type PenAnchor, type VectorPoint } from "../../../packages/vector-engine/src/index.js";

type AnyRecord = Record<string, any>;
type ToolMode = "select" | "pencil" | "pen";

type PitchEditorRuntime = {
  getProject(): AnyRecord | null;
  getSlide(): AnyRecord | undefined;
  command(input: AnyRecord): Promise<AnyRecord>;
  select(ids: string[]): void;
};

const styles = `
  .pitch-vector-tools{display:flex;gap:3px;align-items:center;padding-right:6px;margin-right:3px;border-right:1px solid var(--line)}
  .pitch-vector-tool{height:30px;border:1px solid var(--line);background:#151a20;color:var(--text);border-radius:7px;padding:0 8px;cursor:pointer;font-size:11px}.pitch-vector-tool.active{border-color:#c7ff5e;color:#c7ff5e;background:#192118}
  .pitch-vector-overlay{position:absolute;inset:0;width:1920px;height:1080px;z-index:9998;overflow:visible;pointer-events:none}.pitch-vector-overlay.drawing{pointer-events:auto;cursor:crosshair}
  .pitch-vector-preview{fill:#111;stroke:none}.pitch-pen-preview{fill:none;stroke:#111;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.pitch-pen-anchor{fill:#fff;stroke:#335cff;stroke-width:2}
`;

let mode: ToolMode = "select";
let pencilPoints: VectorPoint[] = [];
let penAnchors: PenAnchor[] = [];
let overlay: SVGSVGElement | null = null;
let previewPath: SVGPathElement | null = null;
let anchorLayer: SVGGElement | null = null;
let pointerId: number | null = null;

function runtime(): PitchEditorRuntime | undefined {
  return (window as any).__pitchEditorRuntime as PitchEditorRuntime | undefined;
}

function status(message: string): void {
  const node = document.getElementById("spikeStatus");
  if (node) node.textContent = message;
}

function stage(): HTMLElement | null {
  return document.getElementById("spikeStage");
}

function toDU(event: PointerEvent): VectorPoint {
  const rect = stage()!.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1920, (event.clientX - rect.left) * 1920 / rect.width)),
    y: Math.max(0, Math.min(1080, (event.clientY - rect.top) * 1080 / rect.height)),
    pressure: event.pressure > 0 ? event.pressure : 0.5,
  };
}

function setMode(next: ToolMode): void {
  mode = next;
  pencilPoints = [];
  penAnchors = [];
  pointerId = null;
  renderPreview();
  overlay?.classList.toggle("drawing", next !== "select");
  document.querySelectorAll<HTMLElement>("[data-vector-tool]").forEach(button => button.classList.toggle("active", button.dataset.vectorTool === next));
  if (next === "pencil") status("Pencil · draw on the slide · pressure supported · Esc cancels");
  else if (next === "pen") status("Pen · click anchors · Enter finishes · click first anchor to close · Esc cancels");
  else status("Select tool");
}

function clearSvg(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function ensureOverlay(): void {
  const scene = document.getElementById("spikeScene");
  if (!scene || overlay) return;
  overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("viewBox", "0 0 1920 1080");
  overlay.classList.add("pitch-vector-overlay");
  previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  anchorLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  overlay.append(previewPath, anchorLayer);
  scene.insertAdjacentElement("afterend", overlay);

  overlay.addEventListener("pointerdown", onPointerDown);
  overlay.addEventListener("pointermove", onPointerMove);
  overlay.addEventListener("pointerup", onPointerUp);
  overlay.addEventListener("pointercancel", cancelPencil);
}

function renderPreview(): void {
  if (!previewPath || !anchorLayer) return;
  clearSvg(anchorLayer);
  previewPath.removeAttribute("d");
  previewPath.setAttribute("class", mode === "pencil" ? "pitch-vector-preview" : "pitch-pen-preview");
  if (mode === "pencil" && pencilPoints.length >= 2) {
    try {
      const built = buildFreehandVector(pencilPoints, { sizeDU: 18, thinning: 0.55, smoothing: 0.6, streamline: 0.45, simulatePressure: false });
      previewPath.setAttribute("d", built.element.svgPath || "");
      previewPath.setAttribute("transform", `translate(${built.element.geometry.x} ${built.element.geometry.y})`);
    } catch { /* short preview strokes are allowed while drawing */ }
    return;
  }
  previewPath.removeAttribute("transform");
  if (mode === "pen" && penAnchors.length) {
    const d = penAnchors.map((anchor, index) => `${index ? "L" : "M"} ${anchor.x} ${anchor.y}`).join(" ");
    previewPath.setAttribute("d", d);
    for (const [index, anchor] of penAnchors.entries()) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(anchor.x));
      circle.setAttribute("cy", String(anchor.y));
      circle.setAttribute("r", index === 0 ? "7" : "5");
      circle.setAttribute("class", "pitch-pen-anchor");
      circle.dataset.anchorIndex = String(index);
      anchorLayer.appendChild(circle);
    }
  }
}

async function insertBuiltVector(built: ReturnType<typeof buildPenVector> | ReturnType<typeof buildFreehandVector>): Promise<void> {
  const editor = runtime();
  const slide = editor?.getSlide();
  if (!editor || !slide) throw new Error("Editor is not ready");
  const element = built.element;
  const result = await editor.command({
    command: "insertVector",
    slideId: slide.id,
    geometry: element.geometry,
    svgPath: element.svgPath,
    fill: element.fill,
    stroke: element.stroke,
    name: element.name,
  });
  const insertedId = result.nextSelectionIds?.[0];
  if (insertedId) editor.select([insertedId]);
}

function onPointerDown(event: PointerEvent): void {
  if (mode === "select" || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const point = toDU(event);
  if (mode === "pencil") {
    pointerId = event.pointerId;
    overlay?.setPointerCapture(event.pointerId);
    pencilPoints = [point];
    renderPreview();
    return;
  }
  const first = penAnchors[0];
  if (first && penAnchors.length >= 3 && Math.hypot(point.x - first.x, point.y - first.y) <= 12) {
    void finishPen(true);
    return;
  }
  penAnchors.push({ x: point.x, y: point.y });
  renderPreview();
}

function onPointerMove(event: PointerEvent): void {
  if (mode !== "pencil" || pointerId !== event.pointerId) return;
  const point = toDU(event);
  const last = pencilPoints[pencilPoints.length - 1];
  if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1.5) pencilPoints.push(point);
  renderPreview();
}

function onPointerUp(event: PointerEvent): void {
  if (mode !== "pencil" || pointerId !== event.pointerId) return;
  overlay?.releasePointerCapture(event.pointerId);
  pointerId = null;
  if (pencilPoints.length < 2) { pencilPoints = []; renderPreview(); return; }
  const points = pencilPoints;
  pencilPoints = [];
  renderPreview();
  try {
    const built = buildFreehandVector(points, { sizeDU: 18, thinning: 0.55, smoothing: 0.6, streamline: 0.45, simulatePressure: false }, { name: "Pencil stroke", fill: "#111111" });
    void insertBuiltVector(built).then(() => status("Pencil stroke inserted · vector · one version")).catch(error => status(`Pencil failed: ${error instanceof Error ? error.message : String(error)}`));
  } catch (error) { status(`Pencil failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function cancelPencil(): void {
  pointerId = null;
  pencilPoints = [];
  renderPreview();
}

async function finishPen(close: boolean): Promise<void> {
  if (penAnchors.length < 2) { penAnchors = []; renderPreview(); return; }
  const anchors = penAnchors;
  penAnchors = [];
  renderPreview();
  try {
    const built = buildPenVector(anchors, close, close ? { name: "Pen shape", fill: "#111111" } : { name: "Pen path", fill: "transparent", stroke: { color: "#111111", widthDU: 3 } });
    await insertBuiltVector(built);
    status(`Pen ${close ? "shape" : "path"} inserted · vector · one version`);
  } catch (error) { status(`Pen failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function installKeyboard(): void {
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && mode !== "select") {
      event.preventDefault();
      pencilPoints = [];
      penAnchors = [];
      renderPreview();
      setMode("select");
      return;
    }
    if (event.key === "Enter" && mode === "pen") {
      event.preventDefault();
      void finishPen(false);
      return;
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key.toLowerCase() === "p") setMode("pen");
      if (event.key.toLowerCase() === "n") setMode("pencil");
      if (event.key.toLowerCase() === "v") setMode("select");
    }
  }, true);
}

export function installPitchVectorUI(): void {
  const style = document.createElement("style");
  style.textContent = styles;
  document.head.appendChild(style);
  ensureOverlay();
  const top = document.querySelector<HTMLElement>(".spike-top");
  const spacer = top?.querySelector<HTMLElement>(".spacer");
  if (!top || !spacer) return;
  const group = document.createElement("div");
  group.className = "pitch-vector-tools";
  group.innerHTML = `<button class="pitch-vector-tool active" data-vector-tool=select title="Select · V">V</button><button class="pitch-vector-tool" data-vector-tool=pen title="Pen · P">Pen</button><button class="pitch-vector-tool" data-vector-tool=pencil title="Pencil · N">Pencil</button>`;
  top.insertBefore(group, spacer);
  group.querySelectorAll<HTMLButtonElement>("[data-vector-tool]").forEach(button => button.addEventListener("click", () => setMode(button.dataset.vectorTool as ToolMode)));
  installKeyboard();
  window.addEventListener("pitch:editor-state", ensureOverlay);
}
