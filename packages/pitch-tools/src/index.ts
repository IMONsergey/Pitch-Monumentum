import type { EditorCommandInput } from "../../editor-commands/src/service.js";
import type { SlideCommandInput } from "../../slide-commands/src/index.js";
import type { MotionCommand } from "../../motion-commands/src/index.js";
import type { MediaCommand } from "../../media-commands/src/index.js";

export interface PitchToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export interface PitchToolBackend {
  state(): Promise<any>;
  editorCommand(input: (EditorCommandInput | SlideCommandInput) & { expectedDeckHash?: string }): Promise<any>;
  editorUndo(): Promise<any>;
  editorRedo(): Promise<any>;
  motionCommand(input: MotionCommand & { expectedDeckHash?: string; expectedMotionHash?: string }): Promise<any>;
  motionUndo(): Promise<any>;
  motionRedo(): Promise<any>;
  mediaCommand(input: MediaCommand & { expectedDeckHash?: string }): Promise<any>;
  componentCommand(input: any): Promise<any>;
}

export interface PitchToolResult {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
}

const selectionFields = {
  slideId: { type: "string", minLength: 1 },
  selectedIds: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
};
const expectedDeckHash = { type: "string" };
const geometry = { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 }, rotation: { type: "number" } }, required: ["x", "y", "width", "height"], additionalProperties: false };
const crop = { type: "object", properties: { left: { type: "number", minimum: 0, maximum: .999999 }, top: { type: "number", minimum: 0, maximum: .999999 }, right: { type: "number", minimum: 0, maximum: .999999 }, bottom: { type: "number", minimum: 0, maximum: .999999 } }, required: ["left", "top", "right", "bottom"], additionalProperties: false };
const focalPoint = { type: "object", properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 } }, required: ["x", "y"], additionalProperties: false };
const componentTransform = { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, scaleX: { type: "number", exclusiveMinimum: 0 }, scaleY: { type: "number", exclusiveMinimum: 0 } }, required: ["x", "y"], additionalProperties: false };

