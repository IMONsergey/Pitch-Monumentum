import type { Geometry, VectorPathData } from "../../deck-model/src/index.js";
import { vectorPathBounds as canonicalVectorPathBounds } from "../../vector-path/src/index.js";

/** @deprecated Import vectorPathBounds from @pitch/vector-path instead. */
export const vectorPathBounds = canonicalVectorPathBounds;

/**
 * Legacy convenience shape used by early vector editor tests. Kept as a thin helper;
 * all geometry math lives in packages/vector-path.
 */
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
