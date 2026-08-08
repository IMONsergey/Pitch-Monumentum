import { randomUUID } from "node:crypto";
import type { Geometry, ShapeElement, SlideDocument } from "../../deck-model/src/index.js";
import type { DeckMutationOperation } from "../../mutations/src/index.js";

export interface InsertVectorInput {
  geometry: Geometry;
  svgPath: string;
  fill?: string;
  stroke?: { color: string; widthDU: number; dash?: "solid" | "dash" | "dot" };
  name?: string;
  semanticRole?: ShapeElement["semanticRole"];
  origin?: ShapeElement["origin"];
}

export interface InsertVectorResult {
  element: ShapeElement;
  operations: DeckMutationOperation[];
  nextSelectionIds: string[];
}

function validateGeometry(geometry: Geometry): Geometry {
  const next = { ...geometry };
  for (const key of ["x", "y", "width", "height", "rotation"] as const) {
    const value = next[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) throw new Error(`Vector ${key} must be finite`);
    if ((key === "width" || key === "height") && value <= 0) throw new Error(`Vector ${key} must be greater than zero`);
  }
  return next;
}

function validatePath(svgPath: string): string {
  const path = svgPath.trim();
  if (!path) throw new Error("Vector svgPath is required");
  if (!/^[Mm]\s*[-+\d.]/.test(path)) throw new Error("Vector svgPath must begin with an SVG move command");
  if (/<|>|script|javascript:/i.test(path)) throw new Error("Vector svgPath contains invalid markup or script content");
  return path;
}

export function buildInsertVectorCommand(slide: SlideDocument, input: InsertVectorInput): InsertVectorResult {
  const geometry = validateGeometry(input.geometry);
  const svgPath = validatePath(input.svgPath);
  if (input.stroke) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(input.stroke.color)) throw new Error("Vector stroke color must be #RRGGBB");
    if (!Number.isFinite(input.stroke.widthDU) || input.stroke.widthDU < 0) throw new Error("Vector stroke width must be a non-negative number");
  }
  const fill = input.fill ?? "transparent";
  if (fill !== "transparent" && !/^#[0-9A-Fa-f]{6}$/.test(fill)) throw new Error("Vector fill must be transparent or #RRGGBB");
  const element: ShapeElement = {
    id: `vector_${randomUUID()}`,
    type: "shape",
    name: input.name?.trim() || "Vector",
    semanticRole: input.semanticRole ?? "visual",
    geometry,
    zIndex: Math.max(0, ...slide.scene.map((item) => item.zIndex)) + 1,
    origin: input.origin ?? "user",
    exportStrategy: "vector",
    dependencies: [],
    shape: "custom",
    fill,
    stroke: input.stroke,
    svgPath,
  };
  return {
    element,
    operations: [{ op: "addElement", slideId: slide.id, element }],
    nextSelectionIds: [element.id],
  };
}