export const PITCH_TOOL_DEFINITIONS: PitchToolDefinition[] = [
  {
    name: "pitch_project_state",
    description: "Read current Pitch project state: active branch, deck hash, slide/object handles, QA, deck history, motion timeline/history, reusable component masters and linked instances, plus project image assets.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pitch_editor_command",
    description: "Execute professional object or slide editing through the same canonical engine used by the Pitch UI. Commands are atomic and versioned. Existing project assets can be inserted with insertImage.",
    readOnly: false,
    inputSchema: {
      oneOf: [
        { type: "object", properties: { command: { const: "nudge" }, ...selectionFields, dx: { type: "number" }, dy: { type: "number" }, expectedDeckHash }, required: ["command", "slideId", "selectedIds", "dx", "dy"], additionalProperties: false },
        { type: "object", properties: { command: { const: "align" }, ...selectionFields, alignment: { enum: ["left", "horizontalCenter", "right", "top", "verticalCenter", "bottom"] }, expectedDeckHash }, required: ["command", "slideId", "selectedIds", "alignment"], additionalProperties: false },
        { type: "object", properties: { command: { const: "distribute" }, ...selectionFields, axis: { enum: ["horizontal", "vertical"] }, expectedDeckHash }, required: ["command", "slideId", "selectedIds", "axis"], additionalProperties: false },
        { type: "object", properties: { command: { const: "duplicate" }, ...selectionFields, offsetDU: { type: "number", minimum: 0 }, expectedDeckHash }, required: ["command", "slideId", "selectedIds"], additionalProperties: false },
        { type: "object", properties: { command: { const: "delete" }, ...selectionFields, expectedDeckHash }, required: ["command", "slideId", "selectedIds"], additionalProperties: false },
        { type: "object", properties: { command: { const: "group" }, ...selectionFields, groupId: { type: "string" }, expectedDeckHash }, required: ["command", "slideId", "selectedIds"], additionalProperties: false },
        { type: "object", properties: { command: { const: "ungroup" }, ...selectionFields, expectedDeckHash }, required: ["command", "slideId", "selectedIds"], additionalProperties: false },
        { type: "object", properties: { command: { const: "arrange" }, ...selectionFields, arrangement: { enum: ["bringToFront", "bringForward", "sendBackward", "sendToBack"] }, expectedDeckHash }, required: ["command", "slideId", "selectedIds", "arrangement"], additionalProperties: false },
        { type: "object", properties: { command: { const: "lock" }, ...selectionFields, locked: { type: "boolean" }, expectedDeckHash }, required: ["command", "slideId", "selectedIds", "locked"], additionalProperties: false },
        { type: "object", properties: { command: { const: "paste" }, slideId: { type: "string" }, clipboard: { type: "object" }, offsetDU: { type: "number" }, expectedDeckHash }, required: ["command", "slideId", "clipboard"], additionalProperties: false },
        { type: "object", properties: { command: { const: "setInspector" }, slideId: { type: "string" }, elementId: { type: "string" }, geometry: { $ref: "#/$defs/geometryPatch" }, presentation: { $ref: "#/$defs/presentationPatch" }, textStyle: { $ref: "#/$defs/textStyle" }, expectedDeckHash }, required: ["command", "slideId", "elementId"], additionalProperties: false },
        { type: "object", properties: { command: { const: "insertText" }, slideId: { type: "string" }, geometry: { $ref: "#/$defs/geometry" }, text: { type: "string" }, expectedDeckHash }, required: ["command", "slideId", "geometry"], additionalProperties: false },
        { type: "object", properties: { command: { const: "insertShape" }, slideId: { type: "string" }, geometry: { $ref: "#/$defs/geometry" }, shape: { enum: ["rect", "roundRect", "ellipse", "triangle"] }, fill: { type: "string" }, expectedDeckHash }, required: ["command", "slideId", "geometry"], additionalProperties: false },
        { type: "object", properties: { command: { const: "insertFrame" }, slideId: { type: "string" }, geometry: { $ref: "#/$defs/geometry" }, fill: { type: "string" }, expectedDeckHash }, required: ["command", "slideId", "geometry"], additionalProperties: false },
        { type: "object", properties: { command: { const: "insertImage" }, slideId: { type: "string" }, geometry: { $ref: "#/$defs/geometry" }, assetId: { type: "string", minLength: 1 }, alt: { type: "string" }, fit: { enum: ["cover", "contain", "stretch"] }, name: { type: "string" }, expectedDeckHash }, required: ["command", "slideId", "geometry", "assetId"], additionalProperties: false },
        { type: "object", properties: { command: { const: "newSlide" }, afterSlideId: { type: "string" }, title: { type: "string" }, expectedDeckHash }, required: ["command"], additionalProperties: false },
        { type: "object", properties: { command: { const: "duplicateSlide" }, slideId: { type: "string" }, expectedDeckHash }, required: ["command", "slideId"], additionalProperties: false },
        { type: "object", properties: { command: { const: "deleteSlide" }, slideId: { type: "string" }, expectedDeckHash }, required: ["command", "slideId"], additionalProperties: false },
        { type: "object", properties: { command: { const: "moveSlide" }, slideId: { type: "string" }, toIndex: { type: "integer", minimum: 0 }, expectedDeckHash }, required: ["command", "slideId", "toIndex"], additionalProperties: false },
        { type: "object", properties: { command: { const: "renameSlide" }, slideId: { type: "string" }, title: { type: "string", minLength: 1 }, expectedDeckHash }, required: ["command", "slideId", "title"], additionalProperties: false }
      ],
      $defs: {
        geometry,
        geometryPatch: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 }, rotation: { type: "number" } }, minProperties: 1, additionalProperties: false },
        presentationPatch: { type: "object", properties: { name: { type: "string" }, opacity: { type: "number", minimum: 0, maximum: 1 }, locked: { type: "boolean" } }, minProperties: 1, additionalProperties: false },
        textStyle: { type: "object", properties: { fontFamily: { type: "string" }, fontSizePt: { type: "number", exclusiveMinimum: 0 }, color: { type: "string" }, bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" }, letterSpacingPt: { type: "number" } }, minProperties: 1, additionalProperties: false }
      }
    }
  },
  {
    name: "pitch_motion_command",
    description: "Edit slide transitions, click builds and exact keyframe tracks through Pitch's canonical MotionDocument. Motion has branch-local version history separate from deck geometry history.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        command: { enum: ["setSlideTransition", "addBuild", "updateBuild", "deleteBuild", "reorderBuild", "setTrack", "deleteTrack", "clearSlideMotion"] },
        slideId: { type: "string", minLength: 1 }, elementId: { type: "string" }, elementIds: { type: "array", items: { type: "string" } },
        transition: { anyOf: [{ type: "object" }, { type: "null" }] }, kind: { enum: ["entrance", "emphasis", "exit"] }, effect: { enum: ["appear", "fade", "scale", "slide", "wipe", "pulse"] }, trigger: { enum: ["onClick", "withPrevious", "afterPrevious"] },
        durationMs: { type: "number", minimum: 0 }, delayMs: { type: "number", minimum: 0 }, direction: { enum: ["left", "right", "up", "down"] }, distanceDU: { type: "number" }, easing: {}, buildId: { type: "string" }, changes: { type: "object" }, toIndex: { type: "integer", minimum: 0 },
        property: { enum: ["x", "y", "width", "height", "rotation", "opacity", "scaleX", "scaleY"] }, keyframes: { type: "array", items: { type: "object" } }, enabled: { type: "boolean" }, trackId: { type: "string" },
        expectedDeckHash, expectedMotionHash: { type: "string" }
      },
      required: ["command", "slideId"], additionalProperties: false,
    },
  },
  {
    name: "pitch_media_command",
    description: "Edit image fit, normalized crop, focal point, native clip geometry, corner radius or linked asset identity while keeping the image object editable in the canonical deck.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        command: { enum: ["setImageProperties", "setImageFit", "setImageCrop", "setImageFocalPoint", "setImageClipShape", "replaceImageAsset", "setImageCornerRadius"] },
        slideId: { type: "string" }, elementId: { type: "string" }, fit: { enum: ["cover", "contain", "stretch"] }, crop: { anyOf: [crop, { type: "null" }] }, focalPoint: { anyOf: [focalPoint, { type: "null" }] }, clipShape: { anyOf: [{ enum: ["rect", "roundRect", "ellipse"] }, { type: "null" }] }, assetId: { type: "string" }, alt: { anyOf: [{ type: "string" }, { type: "null" }] }, cornerRadiusDU: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
        changes: { type: "object", properties: { fit: { enum: ["cover", "contain", "stretch"] }, crop: { anyOf: [crop, { type: "null" }] }, focalPoint: { anyOf: [focalPoint, { type: "null" }] }, clipShape: { anyOf: [{ enum: ["rect", "roundRect", "ellipse"] }, { type: "null" }] }, assetId: { type: "string" }, alt: { anyOf: [{ type: "string" }, { type: "null" }] }, cornerRadiusDU: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] } }, additionalProperties: false },
        expectedDeckHash,
      },
      required: ["command", "slideId", "elementId"], additionalProperties: false,
    },
  },
  {
    name: "pitch_component_command",
    description: "Create and insert reusable component masters, update a master from a selected object tree with linked-instance propagation, sync all linked instances, reset one instance to its master, or detach it while preserving editable content.",
    readOnly: false,
    inputSchema: {
      oneOf: [
        { type: "object", properties: { command: { const: "createFromSelection" }, slideId: { type: "string", minLength: 1 }, selectedIds: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 }, name: { type: "string", minLength: 1 }, componentId: { type: "string" }, description: { type: "string" }, expectedDeckHash }, required: ["command", "slideId", "selectedIds", "name"], additionalProperties: false },
        { type: "object", properties: { command: { const: "insert" }, slideId: { type: "string", minLength: 1 }, componentId: { type: "string", minLength: 1 }, transform: componentTransform, overrides: { type: "array", items: { type: "object" } }, instanceId: { type: "string" }, expectedDeckHash }, required: ["command", "slideId", "componentId", "transform"], additionalProperties: false },
        { type: "object", properties: { command: { const: "updateFromSelection" }, slideId: { type: "string", minLength: 1 }, selectedIds: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 }, componentId: { type: "string", minLength: 1 }, name: { type: "string" }, description: { type: "string" }, expectedDeckHash }, required: ["command", "slideId", "selectedIds", "componentId"], additionalProperties: false },
        { type: "object", properties: { command: { const: "refreshInstances" }, componentId: { type: "string", minLength: 1 }, expectedDeckHash }, required: ["command", "componentId"], additionalProperties: false },
        { type: "object", properties: { command: { const: "resetInstance" }, componentId: { type: "string", minLength: 1 }, instanceId: { type: "string", minLength: 1 }, expectedDeckHash }, required: ["command", "componentId", "instanceId"], additionalProperties: false },
        { type: "object", properties: { command: { const: "detach" }, slideId: { type: "string", minLength: 1 }, instanceId: { type: "string", minLength: 1 }, expectedDeckHash }, required: ["command", "slideId", "instanceId"], additionalProperties: false }
      ]
    },
  },
  { name: "pitch_undo", description: "Undo the most recent canonical deck version on the active Pitch branch.", readOnly: false, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "pitch_redo", description: "Redo the next canonical deck version on the active Pitch branch.", readOnly: false, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "pitch_motion_undo", description: "Undo the most recent MotionDocument version without undoing deck geometry/content edits.", readOnly: false, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "pitch_motion_redo", description: "Redo the next MotionDocument version on the active branch.", readOnly: false, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];

