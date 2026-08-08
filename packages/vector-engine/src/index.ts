import { randomUUID } from "node:crypto";
import { getStroke } from "perfect-freehand";
import type { ShapeElement, VectorPathCommand, VectorPathData } from "../../deck-model/src/index.js";

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

export interface VectorAnchor {
  commandIndex: number;
  command: "M" | "L" | "C" | "Q";
  x: number;
  y: number;
  inHandle?: { x: number; y: number };
  outHandle?: { x: number; y: number };
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

export function validateVectorPathData(path: VectorPathData): void {
  if (!Array.isArray(path.commands) || path.commands.length === 0) throw new Error("Vector path requires at least one command");
  let active = false;
  path.commands.forEach((command, index) => {
    const check = (value: number, label: string) => finite(value, `command ${index} ${label}`);
    if (command.command === "M") {
      check(command.x, "x"); check(command.y, "y"); active = true; return;
    }
    if (command.command === "Z") {
      if (!active) throw new Error(`Close command ${index} has no active subpath`);
      active = false; return;
    }
    if (!active) throw new Error(`Command ${index} (${command.command}) must follow M`);
    if (command.command === "L") { check(command.x, "x"); check(command.y, "y"); return; }
    if (command.command === "Q") { check(command.x1, "x1"); check(command.y1, "y1"); check(command.x, "x"); check(command.y, "y"); return; }
    check(command.x1, "x1"); check(command.y1, "y1"); check(command.x2, "x2"); check(command.y2, "y2"); check(command.x, "x"); check(command.y, "y");
  });
}

export function vectorPathToSvg(path: VectorPathData): string {
  validateVectorPathData(path);
  return path.commands.map((command) => {
    if (command.command === "Z") return "Z";
    if (command.command === "M" || command.command === "L") return `${command.command} ${fmt(command.x)} ${fmt(command.y)}`;
    if (command.command === "Q") return `Q ${fmt(command.x1)} ${fmt(command.y1)} ${fmt(command.x)} ${fmt(command.y)}`;
    return `C ${fmt(command.x1)} ${fmt(command.y1)} ${fmt(command.x2)} ${fmt(command.y2)} ${fmt(command.x)} ${fmt(command.y)}`;
  }).join(" ");
}

export function effectiveVectorSvgPath(element: ShapeElement): string | undefined {
  if (element.shape !== "custom") return undefined;
  return element.pathData ? vectorPathToSvg(element.pathData) : element.svgPath;
}

export function vectorAnchors(path: VectorPathData): VectorAnchor[] {
  validateVectorPathData(path);
  const result: VectorAnchor[] = [];
  for (let index = 0; index < path.commands.length; index += 1) {
    const command = path.commands[index];
    if (command.command === "Z") continue;
    const next = path.commands[index + 1];
    const outHandle = next?.command === "C" || next?.command === "Q" ? { x: next.x1, y: next.y1 } : undefined;
    if (command.command === "C") result.push({ commandIndex: index, command: "C", x: command.x, y: command.y, inHandle: { x: command.x2, y: command.y2 }, outHandle });
    else if (command.command === "Q") result.push({ commandIndex: index, command: "Q", x: command.x, y: command.y, inHandle: { x: command.x1, y: command.y1 }, outHandle });
    else result.push({ commandIndex: index, command: command.command, x: command.x, y: command.y, outHandle });
  }
  return result;
}

export function moveVectorAnchor(path: VectorPathData, commandIndex: number, x: number, y: number, moveHandles = true): VectorPathData {
  validateVectorPathData(path);
  finite(x, "anchor x"); finite(y, "anchor y");
  const commands = structuredClone(path.commands);
  const command = commands[commandIndex];
  if (!command || command.command === "Z") throw new Error(`Command ${commandIndex} is not a movable vector anchor`);
  const dx = x - command.x;
  const dy = y - command.y;
  if (moveHandles) {
    if (command.command === "C") { command.x2 += dx; command.y2 += dy; }
    if (command.command === "Q") { command.x1 += dx; command.y1 += dy; }
    const next = commands[commandIndex + 1];
    if (next?.command === "C" || next?.command === "Q") { next.x1 += dx; next.y1 += dy; }
  }
  command.x = x;
  command.y = y;
  return { ...path, commands };
}

export function translateVectorPath(path: VectorPathData, dx: number, dy: number): VectorPathData {
  validateVectorPathData(path);
  finite(dx, "dx"); finite(dy, "dy");
  const commands = path.commands.map((command): VectorPathCommand => {
    if (command.command === "Z") return { command: "Z" };
    if (command.command === "M" || command.command === "L") return { ...command, x: command.x + dx, y: command.y + dy };
    if (command.command === "Q") return { ...command, x1: command.x1 + dx, y1: command.y1 + dy, x: command.x + dx, y: command.y + dy };
    return { ...command, x1: command.x1 + dx, y1: command.y1 + dy, x2: command.x2 + dx, y2: command.y2 + dy, x: command.x + dx, y: command.y + dy };
  });
  return { ...path, commands };
}

function outlinePathData(outline: Array<[number, number]>, left: number, top: number): VectorPathData {
  if (outline.length < 3) throw new Error("Freehand outline is too small");
  const pts = outline.map((point) => local(point, left, top));
  const commands: VectorPathCommand[] = [{ command: "M", x: pts[0][0], y: pts[0][1] }];
  for (let i = 1; i < pts.length; i += 1) {
    const current = pts[i];
    const next = pts[(i + 1) % pts.length];
    commands.push({ command: "Q", x1: current[0], y1: current[1], x: (current[0] + next[0]) / 2, y: (current[1] + next[1]) / 2 });
  }
  commands.push({ command: "Z" });
  return { fillRule: "nonzero", commands };
}

function baseShape(id: string, geometry: ShapeElement["geometry"], pathData: VectorPathData, style: VectorStyle): ShapeElement {
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
    pathData,
    svgPath: vectorPathToSvg(pathData),
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
  const pathData = outlinePathData(outline, box.left, box.top);
  return {
    element: baseShape(`vector_${randomUUID()}`, { x: box.left, y: box.top, width, height }, pathData, { name: "Pencil stroke", ...style, fill: style.fill ?? "#111111" }),
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

function penSegment(previous: PenAnchor, current: PenAnchor, left: number, top: number): VectorPathCommand {
  const end = local([current.x, current.y], left, top);
  if (previous.out || current.in) {
    const c1 = local(previous.out ? [previous.out.x, previous.out.y] : [previous.x, previous.y], left, top);
    const c2 = local(current.in ? [current.in.x, current.in.y] : [current.x, current.y], left, top);
    return { command: "C", x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], x: end[0], y: end[1] };
  }
  return { command: "L", x: end[0], y: end[1] };
}

export function buildPenVector(anchors: PenAnchor[], close = false, style: VectorStyle = {}): BuiltVector {
  if (anchors.length < 2) throw new Error("Pen requires at least two anchors");
  const box = penBounds(anchors);
  const width = Math.max(0.01, box.right - box.left);
  const height = Math.max(0.01, box.bottom - box.top);
  const start = local([anchors[0].x, anchors[0].y], box.left, box.top);
  const commands: VectorPathCommand[] = [{ command: "M", x: start[0], y: start[1] }];
  for (let i = 1; i < anchors.length; i += 1) commands.push(penSegment(anchors[i - 1], anchors[i], box.left, box.top));
  if (close) {
    commands.push(penSegment(anchors[anchors.length - 1], anchors[0], box.left, box.top));
    commands.push({ command: "Z" });
  }
  const pathData: VectorPathData = { fillRule: "nonzero", commands };
  const defaultStyle: VectorStyle = close
    ? { name: "Pen shape", fill: "#111111", ...style }
    : { name: "Pen path", fill: "transparent", stroke: style.stroke ?? { color: "#111111", widthDU: 3 }, ...style };
  return {
    element: baseShape(`vector_${randomUUID()}`, { x: box.left, y: box.top, width, height }, pathData, defaultStyle),
    sourceBounds: box,
  };
}
