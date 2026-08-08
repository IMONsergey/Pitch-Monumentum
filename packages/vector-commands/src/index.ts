import { randomUUID } from "node:crypto";
import type { Geometry, ShapeElement, SlideDocument, VectorPathData } from "../../deck-model/src/index.js";
import type { DeckMutationOperation } from "../../mutations/src/index.js";
import { parseSvgPathData, validateVectorPathData, vectorPathToSvg } from "../../vector-path/src/index.js";

export interface InsertVectorInput {
  geometry: Geometry;
  pathData?: VectorPathData;
  /** Legacy compatibility source. Parsed to pathData when Vector Engine v1 supports it. */
  svgPath?: string;
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

function safeLegacyPath(svgPath: string): string {
  const path = svgPath.trim();
  if (!path) throw new Error("Vector pathData or svgPath is required");
  if (!/^[Mm]\s*[-+\d.]/.test(path)) throw new Error("Vector svgPath must begin with an SVG move command");
  if (/<|>|script|javascript:/i.test(path)) throw new Error("Vector svgPath contains invalid markup or script content");
  return path;
}

function resolvePath(input: InsertVectorInput): { pathData?: VectorPathData; svgPath: string } {
  if (input.pathData) {
    validateVectorPathData(input.pathData);
    const pathData = structuredClone(input.pathData);
    return { pathData, svgPath: vectorPathToSvg(pathData) };
  }
  const svgPath = safeLegacyPath(input.svgPath ?? "");
  try {
    const pathData = parseSvgPathData(svgPath);
    return { pathData, svgPath: vectorPathToSvg(pathData) };
  } catch (error) {
    // Arc/unsupported SVG remains a deliberate legacy vector rather than being
    // silently approximated into an editable structured path.
    if (error instanceof Error && /arc commands|Unsupported SVG path command/.test(error.message)) return { svgPath };
    throw error;
  }
}

export function buildInsertVectorCommand(slide: SlideDocument, input: InsertVectorInput): InsertVectorResult {
  const geometry = validateGeometry(input.geometry);
  const resolved = resolvePath(input);
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
    pathData: resolved.pathData,
    svgPath: resolved.svgPath,
  };
  return {
    element,
    operations: [{ op: "addElement", slideId: slide.id, element }],
    nextSelectionIds: [element.id],
  };
}
