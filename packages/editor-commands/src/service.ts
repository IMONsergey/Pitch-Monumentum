import type { DeckDocument, Geometry, SceneElement, SlideDocument, TextRun } from "../../deck-model/src/index.js";
import { autoLayoutMutationOperations } from "../../auto-layout/src/index.js";
import { applyDeckMutation, createMutation, type DeckMutationOperation } from "../../mutations/src/index.js";
import {
  alignSelection,
  arrangeSelection,
  copySelection,
  createFrameElement,
  createShapeElement,
  createTextElement,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  nudgeSelection,
  parentMap,
  pasteClipboard,
  selectionRoots,
  ungroupSelection,
  type AlignCommand,
  type ArrangeCommand,
  type DistributeCommand,
  type EditorCommandResult,
  type PitchClipboardPayload,
} from "./index.js";

export type EditorCommandInput =
  | { command: "nudge"; slideId: string; selectedIds: string[]; dx: number; dy: number }
  | { command: "align"; slideId: string; selectedIds: string[]; alignment: AlignCommand }
  | { command: "distribute"; slideId: string; selectedIds: string[]; axis: DistributeCommand }
  | { command: "duplicate"; slideId: string; selectedIds: string[]; offsetDU?: number }
  | { command: "delete"; slideId: string; selectedIds: string[] }
  | { command: "group"; slideId: string; selectedIds: string[]; groupId?: string }
  | { command: "ungroup"; slideId: string; selectedIds: string[] }
  | { command: "arrange"; slideId: string; selectedIds: string[]; arrangement: ArrangeCommand }
  | { command: "copy"; slideId: string; selectedIds: string[] }
  | { command: "paste"; slideId: string; clipboard: PitchClipboardPayload; offsetDU?: number }
  | { command: "lock"; slideId: string; selectedIds: string[]; locked: boolean }
  | { command: "setGeometry"; slideId: string; elementId: string; geometry: Partial<Geometry> }
  | { command: "setPresentation"; slideId: string; elementId: string; changes: { name?: string; opacity?: number; locked?: boolean } }
  | { command: "setTextStyle"; slideId: string; elementId: string; style: Partial<Pick<TextRun, "fontFamily" | "fontSizePt" | "color" | "bold" | "italic" | "underline" | "letterSpacingPt">> }
  | { command: "insertText"; slideId: string; geometry: Geometry; text?: string }
  | { command: "insertShape"; slideId: string; geometry: Geometry; shape?: "rect" | "roundRect" | "ellipse" | "triangle"; fill?: string }
  | { command: "insertFrame"; slideId: string; geometry: Geometry; fill?: string };

export interface ExecutedEditorCommand {
  reason: string;
  operations: DeckMutationOperation[];
  nextSelectionIds: string[];
  reflowedContainerIds: string[];
  clipboard?: PitchClipboardPayload;
}

function slideById(deck: DeckDocument, slideId: string): SlideDocument {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  return slide;
}

function elementById(slide: SlideDocument, elementId: string): SceneElement {
  const element = slide.scene.find((item) => item.id === elementId);
  if (!element) throw new Error(`Unknown element ${elementId} on slide ${slide.id}`);
  return element;
}

function maxZ(slide: SlideDocument): number {
  return Math.max(0, ...slide.scene.map((element) => element.zIndex));
}

function resultForInsert(element: SceneElement): EditorCommandResult {
  return {
    operations: [{ op: "addElement", slideId: "", element }],
    nextSelectionIds: [element.id],
    affectedAutoLayoutContainerIds: [],
  };
}

function layoutParentIds(slide: SlideDocument, elementId: string): string[] {
  const parentId = parentMap(slide).get(elementId);
  if (!parentId) return [];
  const parent = slide.scene.find((element) => element.id === parentId);
  return parent && (parent.type === "frame" || parent.type === "group") && parent.layout ? [parentId] : [];
}

function finiteGeometryPatch(patch: Partial<Geometry>): Partial<Geometry> {
  const result: Partial<Geometry> = {};
  for (const key of ["x", "y", "width", "height", "rotation"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) throw new Error(`${key} must be finite`);
    if ((key === "width" || key === "height") && value <= 0) throw new Error(`${key} must be greater than zero`);
    result[key] = value;
  }
  return result;
}

