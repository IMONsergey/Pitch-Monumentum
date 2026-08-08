import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PitchWorkspaceService } from "../../workspace/src/server.js";
import { PitchToolRuntime, type PitchToolResult } from "../../../packages/pitch-tools/src/index.js";

function mcpResult(result: PitchToolResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.data ?? { error: result.error }, null, 2) }],
    structuredContent: { ok: result.ok, tool: result.tool, data: result.data ?? null, error: result.error ?? null },
    isError: !result.ok,
  };
}

const geometrySchema = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), rotation: z.number().optional() });
const geometryPatchSchema = z.object({ x: z.number().optional(), y: z.number().optional(), width: z.number().positive().optional(), height: z.number().positive().optional(), rotation: z.number().optional() });
const presentationPatchSchema = z.object({ name: z.string().optional(), opacity: z.number().min(0).max(1).optional(), locked: z.boolean().optional() });
const textStyleSchema = z.object({ fontFamily: z.string().optional(), fontSizePt: z.number().positive().optional(), color: z.string().optional(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), letterSpacingPt: z.number().optional() });

const editorCommandShape = {
  command: z.enum([
    "nudge", "align", "distribute", "duplicate", "delete", "group", "ungroup", "arrange", "lock", "paste", "setInspector", "insertText", "insertShape", "insertFrame",
    "newSlide", "duplicateSlide", "deleteSlide", "moveSlide", "renameSlide",
  ]),
  slideId: z.string().min(1).optional(),
  selectedIds: z.array(z.string().min(1)).optional(),
  elementId: z.string().optional(),
  dx: z.number().optional(),
  dy: z.number().optional(),
  alignment: z.enum(["left", "horizontalCenter", "right", "top", "verticalCenter", "bottom"]).optional(),
  axis: z.enum(["horizontal", "vertical"]).optional(),
  arrangement: z.enum(["bringToFront", "bringForward", "sendBackward", "sendToBack"]).optional(),
  offsetDU: z.number().nonnegative().optional(),
  groupId: z.string().optional(),
  locked: z.boolean().optional(),
  clipboard: z.any().optional(),
  geometry: geometrySchema.or(geometryPatchSchema).optional(),
  presentation: presentationPatchSchema.optional(),
  textStyle: textStyleSchema.optional(),
  text: z.string().optional(),
  shape: z.enum(["rect", "roundRect", "ellipse", "triangle"]).optional(),
  fill: z.string().optional(),
  afterSlideId: z.string().optional(),
  toIndex: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
  expectedDeckHash: z.string().optional(),
};

const transitionSchema = z.object({
  type: z.enum(["none", "fade", "push", "wipe", "dissolve"]),
  durationMs: z.number().nonnegative(),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  advance: z.union([z.literal("manual"), z.object({ afterMs: z.number().nonnegative() })]).optional(),
});
const keyframeSchema = z.object({ timeMs: z.number().nonnegative(), value: z.number(), easing: z.any().optional() });
const motionCommandShape = {
  command: z.enum(["setSlideTransition", "addBuild", "updateBuild", "deleteBuild", "reorderBuild", "setTrack", "deleteTrack", "clearSlideMotion"]),
  slideId: z.string().min(1),
  transition: transitionSchema.nullable().optional(),
  elementId: z.string().optional(),
  elementIds: z.array(z.string().min(1)).optional(),
  kind: z.enum(["entrance", "emphasis", "exit"]).optional(),
  effect: z.enum(["appear", "fade", "scale", "slide", "wipe", "pulse"]).optional(),
  trigger: z.enum(["onClick", "withPrevious", "afterPrevious"]).optional(),
  durationMs: z.number().nonnegative().optional(),
  delayMs: z.number().nonnegative().optional(),
  direction: z.enum(["left", "right", "up", "down"]).optional(),
  distanceDU: z.number().optional(),
  easing: z.any().optional(),
  buildId: z.string().optional(),
  changes: z.any().optional(),
  toIndex: z.number().int().nonnegative().optional(),
  property: z.enum(["x", "y", "width", "height", "rotation", "opacity", "scaleX", "scaleY"]).optional(),
  keyframes: z.array(keyframeSchema).optional(),
  enabled: z.boolean().optional(),
  trackId: z.string().optional(),
  expectedDeckHash: z.string().optional(),
  expectedMotionHash: z.string().optional(),
};

const cropSchema = z.object({ left: z.number().min(0).max(0.999999), top: z.number().min(0).max(0.999999), right: z.number().min(0).max(0.999999), bottom: z.number().min(0).max(0.999999) });
const mediaCommandShape = {
  command: z.enum(["setImageFit", "setImageCrop", "replaceImageAsset", "setImageCornerRadius"]),
  slideId: z.string().min(1), elementId: z.string().min(1),
  fit: z.enum(["cover", "contain", "stretch"]).optional(), crop: cropSchema.nullable().optional(), assetId: z.string().optional(), alt: z.string().nullable().optional(), cornerRadiusDU: z.number().nonnegative().nullable().optional(), expectedDeckHash: z.string().optional(),
};

