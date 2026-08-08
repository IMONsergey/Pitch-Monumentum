import type { Paint, ShapeElement, StrokeStyle, VectorPathData, VisualEffect } from "../../deck-model/src/index.js";
import { validateEffects, validatePaint } from "../../mutations/src/index.js";
import { validateVectorPathData, vectorPathBounds, vectorPathToSvg } from "../../vector-path/src/index.js";

export interface VectorExchangeV1 {
  schemaVersion: "1";
  source: "pitch";
  id: string;
  name: string;
  widthDU: number;
  heightDU: number;
  pathData: VectorPathData;
  svgPath: string;
  fillPaint?: Paint;
  legacyFill?: string;
  stroke?: StrokeStyle;
  effects?: VisualEffect[];
}

export function vectorToExchange(element: ShapeElement): VectorExchangeV1 {
  if (element.shape !== "custom" || !element.pathData) throw new Error(`Element ${element.id} is not a structured vector`);
  validateVectorPathData(element.pathData);
  if (element.fillPaint) validatePaint(element.fillPaint);
  if (element.effects) validateEffects(element.effects);
  const bounds = vectorPathBounds(element.pathData);
  return {
    schemaVersion: "1",
    source: "pitch",
    id: element.id,
    name: element.name ?? element.id,
    widthDU: Math.max(.01, element.geometry.width || bounds.width),
    heightDU: Math.max(.01, element.geometry.height || bounds.height),
    pathData: structuredClone(element.pathData),
    svgPath: vectorPathToSvg(element.pathData),
    fillPaint: element.fillPaint ? structuredClone(element.fillPaint) : undefined,
    legacyFill: element.fill,
    stroke: element.stroke ? structuredClone(element.stroke) : undefined,
    effects: element.effects ? structuredClone(element.effects) : undefined,
  };
}

export function validateVectorExchange(value: VectorExchangeV1): void {
  if (value.schemaVersion !== "1" || value.source !== "pitch") throw new Error("Unsupported vector exchange format");
  if (!value.id || !value.name) throw new Error("Vector exchange id and name are required");
  if (!Number.isFinite(value.widthDU) || value.widthDU <= 0 || !Number.isFinite(value.heightDU) || value.heightDU <= 0) throw new Error("Vector exchange dimensions must be positive");
  validateVectorPathData(value.pathData);
  if (value.fillPaint) validatePaint(value.fillPaint);
  if (value.effects) validateEffects(value.effects);
  if (value.stroke && (!Number.isFinite(value.stroke.widthDU) || value.stroke.widthDU < 0)) throw new Error("Vector exchange stroke width is invalid");
}

export function exchangeToVector(value: VectorExchangeV1, geometry: { x: number; y: number; width?: number; height?: number }, options: { id?: string; origin?: ShapeElement["origin"]; zIndex?: number } = {}): ShapeElement {
  validateVectorExchange(value);
  const id = options.id ?? value.id;
  return {
    id,
    type: "shape",
    shape: "custom",
    name: value.name,
    semanticRole: "visual",
    geometry: {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width ?? value.widthDU,
      height: geometry.height ?? value.heightDU,
    },
    zIndex: options.zIndex ?? 1,
    origin: options.origin ?? "import",
    exportStrategy: "vector",
    dependencies: [],
    pathData: structuredClone(value.pathData),
    svgPath: vectorPathToSvg(value.pathData),
    fillPaint: value.fillPaint ? structuredClone(value.fillPaint) : undefined,
    fill: value.legacyFill,
    stroke: value.stroke ? structuredClone(value.stroke) : undefined,
    effects: value.effects ? structuredClone(value.effects) : undefined,
  };
}

export function vectorExchangeToSvg(value: VectorExchangeV1): string {
  validateVectorExchange(value);
  const bounds = vectorPathBounds(value.pathData);
  const fill = value.fillPaint?.kind === "solid"
    ? value.fillPaint.color
    : value.fillPaint?.kind === "none"
      ? "none"
      : value.legacyFill && value.legacyFill !== "transparent" ? value.legacyFill : "none";
  const fillOpacity = value.fillPaint?.kind === "solid" ? value.fillPaint.opacity ?? 1 : 1;
  const stroke = value.stroke?.color ?? "none";
  const strokeWidth = value.stroke?.widthDU ?? 0;
  const dash = value.stroke?.dash === "dash"
    ? `${Math.max(1, strokeWidth * 4)} ${Math.max(1, strokeWidth * 2)}`
    : value.stroke?.dash === "dot"
      ? `${Math.max(1, strokeWidth)} ${Math.max(1, strokeWidth * 1.5)}`
      : undefined;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.left} ${bounds.top} ${Math.max(.01, bounds.width)} ${Math.max(.01, bounds.height)}"><path d="${vectorPathToSvg(value.pathData)}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash ? ` stroke-dasharray="${dash}"` : ""} stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
