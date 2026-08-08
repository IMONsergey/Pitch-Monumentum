import type { ShapeElement, SlideDocument, VectorPathData } from "../../deck-model/src/index.js";
import type { DeckMutationOperation } from "../../mutations/src/index.js";
import { moveVectorHandle as canonicalMoveVectorHandle, validateVectorPathData } from "../../vector-path/src/index.js";

export type VectorHandleKind = "in" | "out";

/** @deprecated Use moveVectorHandle from packages/vector-path. */
export const moveVectorHandle = canonicalMoveVectorHandle;

/**
 * @deprecated Live editor code now uses EditorCommandService.setVectorPath, which
 * preserves stable IDs and supports fit-bounds/Auto Layout. This helper is retained
 * only for compatibility with older tests or callers.
 */
export function replaceVectorPathOperations(slide: SlideDocument, elementId: string, pathData: VectorPathData): DeckMutationOperation[] {
  validateVectorPathData(pathData);
  const element = slide.scene.find((item) => item.id === elementId);
  if (!element || element.type !== "shape" || element.shape !== "custom") throw new Error(`Element ${elementId} is not an editable custom vector`);
  return [{ op: "updateVectorPath", slideId: slide.id, elementId, pathData: structuredClone(pathData) }];
}

export function isStructuredVector(element: SlideDocument["scene"][number]): element is ShapeElement & { shape: "custom"; pathData: VectorPathData } {
  return element.type === "shape" && element.shape === "custom" && Boolean(element.pathData);
}
