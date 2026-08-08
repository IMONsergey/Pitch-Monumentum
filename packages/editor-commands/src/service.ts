import type { DeckDocument, Geometry, SceneElement, SlideDocument, TextRun } from "../../deck-model/src/index.js";
import { autoLayoutMutationOperations } from "../../auto-layout/src/index.js";
import { applyDeckMutation, createMutation, type DeckMutationOperation, type ElementStylePatch } from "../../mutations/src/index.js";
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

type TextStylePatch = Partial<Pick<TextRun, "fontFamily" | "fontSizePt" | "color" | "bold" | "italic" | "underline" | "letterSpacingPt">>;
type PresentationPatch = { name?: string; opacity?: number; locked?: boolean };

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
  | { command: "setPresentation"; slideId: string; elementId: string; changes: PresentationPatch }
  | { command: "setTextStyle"; slideId: string; elementId: string; style: TextStylePatch }
  | { command: "setStyle"; slideId: string; elementId: string; style: ElementStylePatch }
  | { command: "setInspector"; slideId: string; elementId: string; geometry?: Partial<Geometry>; presentation?: PresentationPatch; textStyle?: TextStylePatch; style?: ElementStylePatch }
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

function presentationPatch(patch: PresentationPatch): PresentationPatch {
  const changes = { ...patch };
  if (changes.opacity !== undefined) {
    if (!Number.isFinite(changes.opacity)) throw new Error("opacity must be finite");
    changes.opacity = Math.max(0, Math.min(1, changes.opacity));
  }
  return changes;
}

function validateStroke(stroke: { color: string; widthDU: number } | null | undefined): void {
  if (!stroke) return;
  if (!Number.isFinite(stroke.widthDU) || stroke.widthDU < 0) throw new Error("stroke widthDU must be zero or greater");
  if (!stroke.color) throw new Error("stroke color is required");
}

function stylePatch(element: SceneElement, style: ElementStylePatch): ElementStylePatch {
  if (style.kind !== element.type) throw new Error(`Style kind ${style.kind} does not match ${element.type} element ${element.id}`);
  if (style.kind === "shape" || style.kind === "frame") {
    validateStroke(style.stroke);
    if (style.radiusDU !== undefined && style.radiusDU !== null && (!Number.isFinite(style.radiusDU) || style.radiusDU < 0)) throw new Error("radiusDU must be zero or greater");
  } else if (style.kind === "image") {
    if (style.cornerRadiusDU !== undefined && style.cornerRadiusDU !== null && (!Number.isFinite(style.cornerRadiusDU) || style.cornerRadiusDU < 0)) throw new Error("cornerRadiusDU must be zero or greater");
  } else {
    validateStroke(style.stroke);
  }
  return structuredClone(style);
}

function styledParagraphs(element: Extract<SceneElement, { type: "text" }>, style: TextStylePatch) {
  if (style.fontSizePt !== undefined && (!Number.isFinite(style.fontSizePt) || style.fontSizePt <= 0)) throw new Error("fontSizePt must be greater than zero");
  if (style.letterSpacingPt !== undefined && !Number.isFinite(style.letterSpacingPt)) throw new Error("letterSpacingPt must be finite");
  return element.paragraphs.map((paragraph) => ({
    ...paragraph,
    runs: paragraph.runs.map((run) => ({ ...run, ...style })),
  }));
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
      const changes = presentationPatch(input.changes);
      return {
        operations: [{ op: "updateElementPresentation", slideId: slide.id, elementId: input.elementId, changes }],
        nextSelectionIds: changes.locked ? [] : [input.elementId],
        affectedAutoLayoutContainerIds: [],
      };
    }
    case "setTextStyle": {
      const element = elementById(slide, input.elementId);
      if (element.type !== "text") throw new Error(`Element ${input.elementId} is not text`);
      return {
        operations: [{ op: "replaceText", slideId: slide.id, elementId: input.elementId, paragraphs: styledParagraphs(element, input.style) }],
        nextSelectionIds: [input.elementId],
        affectedAutoLayoutContainerIds: layoutParentIds(slide, input.elementId),
      };
    }
    case "setStyle": {
      const element = elementById(slide, input.elementId);
      return {
        operations: [{ op: "updateElementStyle", slideId: slide.id, elementId: input.elementId, style: stylePatch(element, input.style) }],
        nextSelectionIds: [input.elementId],
        affectedAutoLayoutContainerIds: [],
      };
    }
    case "setInspector": {
      const element = elementById(slide, input.elementId);
      const operations: DeckMutationOperation[] = [];
      if (input.geometry && Object.keys(input.geometry).length) {
        operations.push({ op: "updateGeometry", slideId: slide.id, elementId: input.elementId, geometry: finiteGeometryPatch(input.geometry) });
      }
      const presentation = input.presentation ? presentationPatch(input.presentation) : undefined;
      if (presentation && Object.keys(presentation).length) {
        operations.push({ op: "updateElementPresentation", slideId: slide.id, elementId: input.elementId, changes: presentation });
      }
      if (input.textStyle && Object.keys(input.textStyle).length) {
        if (element.type !== "text") throw new Error(`Element ${input.elementId} is not text`);
        operations.push({ op: "replaceText", slideId: slide.id, elementId: input.elementId, paragraphs: styledParagraphs(element, input.textStyle) });
      }
      if (input.style) {
        operations.push({ op: "updateElementStyle", slideId: slide.id, elementId: input.elementId, style: stylePatch(element, input.style) });
      }
      return {
        operations,
        nextSelectionIds: presentation?.locked ? [] : [input.elementId],
        affectedAutoLayoutContainerIds: input.geometry ? layoutParentIds(slide, input.elementId) : [],
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
    case "setStyle": return `Set visual style ${input.elementId}`;
    case "setInspector": return `Apply Inspector ${input.elementId}`;
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
