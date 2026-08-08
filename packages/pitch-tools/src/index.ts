import type { EditorCommandInput } from "../../editor-commands/src/service.js";

export interface PitchToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export interface PitchToolBackend {
  state(): Promise<any>;
  editorCommand(input: EditorCommandInput & { expectedDeckHash?: string }): Promise<any>;
  editorUndo(): Promise<any>;
  editorRedo(): Promise<any>;
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

export const PITCH_TOOL_DEFINITIONS: PitchToolDefinition[] = [
  {
    name: "pitch_project_state",
    description: "Read the current Pitch Monumentum project, active branch, deck hash, slide summaries, QA state, and version-history status before deciding what to edit.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pitch_editor_command",
    description: "Execute one professional editor command through the same canonical command engine used by the Pitch UI. Commands are atomic, versioned, hierarchy-safe, and may trigger Auto Layout reflow.",
    readOnly: false,
    inputSchema: {
      oneOf: [
        { type: "object", properties: { command: { const: "nudge" }, ...selectionFields, dx: { type: "number" }, dy: { type: "number" }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "selectedIds", "dx", "dy"], additionalProperties: false },
        { type: "object", properties: { command: { const: "align" }, ...selectionFields, alignment: { enum: ["left", "horizontalCenter", "right", "top", "verticalCenter", "bottom"] }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "selectedIds", "alignment"], additionalProperties: false },
        { type: "object", properties: { command: { const: "distribute" }, ...selectionFields, axis: { enum: ["horizontal", "vertical"] }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "selectedIds", "axis"], additionalProperties: false },
        { type: "object", properties: { command: { const: "duplicate" }, ...selectionFields, offsetDU: { type: "number", minimum: 0 }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "selectedIds"], additionalProperties: false },
        { type: "object", properties: { command: { const: "delete" }, ...selectionFields, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "selectedIds"], additionalProperties: false },
        { type: "object", properties: { command: { const: "group" }, ...selectionFields, groupId: { type: "string" }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "selectedIds"], additionalProperties: false },
        { type: "object", properties: { command: { const: "ungroup" }, ...selectionFields, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "selectedIds"], additionalProperties: false },
        { type: "object", properties: { command: { const: "arrange" }, ...selectionFields, arrangement: { enum: ["bringToFront", "bringForward", "sendBackward", "sendToBack"] }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "selectedIds", "arrangement"], additionalProperties: false },
        { type: "object", properties: { command: { const: "lock" }, ...selectionFields, locked: { type: "boolean" }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "selectedIds", "locked"], additionalProperties: false },
        { type: "object", properties: { command: { const: "paste" }, slideId: { type: "string" }, clipboard: { type: "object" }, offsetDU: { type: "number" }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "clipboard"], additionalProperties: false },
        { type: "object", properties: { command: { const: "insertText" }, slideId: { type: "string" }, geometry: { $ref: "#/$defs/geometry" }, text: { type: "string" }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "geometry"], additionalProperties: false },
        { type: "object", properties: { command: { const: "insertShape" }, slideId: { type: "string" }, geometry: { $ref: "#/$defs/geometry" }, shape: { enum: ["rect", "roundRect", "ellipse", "triangle"] }, fill: { type: "string" }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "geometry"], additionalProperties: false },
        { type: "object", properties: { command: { const: "insertFrame" }, slideId: { type: "string" }, geometry: { $ref: "#/$defs/geometry" }, fill: { type: "string" }, expectedDeckHash: { type: "string" } }, required: ["command", "slideId", "geometry"], additionalProperties: false },
      ],
      $defs: {
        geometry: {
          type: "object",
          properties: {
            x: { type: "number" }, y: { type: "number" }, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 }, rotation: { type: "number" },
          },
          required: ["x", "y", "width", "height"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    name: "pitch_undo",
    description: "Undo the most recent canonical deck version on the active Pitch branch.",
    readOnly: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pitch_redo",
    description: "Redo the next canonical deck version on the active Pitch branch.",
    readOnly: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export class PitchToolRuntime {
  constructor(private readonly backend: PitchToolBackend) {}

  listTools(): PitchToolDefinition[] {
    return PITCH_TOOL_DEFINITIONS.map(tool => structuredClone(tool));
  }

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
              slides: (state.deck?.slides ?? []).map((slide: any) => ({
                id: slide.id,
                order: slide.order,
                title: slide.title,
                archetype: slide.archetype,
                status: slide.status,
                purpose: slide.semantic?.purpose,
                takeaway: slide.semantic?.takeaway,
                elements: (slide.scene ?? []).map((element: any) => ({
                  id: element.id,
                  name: element.name,
                  type: element.type,
                  semanticRole: element.semanticRole,
                  geometry: element.geometry,
                  locked: Boolean(element.locked),
                })),
              })),
            },
            qa: state.qa,
            history: state.history,
          },
        };
      }
      if (name === "pitch_editor_command") {
        return { ok: true, tool: name, data: await this.backend.editorCommand(args as EditorCommandInput & { expectedDeckHash?: string }) };
      }
      if (name === "pitch_undo") return { ok: true, tool: name, data: await this.backend.editorUndo() };
      if (name === "pitch_redo") return { ok: true, tool: name, data: await this.backend.editorRedo() };
      return { ok: false, tool: name, error: `Unknown Pitch tool: ${name}` };
    } catch (error) {
      return { ok: false, tool: name, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
