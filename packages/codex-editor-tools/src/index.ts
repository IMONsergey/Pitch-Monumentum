import type { DeckDocument, Geometry, SlideDocument } from "../../deck-model/src/index.js";
import { applyDeckMutation, createMutation, type AppliedDeckMutation, type DeckMutationOperation, type ElementStylePatch } from "../../mutations/src/index.js";
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
export const PITCH_SET_STYLE_TOOL_NAME = "pitch_set_style" as const;

export type PitchEditorCommand =
  | { command: "nudge"; slideId: string; elementIds: string[]; dx: number; dy: number }
  | { command: "align"; slideId: string; elementIds: string[]; alignment: AlignCommand }
  | { command: "distribute"; slideId: string; elementIds: string[]; axis: DistributeCommand }
  | { command: "duplicate"; slideId: string; elementIds: string[]; offsetDU?: number }
  | { command: "delete"; slideId: string; elementIds: string[] }
  | { command: "group"; slideId: string; elementIds: string[]; groupId?: string }
  | { command: "ungroup"; slideId: string; elementIds: string[] }
  | { command: "arrange"; slideId: string; elementIds: string[]; arrangement: ArrangeCommand }
  | { command: "insertText"; slideId: string; elementIds: string[]; geometry: Geometry; text?: string; fontSizePt?: number }
  | { command: "insertShape"; slideId: string; elementIds: string[]; geometry: Geometry; shape?: "rect" | "roundRect" | "ellipse" | "triangle"; fill?: string }
  | { command: "insertFrame"; slideId: string; elementIds: string[]; geometry: Geometry; name?: string };

export interface PitchSetStyleArguments {
  slideId: string;
  elementId: string;
  kind: "shape" | "frame" | "image" | "line";
  fill: string | null;
  strokeColor: string | null;
  strokeWidthDU: number | null;
  dash: "solid" | "dash" | "dot" | null;
  radiusDU: number | null;
  clipContent: boolean | null;
  fit: "cover" | "contain" | "stretch" | null;
  cornerRadiusDU: number | null;
  startMarker: "none" | "arrow" | "dot" | null;
  endMarker: "none" | "arrow" | "dot" | null;
}

export interface PitchEditorToolCall {
  name: typeof PITCH_EDITOR_TOOL_NAME;
  arguments: PitchEditorCommand;
  expectedDeckHash?: string;
}

export interface PitchSetStyleToolCall {
  name: typeof PITCH_SET_STYLE_TOOL_NAME;
  arguments: PitchSetStyleArguments;
  expectedDeckHash?: string;
}

export type PitchCodexToolCall = PitchEditorToolCall | PitchSetStyleToolCall;

export interface PitchEditorToolResult {
  ok: true;
  tool: typeof PITCH_EDITOR_TOOL_NAME | typeof PITCH_SET_STYLE_TOOL_NAME;
  command: string;
  mutationId: string;
  beforeHash: string;
  afterHash: string;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  nextSelectionIds: string[];
  applied: AppliedDeckMutation;
}

/**
 * Transitional broad command tool. Its command-specific optional fields are validated
 * by Pitch at runtime, so it deliberately does not advertise strict schema adherence.
 * High-value commands should migrate to narrow strict tools like pitch_set_style.
 */
export const pitchEditorToolDefinition = {
  type: "function",
  name: PITCH_EDITOR_TOOL_NAME,
  description: "Execute a bounded professional editing command on the canonical Pitch slide scene. Use this instead of emitting arbitrary deck JSON.",
  strict: false,
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

/**
 * Strict tool: all keys are required and target-specific optional values are explicit
 * nulls. This keeps the schema predictable for Responses/Codex while runtime checks
 * still ensure the requested style kind matches the canonical scene element.
 */
export const pitchSetStyleToolDefinition = {
  type: "function",
  name: PITCH_SET_STYLE_TOOL_NAME,
  description: "Change the native visual style of exactly one Pitch shape, frame, image, or line without changing its content or geometry. Pass null for fields that do not apply to the selected kind.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["slideId", "elementId", "kind", "fill", "strokeColor", "strokeWidthDU", "dash", "radiusDU", "clipContent", "fit", "cornerRadiusDU", "startMarker", "endMarker"],
    properties: {
      slideId: { type: "string" },
      elementId: { type: "string" },
      kind: { type: "string", enum: ["shape", "frame", "image", "line"] },
      fill: { type: ["string", "null"] },
      strokeColor: { type: ["string", "null"] },
      strokeWidthDU: { type: ["number", "null"] },
      dash: { enum: ["solid", "dash", "dot", null] },
      radiusDU: { type: ["number", "null"] },
      clipContent: { type: ["boolean", "null"] },
      fit: { enum: ["cover", "contain", "stretch", null] },
      cornerRadiusDU: { type: ["number", "null"] },
      startMarker: { enum: ["none", "arrow", "dot", null] },
      endMarker: { enum: ["none", "arrow", "dot", null] },
    },
  },
} as const;

