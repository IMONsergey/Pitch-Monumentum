import { randomUUID } from "node:crypto";
import { getStroke } from "perfect-freehand";
import type { ShapeElement } from "../../deck-model/src/index.js";

export interface VectorPoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface PenAnchor {
  x: number;
  y: number;
  in?: { x: number; y: number };
  out?: { x: number; y: number };
}

export interface FreehandOptions {
  sizeDU?: number;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  simulatePressure?: boolean;
  easing?: (pressure: number) => number;
  start?: { cap?: boolean; taper?: number | boolean; easing?: (t: number) => number };
  end?: { cap?: boolean; taper?: number | boolean; easing?: (t: number) => number };
}

export interface VectorStyle {
  name?: string;
  fill?: string;
  stroke?: { color: string; widthDU: number; dash?: "solid" | "dash" | "dot" };
  semanticRole?: ShapeElement["semanticRole"];
  zIndex?: number;
  origin?: ShapeElement["origin"];
}

export interface BuiltVector {
  element: ShapeElement;
  sourceBounds: { left: number; top: number; right: number; bottom: number };
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function normalizedPoints(points: VectorPoint[]): Array<[number, number, number]> {
  if (points.length < 2) throw new Error("Pencil requires at least two points");
  return points.map((point, index) => [finite(point.x, `point ${index} x`), finite(point.y, `point ${index} y`), Math.max(0, Math.min(1, point.pressure ?? 0.5))]);
}

function bounds(points: Array<[number, number]>): { left: number; top: number; right: number; bottom: number } {
  if (!points.length) throw new Error("Cannot calculate empty vector bounds");
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

function fmt(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function local(point: [number, number], left: number, top: number): [number, number] {
  return [point[0] - left, point[1] - top];
}

/** Smooth a closed perfect-freehand outline using quadratic midpoints. */
function outlinePath(outline: Array<[number, number]>, left: number, top: number): string {
  if (outline.length < 3) throw new Error("Freehand outline is too small");
  const pts = outline.map((point) => local(point, left, top));
  const first = pts[0];
  let d = `M ${fmt(first[0])} ${fmt(first[1])}`;
  for (let i = 1; i < pts.length; i += 1) {
    const current = pts[i];
    const next = pts[(i + 1) % pts.length];
    const midX = (current[0] + next[0]) / 2;
    const midY = (current[1] + next[1]) / 2;
    d += ` Q ${fmt(current[0])} ${fmt(current[1])} ${fmt(midX)} ${fmt(midY)}`;
  }
  return `${d} Z`;
}

function baseShape(id: string, geometry: ShapeElement["geometry"], svgPath: string, style: VectorStyle): ShapeElement {
  return {
    id,
    type: "shape",
    name: style.name ?? "Vector",
    semanticRole: style.semanticRole ?? "visual",
    geometry,
    zIndex: style.zIndex ?? 1,
    origin: style.origin ?? "user",
    exportStrategy: "vector",
    dependencies: [],
    shape: "custom",
    fill: style.fill ?? "#111111",
    stroke: style.stroke,
    svgPath,
  };
}

export function buildFreehandVector(points: VectorPoint[], options: FreehandOptions = {}, style: VectorStyle = {}): BuiltVector {
  const input = normalizedPoints(points);
  const outline = getStroke(input, {
    size: Math.max(0.1, options.sizeDU ?? 18),
    thinning: options.thinning ?? 0.55,
    smoothing: options.smoothing ?? 0.55,
    streamline: options.streamline ?? 0.45,
    simulatePressure: options.simulatePressure ?? false,
    easing: options.easing,
    start: options.start,
    end: options.end,
  }) as Array<[number, number]>;
  if (outline.length < 3) throw new Error("Pencil stroke did not produce a valid outline");
  const box = bounds(outline);
  const width = Math.max(0.01, box.right - box.left);
  const height = Math.max(0.01, box.bottom - box.top);
  const svgPath = outlinePath(outline, box.left, box.top);
  return {
    element: baseShape(`vector_${randomUUID()}`, { x: box.left, y: box.top, width, height }, svgPath, { name: "Pencil stroke", ...style, fill: style.fill ?? "#111111" }),
    sourceBounds: box,
  };
}

function penBounds(anchors: PenAnchor[]): { left: number; top: number; right: number; bottom: number } {
  const points: Array<[number, number]> = [];
  anchors.forEach((anchor, index) => {
    points.push([finite(anchor.x, `anchor ${index} x`), finite(anchor.y, `anchor ${index} y`)]);
    if (anchor.in) points.push([finite(anchor.in.x, `anchor ${index} in.x`), finite(anchor.in.y, `anchor ${index} in.y`)]);
    if (anchor.out) points.push([finite(anchor.out.x, `anchor ${index} out.x`), finite(anchor.out.y, `anchor ${index} out.y`)]);
  });
  return bounds(points);
}

function segment(previous: PenAnchor, current: PenAnchor, left: number, top: number): string {
  const end = local([current.x, current.y], left, top);
  if (previous.out || current.in) {
    const c1 = local(previous.out ? [previous.out.x, previous.out.y] : [previous.x, previous.y], left, top);
    const c2 = local(current.in ? [current.in.x, current.in.y] : [current.x, current.y], left, top);
    return ` C ${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(end[0])} ${fmt(end[1])}`;
  }
  return ` L ${fmt(end[0])} ${fmt(end[1])}`;
}

export function buildPenVector(anchors: PenAnchor[], close = false, style: VectorStyle = {}): BuiltVector {
  if (anchors.length < 2) throw new Error("Pen requires at least two anchors");
  const box = penBounds(anchors);
  const width = Math.max(0.01, box.right - box.left);
  const height = Math.max(0.01, box.bottom - box.top);
  const start = local([anchors[0].x, anchors[0].y], box.left, box.top);
  let svgPath = `M ${fmt(start[0])} ${fmt(start[1])}`;
  for (let i = 1; i < anchors.length; i += 1) svgPath += segment(anchors[i - 1], anchors[i], box.left, box.top);
  if (close) svgPath += `${segment(anchors[anchors.length - 1], anchors[0], box.left, box.top)} Z`;
  const defaultStyle: VectorStyle = close
    ? { name: "Pen shape", fill: "#111111", ...style }
    : { name: "Pen path", fill: "transparent", stroke: style.stroke ?? { color: "#111111", widthDU: 3 }, ...style };
  return {
    element: baseShape(`vector_${randomUUID()}`, { x: box.left, y: box.top, width, height }, svgPath, defaultStyle),
    sourceBounds: box,
  };
}
