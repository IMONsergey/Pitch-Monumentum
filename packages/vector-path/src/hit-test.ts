import type { VectorPathData } from "../../deck-model/src/index.js";
import { validateVectorPathData } from "./index.js";

export interface VectorSegmentHit {
  commandIndex: number;
  t: number;
  x: number;
  y: number;
  distance: number;
}

function linePoint(p0: { x: number; y: number }, p1: { x: number; y: number }, t: number) {
  return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
}

function quadPoint(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, t: number) {
  const mt = 1 - t;
  return { x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x, y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y };
}

function cubicPoint(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, t: number) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t ** 3 * p3.y,
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearestVectorSegment(path: VectorPathData, target: { x: number; y: number }, samples = 32): VectorSegmentHit | undefined {
  validateVectorPathData(path);
  let current = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };
  let best: VectorSegmentHit | undefined;
  const steps = Math.max(8, Math.min(128, Math.round(samples)));

  for (let commandIndex = 0; commandIndex < path.commands.length; commandIndex += 1) {
    const command = path.commands[commandIndex];
    if (command.command === "M") {
      current = { x: command.x, y: command.y };
      subpathStart = { ...current };
      continue;
    }
    if (command.command === "Z") {
      current = { ...subpathStart };
      continue;
    }
    const start = { ...current };
    const pointAt = (t: number) => command.command === "L"
      ? linePoint(start, command, t)
      : command.command === "Q"
        ? quadPoint(start, { x: command.x1, y: command.y1 }, command, t)
        : cubicPoint(start, { x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }, command, t);

    let localBestT = 0;
    let localBestPoint = pointAt(0);
    let localBestDistance = distance(localBestPoint, target);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const point = pointAt(t);
      const d = distance(point, target);
      if (d < localBestDistance) { localBestDistance = d; localBestT = t; localBestPoint = point; }
    }

    // Refine around the best sample using a small ternary search.
    let left = Math.max(0.001, localBestT - 1 / steps);
    let right = Math.min(0.999, localBestT + 1 / steps);
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const t1 = left + (right - left) / 3;
      const t2 = right - (right - left) / 3;
      if (distance(pointAt(t1), target) <= distance(pointAt(t2), target)) right = t2;
      else left = t1;
    }
    const t = (left + right) / 2;
    const p = pointAt(t);
    const d = distance(p, target);
    if (!best || d < best.distance) best = { commandIndex, t, x: p.x, y: p.y, distance: d };
    current = { x: command.x, y: command.y };
  }
  return best;
}
