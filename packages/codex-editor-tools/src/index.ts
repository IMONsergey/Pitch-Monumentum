import type { DeckDocument, Geometry, SlideDocument } from "../../deck-model/src/index.js";
import { applyDeckMutation, createMutation, type AppliedDeckMutation, type DeckMutationOperation } from "../../mutations/src/index.js";
import {
  alignSelection,
  arrangeSelection,
  createFrameElement,
  createShapeElement,
  createTextElement,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  nudgeSelection,
  ungroupSelection,
  type AlignCommand,
  type ArrangeCommand,
  type DistributeCommand,
} from "../../editor-commands/src/index.js";

export const PITCH_EDITOR_TOOL_NAME = "pitch_editor_command" as const;

export type PitchEditorCommand =
  | { command: "nudge"; slideId: string; elementIds: string[]; dx: number; dy: number }
  | { command: "align"; slideId: string; elementIds: string[]; alignment: AlignCommand }
  | { command: "distribute"; slideId: string; elementIds: string[]; axis: DistributeCommand }
  | { command: "duplicate"; slideId: string; elementIds: string[]; offsetDU?: number }
  | { command: "delete"; slideId: string; elementIds: string[] }
  | { command: "group"; slideId: string; elementIds: string[]; groupId?: string }
  | { command: "ungroup"; slideId: string; elementIds: string[] }
  | { command: "arrange"; slideId: string; elementIds: string[]; arrangement: ArrangeCommand }
  | { command: "insertText"; slideId: string; geometry: Geometry; text?: string; fontSizePt?: number }
  | { command: "insertShape"; slideId: string; geometry: Geometry; shape?: "rect" | "roundRect" | "ellipse" | "triangle"; fill?: string }
  | { command: "insertFrame"; slideId: string; geometry: Geometry; name?: string };

export interface PitchEditorToolCall {
  name: typeof PITCH_EDITOR_TOOL_NAME;
  arguments: PitchEditorCommand;
  expectedDeckHash?: string;
}

export interface PitchEditorToolResult {
  ok: true;
  command: PitchEditorCommand["command"];
  mutationId: string;
  beforeHash: string;
  afterHash: string;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  nextSelectionIds: string[];
  applied: AppliedDeckMutation;
}

export const pitchEditorToolDefinition = {
  type: "function",
  name: PITCH_EDITOR_TOOL_NAME,
  description: "Execute a bounded professional editing command on the canonical Pitch slide scene. Use this instead of emitting arbitrary deck JSON.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["command", "slideId", "elementIds"],
    properties: {
      command: {
        type: "string",
        enum: ["nudge", "align", "distribute", "duplicate", "delete", "group", "ungroup", "arrange", "insertText", "insertShape", "insertFrame"],
      },
      slideId: { type: "string" },
      elementIds: { type: "array", items: { type: "string" } },
      dx: { type: "number" },
      dy: { type: "number" },
      alignment: { type: "string", enum: ["left", "horizontalCenter", "right", "top", "verticalCenter", "bottom"] },
      axis: { type: "string", enum: ["horizontal", "vertical"] },
      offsetDU: { type: "number" },
      groupId: { type: "string" },
      arrangement: { type: "string", enum: ["bringToFront", "bringForward", "sendBackward", "sendToBack"] },
      geometry: {
        type: "object",
        additionalProperties: false,
        required: ["x", "y", "width", "height"],
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          rotation: { type: "number" },
        },
      },
      text: { type: "string" },
      fontSizePt: { type: "number" },
      shape: { type: "string", enum: ["rect", "roundRect", "ellipse", "triangle"] },
      fill: { type: "string" },
      name: { type: "string" },
    },
  },
} as const;

function findSlide(deck: DeckDocument, slideId: string): SlideDocument {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  return slide;
}

function zAfter(slide: SlideDocument): number {
  return Math.max(0, ...slide.scene.map((element) => element.zIndex)) + 1;
}

export function buildPitchEditorToolOperations(deck: DeckDocument, args: PitchEditorCommand): { operations: DeckMutationOperation[]; nextSelectionIds: string[] } {
  const slide = findSlide(deck, args.slideId);
  switch (args.command) {
    case "nudge": {
      const result = nudgeSelection(slide, args.elementIds, args.dx, args.dy);
      return { operations: result.operations, nextSelectionIds: result.nextSelectionIds };
    }
    case "align": {
      const result = alignSelection(slide, args.elementIds, args.alignment);
      return { operations: result.operations, nextSelectionIds: result.nextSelectionIds };
    }
    case "distribute": {
      const result = distributeSelection(slide, args.elementIds, args.axis);
      return { operations: result.operations, nextSelectionIds: result.nextSelectionIds };
    }
    case "duplicate": {
      const result = duplicateSelection(slide, args.elementIds, args.offsetDU);
      return { operations: result.operations, nextSelectionIds: result.nextSelectionIds };
    }
    case "delete": {
      const result = deleteSelection(slide, args.elementIds);
      return { operations: result.operations, nextSelectionIds: result.nextSelectionIds };
    }
    case "group": {
      const result = groupSelection(slide, args.elementIds, args.groupId);
      return { operations: result.operations, nextSelectionIds: result.nextSelectionIds };
    }
    case "ungroup": {
      const result = ungroupSelection(slide, args.elementIds);
      return { operations: result.operations, nextSelectionIds: result.nextSelectionIds };
    }
    case "arrange": {
      const result = arrangeSelection(slide, args.elementIds, args.arrangement);
      return { operations: result.operations, nextSelectionIds: result.nextSelectionIds };
    }
    case "insertText": {
      const element = createTextElement({
        geometry: args.geometry,
        zIndex: zAfter(slide),
        paragraphs: [{ runs: [{ text: args.text ?? "Text", fontSizePt: args.fontSizePt ?? 24, color: "#111111" }] }],
      });
      return { operations: [{ op: "addElement", slideId: slide.id, element }], nextSelectionIds: [element.id] };
    }
    case "insertShape": {
      const element = createShapeElement({ geometry: args.geometry, zIndex: zAfter(slide), shape: args.shape ?? "rect", fill: args.fill ?? "#E9EDF2" });
      return { operations: [{ op: "addElement", slideId: slide.id, element }], nextSelectionIds: [element.id] };
    }
    case "insertFrame": {
      const element = createFrameElement({ geometry: args.geometry, zIndex: zAfter(slide), name: args.name ?? "Frame" });
      return { operations: [{ op: "addElement", slideId: slide.id, element }], nextSelectionIds: [element.id] };
    }
  }
}

export function executePitchEditorTool(deck: DeckDocument, call: PitchEditorToolCall): PitchEditorToolResult {
  if (call.name !== PITCH_EDITOR_TOOL_NAME) throw new Error(`Unsupported Pitch tool: ${call.name}`);
  const built = buildPitchEditorToolOperations(deck, call.arguments);
  if (built.operations.length === 0) throw new Error(`Pitch editor command ${call.arguments.command} produced no mutation`);
  const mutation = createMutation(
    `Codex editor command: ${call.arguments.command}`,
    built.operations,
    "codex",
    call.expectedDeckHash,
  );
  const applied = applyDeckMutation(deck, mutation);
  return {
    ok: true,
    command: call.arguments.command,
    mutationId: mutation.id,
    beforeHash: applied.beforeHash,
    afterHash: applied.afterHash,
    affectedSlideIds: applied.impact.affectedSlideIds,
    affectedElementIds: applied.impact.affectedElementIds,
    nextSelectionIds: built.nextSelectionIds,
    applied,
  };
}