export class PitchToolRuntime {
  constructor(private readonly backend: PitchToolBackend) {}
  listTools(): PitchToolDefinition[] { return PITCH_TOOL_DEFINITIONS.map(tool => structuredClone(tool)); }

  async callTool(name: string, args: unknown = {}): Promise<PitchToolResult> {
    try {
      if (name === "pitch_project_state") {
        const state = await this.backend.state();
        return {
          ok: true,
          tool: name,
          data: {
            projectId: state.manifest?.projectId,
            activeBranchId: state.manifest?.activeBranchId,
            deckHash: state.deckHash,
            deck: {
              id: state.deck?.id,
              title: state.deck?.title,
              canvas: state.deck?.canvas,
              slides: (state.deck?.slides ?? []).map((slide: any) => ({ id: slide.id, order: slide.order, title: slide.title, archetype: slide.archetype, status: slide.status, purpose: slide.semantic?.purpose, takeaway: slide.semantic?.takeaway, elements: (slide.scene ?? []).map((element: any) => ({ id: element.id, name: element.name, type: element.type, semanticRole: element.semanticRole, geometry: element.geometry, locked: Boolean(element.locked), assetId: element.assetId, fit: element.fit, crop: element.crop, focalPoint: element.focalPoint, clipShape: element.clipShape, componentInstanceId: element.tags?.find((tag: string) => tag.startsWith("component:"))?.slice("component:".length), componentId: element.tags?.find((tag: string) => tag.startsWith("component-def:"))?.slice("component-def:".length) })) }))
            },
            qa: state.qa,
            history: state.history,
            motion: state.motion,
            motionHash: state.motionHash,
            motionHistory: state.motionHistory,
            components: state.components,
            componentInstances: state.componentInstances,
            assets: state.assets,
          }
        };
      }
      if (name === "pitch_editor_command") return { ok: true, tool: name, data: await this.backend.editorCommand(args as (EditorCommandInput | SlideCommandInput) & { expectedDeckHash?: string }) };
      if (name === "pitch_motion_command") return { ok: true, tool: name, data: await this.backend.motionCommand(args as MotionCommand & { expectedDeckHash?: string; expectedMotionHash?: string }) };
      if (name === "pitch_media_command") return { ok: true, tool: name, data: await this.backend.mediaCommand(args as MediaCommand & { expectedDeckHash?: string }) };
      if (name === "pitch_component_command") return { ok: true, tool: name, data: await this.backend.componentCommand(args) };
      if (name === "pitch_undo") return { ok: true, tool: name, data: await this.backend.editorUndo() };
      if (name === "pitch_redo") return { ok: true, tool: name, data: await this.backend.editorRedo() };
      if (name === "pitch_motion_undo") return { ok: true, tool: name, data: await this.backend.motionUndo() };
      if (name === "pitch_motion_redo") return { ok: true, tool: name, data: await this.backend.motionRedo() };
      return { ok: false, tool: name, error: `Unknown Pitch tool: ${name}` };
    } catch (error) {
      return { ok: false, tool: name, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
