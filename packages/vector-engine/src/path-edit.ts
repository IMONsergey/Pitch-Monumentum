import type { ShapeElement, SlideDocument, VectorPathData } from "../../deck-model/src/index.js";
import type { DeckMutationOperation } from "../../mutations/src/index.js";
import { validateVectorPathData, vectorPathToSvg } from "./index.js";

export type VectorHandleKind = "in" | "out";

export function moveVectorHandle(
  path: VectorPathData,
  anchorCommandIndex: number,
  kind: VectorHandleKind,
  x: number,
  y: number,
): VectorPathData {
  validateVectorPathData(path);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Vector handle coordinates must be finite");
  const commands = structuredClone(path.commands);
  const command = commands[anchorCommandIndex];
  if (!command || command.command === "Z") throw new Error(`Command ${anchorCommandIndex} is not an anchor`);

  if (kind === "in") {
    if (command.command === "C") {
      command.x2 = x;
      command.y2 = y;
    } else if (command.command === "Q") {
      command.x1 = x;
      command.y1 = y;
    } else {
      throw new Error(`Anchor ${anchorCommandIndex} has no incoming editable handle`);
    }
  } else {
    const next = commands[anchorCommandIndex + 1];
    if (next?.command === "C" || next?.command === "Q") {
      next.x1 = x;
      next.y1 = y;
    } else {
      throw new Error(`Anchor ${anchorCommandIndex} has no outgoing editable handle`);
    }
  }
  return { ...path, commands };
}

function parentOf(slide: SlideDocument, elementId: string): Extract<SlideDocument["scene"][number], { type: "frame" | "group" }> | undefined {
  return slide.scene.find((element): element is Extract<SlideDocument["scene"][number], { type: "frame" | "group" }> =>
    (element.type === "frame" || element.type === "group") && element.childIds.includes(elementId));
}

export function replaceVectorPathOperations(slide: SlideDocument, elementId: string, pathData: VectorPathData): DeckMutationOperation[] {
  validateVectorPathData(pathData);
  const element = slide.scene.find((item) => item.id === elementId);
  if (!element || element.type !== "shape" || element.shape !== "custom") throw new Error(`Element ${elementId} is not an editable custom vector`);
  const parent = parentOf(slide, elementId);
  const replacement: ShapeElement = {
    ...structuredClone(element),
    pathData: structuredClone(pathData),
    svgPath: vectorPathToSvg(pathData),
  };

  const operations: DeckMutationOperation[] = [
    { op: "removeElement", slideId: slide.id, elementId },
    { op: "addElement", slideId: slide.id, element: replacement },
  ];
  if (parent) operations.push({ op: "updateContainerChildren", slideId: slide.id, elementId: parent.id, childIds: [...parent.childIds] });
  return operations;
}
