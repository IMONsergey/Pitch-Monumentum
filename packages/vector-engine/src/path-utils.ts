import type { Geometry, VectorPathData } from "../../deck-model/src/index.js";
import { validateVectorPathData } from "./index.js";

export interface VectorPathBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function vectorPathBounds(path: VectorPathData): VectorPathBounds {
  validateVectorPathData(path);
  const points: Array<[number, number]> = [];
  for (const command of path.commands) {
    if (command.command === "Z") continue;
    points.push([command.x, command.y]);
    if (command.command === "Q" || command.command === "C") points.push([command.x1, command.y1]);
    if (command.command === "C") points.push([command.x2, command.y2]);
  }
  if (!points.length) throw new Error("Vector path has no measurable points");
  const left = Math.min(...points.map(([x]) => x));
  const top = Math.min(...points.map(([, y]) => y));
  const right = Math.max(...points.map(([x]) => x));
  const bottom = Math.max(...points.map(([, y]) => y));
  return { left, top, right, bottom, width: Math.max(0.001, right - left), height: Math.max(0.001, bottom - top) };
}

export function defaultVectorPath(geometry: Pick<Geometry, "width" | "height">): VectorPathData {
  const width = Math.max(1, geometry.width);
  const height = Math.max(1, geometry.height);
  return {
    fillRule: "nonzero",
    commands: [
      { command: "M", x: width * 0.5, y: 0 },
      { command: "C", x1: width * 0.82, y1: 0, x2: width, y2: height * 0.18, x: width, y: height * 0.5 },
      { command: "C", x1: width, y1: height * 0.82, x2: width * 0.82, y2: height, x: width * 0.5, y: height },
      { command: "C", x1: width * 0.18, y1: height, x2: 0, y2: height * 0.82, x: 0, y: height * 0.5 },
      { command: "C", x1: 0, y1: height * 0.18, x2: width * 0.18, y2: 0, x: width * 0.5, y: 0 },
      { command: "Z" },
    ],
  };
}