function dispatch(slide: SlideDocument, input: Exclude<EditorCommandInput, { command: "copy" }>): EditorCommandResult {
  switch (input.command) {
    case "nudge": return nudgeSelection(slide, input.selectedIds, input.dx, input.dy);
    case "align": return alignSelection(slide, input.selectedIds, input.alignment);
    case "distribute": return distributeSelection(slide, input.selectedIds, input.axis);
    case "duplicate": return duplicateSelection(slide, input.selectedIds, input.offsetDU);
    case "delete": return deleteSelection(slide, input.selectedIds);
    case "group": return groupSelection(slide, input.selectedIds, input.groupId);
    case "ungroup": return ungroupSelection(slide, input.selectedIds);
    case "arrange": return arrangeSelection(slide, input.selectedIds, input.arrangement);
    case "paste": return pasteClipboard(slide, input.clipboard, input.offsetDU);
    case "lock": {
      const roots = selectionRoots(slide, input.selectedIds);
      return {
        operations: roots.map((elementId) => ({ op: "updateElementPresentation" as const, slideId: slide.id, elementId, changes: { locked: input.locked } })),
        nextSelectionIds: input.locked ? [] : roots,
        affectedAutoLayoutContainerIds: [],
      };
    }
    case "setGeometry": {
      elementById(slide, input.elementId);
      return {
        operations: [{ op: "updateGeometry", slideId: slide.id, elementId: input.elementId, geometry: finiteGeometryPatch(input.geometry) }],
        nextSelectionIds: [input.elementId],
        affectedAutoLayoutContainerIds: layoutParentIds(slide, input.elementId),
      };
    }
    case "setPresentation": {
      elementById(slide, input.elementId);
      const changes = { ...input.changes };
      if (changes.opacity !== undefined) {
        if (!Number.isFinite(changes.opacity)) throw new Error("opacity must be finite");
        changes.opacity = Math.max(0, Math.min(1, changes.opacity));
      }
      return {
        operations: [{ op: "updateElementPresentation", slideId: slide.id, elementId: input.elementId, changes }],
        nextSelectionIds: changes.locked ? [] : [input.elementId],
        affectedAutoLayoutContainerIds: [],
      };
    }
    case "setTextStyle": {
      const element = elementById(slide, input.elementId);
      if (element.type !== "text") throw new Error(`Element ${input.elementId} is not text`);
      if (input.style.fontSizePt !== undefined && (!Number.isFinite(input.style.fontSizePt) || input.style.fontSizePt <= 0)) throw new Error("fontSizePt must be greater than zero");
      if (input.style.letterSpacingPt !== undefined && !Number.isFinite(input.style.letterSpacingPt)) throw new Error("letterSpacingPt must be finite");
      const paragraphs = element.paragraphs.map((paragraph) => ({
        ...paragraph,
        runs: paragraph.runs.map((run) => ({ ...run, ...input.style })),
      }));
      return {
        operations: [{ op: "replaceText", slideId: slide.id, elementId: input.elementId, paragraphs }],
        nextSelectionIds: [input.elementId],
        affectedAutoLayoutContainerIds: layoutParentIds(slide, input.elementId),
      };
    }
    case "insertText": {
      const element = createTextElement({ geometry: input.geometry, zIndex: maxZ(slide) + 1, paragraphs: [{ runs: [{ text: input.text ?? "Text", fontSizePt: 24, color: "#111111" }] }] });
      return resultForInsert(element);
    }
    case "insertShape": {
      const element = createShapeElement({ geometry: input.geometry, zIndex: maxZ(slide) + 1, shape: input.shape ?? "rect", fill: input.fill ?? "#E9EDF2" });
      return resultForInsert(element);
    }
    case "insertFrame": {
      const element = createFrameElement({ geometry: input.geometry, zIndex: maxZ(slide) + 1, fill: input.fill });
      return resultForInsert(element);
    }
  }
}

function reasonFor(input: EditorCommandInput): string {
  switch (input.command) {
    case "nudge": return `Nudge selection ${input.dx},${input.dy}`;
    case "align": return `Align selection ${input.alignment}`;
    case "distribute": return `Distribute selection ${input.axis}`;
    case "duplicate": return "Duplicate selection";
    case "delete": return "Delete selection";
    case "group": return "Group selection";
    case "ungroup": return "Ungroup selection";
    case "arrange": return `Arrange selection ${input.arrangement}`;
    case "copy": return "Copy Pitch selection";
    case "paste": return "Paste Pitch clipboard";
    case "lock": return input.locked ? "Lock selection" : "Unlock selection";
    case "setGeometry": return `Set geometry ${input.elementId}`;
    case "setPresentation": return `Set presentation ${input.elementId}`;
    case "setTextStyle": return `Set text style ${input.elementId}`;
    case "insertText": return "Insert text";
    case "insertShape": return "Insert shape";
    case "insertFrame": return "Insert frame";
  }
}

export function executeEditorCommand(deck: DeckDocument, input: EditorCommandInput): ExecutedEditorCommand {
  const slide = slideById(deck, input.slideId);

  if (input.command === "copy") {
    const clipboard = copySelection(slide, input.selectedIds);
    return { reason: reasonFor(input), operations: [], nextSelectionIds: clipboard.rootIds, reflowedContainerIds: [], clipboard };
  }

  const command = dispatch(slide, input);
  const operations = command.operations.map((operation) => operation.op === "addElement" ? { ...operation, slideId: input.slideId } : operation);
  if (!operations.length) return { reason: reasonFor(input), operations: [], nextSelectionIds: command.nextSelectionIds, reflowedContainerIds: [] };

  const preview = applyDeckMutation(deck, createMutation(`Preview ${reasonFor(input)}`, operations, "deterministic")).deck;
  const previewSlide = slideById(preview, input.slideId);
  const reflowedContainerIds: string[] = [];
  const reflowOperations: DeckMutationOperation[] = [];

  for (const containerId of [...new Set(command.affectedAutoLayoutContainerIds)]) {
    const container = previewSlide.scene.find((element) => element.id === containerId);
    if (!container || (container.type !== "frame" && container.type !== "group") || !container.layout) continue;
    reflowOperations.push(...autoLayoutMutationOperations(previewSlide, containerId));
    reflowedContainerIds.push(containerId);
  }

  return { reason: reasonFor(input), operations: [...operations, ...reflowOperations], nextSelectionIds: command.nextSelectionIds, reflowedContainerIds };
}
