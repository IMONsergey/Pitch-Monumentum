import type { Paint, ShapeElement, StrokeStyle, VisualEffect } from "../../deck-model/src/index.js";
import { validateVectorPathData, vectorPathBounds, vectorPathToSvg } from "../../vector-path/src/index.js";

export interface FigmaVectorPathPayload {
  windingRule: "EVENODD" | "NONZERO";
  data: string;
}

export interface FigmaVectorPayload {
  pitchId: string;
  name: string;
  width: number;
  height: number;
  vectorPaths: FigmaVectorPathPayload[];
  fillPaint?: Paint;
  legacyFill?: string;
  stroke?: StrokeStyle;
  effects?: VisualEffect[];
}

export function pitchVectorToFigmaPayload(element: ShapeElement): FigmaVectorPayload {
  if (element.shape !== "custom" || !element.pathData) throw new Error(`Element ${element.id} is not a structured vector`);
  validateVectorPathData(element.pathData);
  const bounds = vectorPathBounds(element.pathData);
  return {
    pitchId: element.id,
    name: element.name ?? element.id,
    width: Math.max(.01, element.geometry.width || bounds.width),
    height: Math.max(.01, element.geometry.height || bounds.height),
    vectorPaths: [{
      windingRule: element.pathData.fillRule === "evenodd" ? "EVENODD" : "NONZERO",
      data: vectorPathToSvg(element.pathData),
    }],
    fillPaint: element.fillPaint ? structuredClone(element.fillPaint) : undefined,
    legacyFill: element.fill,
    stroke: element.stroke ? structuredClone(element.stroke) : undefined,
    effects: element.effects ? structuredClone(element.effects) : undefined,
  };
}