const componentCommandShape = {
  command: z.enum(["createFromSelection", "insert", "detach"]),
  slideId: z.string().min(1), selectedIds: z.array(z.string().min(1)).optional(), name: z.string().optional(), componentId: z.string().optional(), description: z.string().optional(),
  transform: z.object({ x: z.number(), y: z.number(), scaleX: z.number().positive().optional(), scaleY: z.number().positive().optional() }).optional(), overrides: z.array(z.any()).optional(), instanceId: z.string().optional(), expectedDeckHash: z.string().optional(),
};

export function createPitchMcpServer(projectRoot: string): McpServer {
  const workspace = new PitchWorkspaceService(resolve(projectRoot));
  const runtime = new PitchToolRuntime(workspace);
  const server = new McpServer(
    { name: "pitch-monumentum", version: "0.2.0" },
    {
      instructions: [
        "Use pitch_project_state before meaningful edits to obtain current slide/object IDs, deckHash, motionHash and component handles.",
        "Use pitch_editor_command for canonical scene and storyboard edits instead of raw deck mutations.",
        "Use pitch_media_command for image fit, crop and asset replacement; use pitch_component_command for reusable component workflows.",
        "Use pitch_motion_command for transitions, build order and keyframe tracks. Motion history is independent: use pitch_motion_undo/pitch_motion_redo for animation mistakes.",
        "Preserve requested scope. Prefer one coherent bounded command at a time and re-read state after operations that change IDs, hierarchy, slide order, component instances or motion history.",
        "Use pitch_undo immediately if a deck mutation produced an unintended result.",
      ].join(" "),
    },
  );

  server.registerTool(
    "pitch_project_state",
    { title: "Read Pitch project state", description: "Read active branch, deck hash, slide semantics, object handles, QA, motion timeline/history, reusable components and branch-local deck history.", inputSchema: {} },
    async () => mcpResult(await runtime.callTool("pitch_project_state")),
  );
  server.registerTool(
    "pitch_editor_command",
    { title: "Execute Pitch editor command", description: "Execute an atomic professional object or storyboard command through the same engine as the Pitch UI.", inputSchema: editorCommandShape },
    async (args) => mcpResult(await runtime.callTool("pitch_editor_command", args)),
  );
  server.registerTool(
    "pitch_motion_command",
    { title: "Edit Pitch motion", description: "Edit transitions, click builds or exact keyframe tracks in the branch-local MotionDocument.", inputSchema: motionCommandShape },
    async (args) => mcpResult(await runtime.callTool("pitch_motion_command", args)),
  );
  server.registerTool(
    "pitch_media_command",
    { title: "Edit Pitch image media", description: "Edit image fit, crop, corner radius or asset identity while preserving a fully editable image object.", inputSchema: mediaCommandShape },
    async (args) => mcpResult(await runtime.callTool("pitch_media_command", args)),
  );
  server.registerTool(
    "pitch_component_command",
    { title: "Edit Pitch components", description: "Create reusable components, insert instances with overrides, or detach instances while preserving editable content.", inputSchema: componentCommandShape },
    async (args) => mcpResult(await runtime.callTool("pitch_component_command", args)),
  );
  server.registerTool(
    "pitch_undo",
    { title: "Undo Pitch edit", description: "Undo the most recent canonical deck version on the active branch.", inputSchema: {} },
    async () => mcpResult(await runtime.callTool("pitch_undo")),
  );
  server.registerTool(
    "pitch_redo",
    { title: "Redo Pitch edit", description: "Redo the next canonical deck version on the active branch.", inputSchema: {} },
    async () => mcpResult(await runtime.callTool("pitch_redo")),
  );
  server.registerTool(
    "pitch_motion_undo",
    { title: "Undo Pitch motion", description: "Undo the most recent MotionDocument version without touching deck edits.", inputSchema: {} },
    async () => mcpResult(await runtime.callTool("pitch_motion_undo")),
  );
  server.registerTool(
    "pitch_motion_redo",
    { title: "Redo Pitch motion", description: "Redo the next MotionDocument version without touching deck edits.", inputSchema: {} },
    async () => mcpResult(await runtime.callTool("pitch_motion_redo")),
  );

  return server;
}

export async function runPitchMcpServer(projectRoot: string): Promise<void> {
  const server = createPitchMcpServer(projectRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1]?.endsWith("server.js")) {
  runPitchMcpServer(process.argv[2] ?? ".pitch-demo").catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