export const pitchCodexToolDefinitions = [pitchEditorToolDefinition, pitchSetStyleToolDefinition] as const;

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
        origin: "agent",
        paragraphs: [{ runs: [{ text: args.text ?? "Text", fontSizePt: args.fontSizePt ?? 24, color: "#111111" }] }],
      });
      return { operations: [{ op: "addElement", slideId: slide.id, element }], nextSelectionIds: [element.id] };
    }
    case "insertShape": {
      const element = createShapeElement({ geometry: args.geometry, zIndex: zAfter(slide), origin: "agent", shape: args.shape ?? "rect", fill: args.fill ?? "#E9EDF2" });
      return { operations: [{ op: "addElement", slideId: slide.id, element }], nextSelectionIds: [element.id] };
    }
    case "insertFrame": {
      const element = createFrameElement({ geometry: args.geometry, zIndex: zAfter(slide), origin: "agent", name: args.name ?? "Frame" });
      return { operations: [{ op: "addElement", slideId: slide.id, element }], nextSelectionIds: [element.id] };
    }
  }
}

function styleFromTool(args: PitchSetStyleArguments): ElementStylePatch {
  const stroke = args.strokeColor !== null && args.strokeWidthDU !== null
    ? { color: args.strokeColor, widthDU: args.strokeWidthDU, ...(args.dash ? { dash: args.dash } : {}) }
    : null;
  if (args.kind === "shape") return { kind: "shape", fill: args.fill, stroke, radiusDU: args.radiusDU };
  if (args.kind === "frame") return { kind: "frame", fill: args.fill, stroke, radiusDU: args.radiusDU, ...(args.clipContent !== null ? { clipContent: args.clipContent } : {}) };
  if (args.kind === "image") return { kind: "image", cornerRadiusDU: args.cornerRadiusDU, ...(args.fit !== null ? { fit: args.fit } : {}) };
  return {
    kind: "line",
    ...(stroke ? { stroke } : {}),
    ...(args.startMarker !== null ? { startMarker: args.startMarker } : {}),
    ...(args.endMarker !== null ? { endMarker: args.endMarker } : {}),
  };
}

function executeApplied(deck: DeckDocument, tool: PitchEditorToolResult["tool"], command: string, operations: DeckMutationOperation[], nextSelectionIds: string[], expectedDeckHash?: string): PitchEditorToolResult {
  if (!operations.length) throw new Error(`Pitch tool ${tool} produced no mutation`);
  const mutation = createMutation(`Codex tool ${tool}: ${command}`, operations, "codex", expectedDeckHash);
  const applied = applyDeckMutation(deck, mutation);
  return {
    ok: true,
    tool,
    command,
    mutationId: mutation.id,
    beforeHash: applied.beforeHash,
    afterHash: applied.afterHash,
    affectedSlideIds: applied.impact.affectedSlideIds,
    affectedElementIds: applied.impact.affectedElementIds,
    nextSelectionIds,
    applied,
  };
}

export function executePitchEditorTool(deck: DeckDocument, call: PitchEditorToolCall): PitchEditorToolResult {
  if (call.name !== PITCH_EDITOR_TOOL_NAME) throw new Error(`Unsupported Pitch tool: ${call.name}`);
  const built = buildPitchEditorToolOperations(deck, call.arguments);
  return executeApplied(deck, call.name, call.arguments.command, built.operations, built.nextSelectionIds, call.expectedDeckHash);
}

export function executePitchSetStyleTool(deck: DeckDocument, call: PitchSetStyleToolCall): PitchEditorToolResult {
  if (call.name !== PITCH_SET_STYLE_TOOL_NAME) throw new Error(`Unsupported Pitch tool: ${call.name}`);
  const slide = findSlide(deck, call.arguments.slideId);
  const element = slide.scene.find((item) => item.id === call.arguments.elementId);
  if (!element) throw new Error(`Unknown element ${call.arguments.elementId} on slide ${slide.id}`);
  if (element.type !== call.arguments.kind) throw new Error(`Style kind ${call.arguments.kind} does not match ${element.type} element ${element.id}`);
  const operation: DeckMutationOperation = { op: "updateElementStyle", slideId: slide.id, elementId: element.id, style: styleFromTool(call.arguments) };
  return executeApplied(deck, call.name, "setStyle", [operation], [element.id], call.expectedDeckHash);
}

export function executePitchCodexTool(deck: DeckDocument, call: PitchCodexToolCall): PitchEditorToolResult {
  if (call.name === PITCH_SET_STYLE_TOOL_NAME) return executePitchSetStyleTool(deck, call);
  return executePitchEditorTool(deck, call);
}
