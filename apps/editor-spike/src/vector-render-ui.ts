import { effectiveFillPaint } from "../../../packages/appearance/src/index.js";
import { effectiveVectorSvgPath } from "../../../packages/vector-engine/src/index.js";
import { vectorPathBounds } from "../../../packages/vector-path/src/index.js";

type AnyRecord = Record<string, any>;

let observer: MutationObserver | null = null;
let scheduled = false;

function editorProject(): AnyRecord | null {
  return (window as any).__pitchEditorRuntime?.getProject?.() ?? null;
}

function sceneIndex(state: AnyRecord): Map<string, AnyRecord> {
  return new Map((state.deck?.slides ?? []).flatMap((slide: AnyRecord) => slide.scene ?? []).map((element: AnyRecord) => [element.id, element]));
}

function gradient(svg: SVGSVGElement, paint: AnyRecord, elementId: string): string {
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  const node = document.createElementNS(ns, "linearGradient");
  const id = `pitch-vector-gradient-${elementId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  node.id = id;
  const angle = Number(paint.angleDeg ?? 0) * Math.PI / 180;
  const dx = Math.sin(angle), dy = -Math.cos(angle);
  node.setAttribute("x1", String(.5 - dx / 2)); node.setAttribute("y1", String(.5 - dy / 2));
  node.setAttribute("x2", String(.5 + dx / 2)); node.setAttribute("y2", String(.5 + dy / 2));
  for (const stop of paint.stops ?? []) {
    const child = document.createElementNS(ns, "stop");
    child.setAttribute("offset", `${Math.max(0, Math.min(1, Number(stop.position ?? 0))) * 100}%`);
    child.setAttribute("stop-color", stop.color || "#000000");
    child.setAttribute("stop-opacity", String(Math.max(0, Math.min(1, Number(stop.opacity ?? 1)))));
    node.appendChild(child);
  }
  defs.appendChild(node); svg.appendChild(defs);
  return `url(#${id})`;
}

function vectorShadow(element: AnyRecord): string {
  const shadow = element.effects?.find((effect: AnyRecord) => effect.kind === "dropShadow");
  if (!shadow) return "none";
  const alpha = Math.round(Math.max(0, Math.min(1, Number(shadow.opacity ?? 1))) * 255).toString(16).padStart(2, "0");
  return `drop-shadow(${shadow.offsetXDU || 0}px ${shadow.offsetYDU || 0}px ${Math.max(0, Number(shadow.blurDU || 0) / 2)}px ${shadow.color || "#000000"}${alpha})`;
}

function hydrateVectors(): void {
  scheduled = false;
  const scene = document.getElementById("spikeScene");
  const state = editorProject();
  if (!scene || !state) return;
  const index = sceneIndex(state);
  scene.querySelectorAll<HTMLElement>(".spike-el[data-id]").forEach((host) => {
    const element = host.dataset.id ? index.get(host.dataset.id) : undefined;
    if (!element || element.type !== "shape" || element.shape !== "custom") return;
    const d = effectiveVectorSvgPath(element as any);
    if (!d) return;
    const signature = JSON.stringify([element.pathData, element.svgPath, element.fill, element.fillPaint, element.stroke, element.effects]);
    if (host.dataset.pitchVectorSignature === signature) return;
    host.dataset.pitchVectorSignature = signature;
    host.innerHTML = ""; host.style.background = "transparent"; host.style.border = "0"; host.style.overflow = "visible";

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const box = element.pathData ? vectorPathBounds(element.pathData) : { left: 0, top: 0, width: Math.max(.01, element.geometry.width), height: Math.max(.01, element.geometry.height) };
    svg.setAttribute("viewBox", `${box.left} ${box.top} ${Math.max(.01, box.width)} ${Math.max(.01, box.height)}`);
    svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%"); svg.setAttribute("preserveAspectRatio", "none");
    svg.style.display = "block"; svg.style.overflow = "visible"; svg.style.pointerEvents = "none"; svg.style.filter = vectorShadow(element);

    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d); path.setAttribute("fill-rule", element.pathData?.fillRule ?? "nonzero");
    const paint = effectiveFillPaint(element as any);
    if (paint?.kind === "linearGradient") path.setAttribute("fill", gradient(svg, paint, element.id));
    else if (paint?.kind === "solid") { path.setAttribute("fill", paint.color); path.setAttribute("fill-opacity", String(paint.opacity ?? 1)); }
    else if (paint?.kind === "none") path.setAttribute("fill", "none");
    else path.setAttribute("fill", element.fill && element.fill !== "transparent" ? element.fill : "none");
    path.setAttribute("stroke", element.stroke?.color || "none"); path.setAttribute("stroke-width", String(element.stroke?.widthDU ?? 0));
    path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); path.setAttribute("vector-effect", "non-scaling-stroke");
    if (element.stroke?.dash === "dash") path.setAttribute("stroke-dasharray", `${Math.max(1, element.stroke.widthDU * 4)} ${Math.max(1, element.stroke.widthDU * 2)}`);
    if (element.stroke?.dash === "dot") path.setAttribute("stroke-dasharray", `${Math.max(1, element.stroke.widthDU)} ${Math.max(1, element.stroke.widthDU * 1.5)}`);
    svg.appendChild(path); host.appendChild(svg);
  });
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => requestAnimationFrame(hydrateVectors));
}

export function installPitchVectorRenderer(): void {
  const scene = document.getElementById("spikeScene");
  if (!scene) return;
  observer?.disconnect(); observer = new MutationObserver(schedule); observer.observe(scene, { childList: true, subtree: false });
  window.addEventListener("pitch:editor-state", schedule); schedule();
}
