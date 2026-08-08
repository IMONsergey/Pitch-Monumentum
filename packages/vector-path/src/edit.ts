import type { VectorPathCommand, VectorPathData } from "../../deck-model/src/index.js";
import { validateVectorPathData } from "./index.js";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function point(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function endpoint(command: VectorPathCommand): { x: number; y: number } | undefined {
  return command.command === "Z" ? undefined : { x: command.x, y: command.y };
}

function previousPoint(commands: VectorPathCommand[], commandIndex: number): { x: number; y: number } {
  for (let index = commandIndex - 1; index >= 0; index -= 1) {
    const value = endpoint(commands[index]);
    if (value) return value;
  }
  throw new Error(`Segment ${commandIndex} has no previous anchor`);
}

export function deleteVectorAnchor(path: VectorPathData, commandIndex: number): VectorPathData {
  validateVectorPathData(path);
  const commands = structuredClone(path.commands);
  const target = commands[commandIndex];
  if (!target || target.command === "Z") throw new Error(`Command ${commandIndex} is not a deletable anchor`);
  const anchors = commands.filter((command) => command.command !== "Z");
  if (anchors.length <= 2) throw new Error("A vector path needs at least two anchors");

  if (target.command === "M") {
    const nextIndex = commands.findIndex((command, index) => index > commandIndex && command.command !== "Z");
    if (nextIndex < 0) throw new Error("Cannot delete the only move anchor in a subpath");
    const next = commands[nextIndex];
    if (next.command === "Z") throw new Error("Cannot promote close command to move anchor");
    commands[nextIndex] = { command: "M", x: next.x, y: next.y };
    commands.splice(commandIndex, 1);
  } else {
    commands.splice(commandIndex, 1);
  }

  const result: VectorPathData = { ...path, commands };
  validateVectorPathData(result);
  return result;
}

export function splitVectorSegment(path: VectorPathData, commandIndex: number, t = 0.5): VectorPathData {
  validateVectorPathData(path);
  if (!Number.isFinite(t) || t <= 0 || t >= 1) throw new Error("Split t must be between 0 and 1");
  const commands = structuredClone(path.commands);
  const segment = commands[commandIndex];
  if (!segment || segment.command === "M" || segment.command === "Z") throw new Error(`Command ${commandIndex} is not a splittable segment`);
  const p0 = previousPoint(commands, commandIndex);

  if (segment.command === "L") {
    const mid = point(p0, { x: segment.x, y: segment.y }, t);
    commands.splice(commandIndex, 1,
      { command: "L", x: mid.x, y: mid.y },
      { command: "L", x: segment.x, y: segment.y },
    );
  } else if (segment.command === "Q") {
    const p1 = { x: segment.x1, y: segment.y1 };
    const p2 = { x: segment.x, y: segment.y };
    const p01 = point(p0, p1, t);
    const p12 = point(p1, p2, t);
    const mid = point(p01, p12, t);
    commands.splice(commandIndex, 1,
      { command: "Q", x1: p01.x, y1: p01.y, x: mid.x, y: mid.y },
      { command: "Q", x1: p12.x, y1: p12.y, x: p2.x, y: p2.y },
    );
  } else {
    const p1 = { x: segment.x1, y: segment.y1 };
    const p2 = { x: segment.x2, y: segment.y2 };
    const p3 = { x: segment.x, y: segment.y };
    const p01 = point(p0, p1, t);
    const p12 = point(p1, p2, t);
    const p23 = point(p2, p3, t);
    const p012 = point(p01, p12, t);
    const p123 = point(p12, p23, t);
    const mid = point(p012, p123, t);
    commands.splice(commandIndex, 1,
      { command: "C", x1: p01.x, y1: p01.y, x2: p012.x, y2: p012.y, x: mid.x, y: mid.y },
      { command: "C", x1: p123.x, y1: p123.y, x2: p23.x, y2: p23.y, x: p3.x, y: p3.y },
    );
  }

  const result: VectorPathData = { ...path, commands };
  validateVectorPathData(result);
  return result;
}
