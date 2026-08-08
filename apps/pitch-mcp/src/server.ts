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
const textStyleSchema = z.object({
  fontFamily: z.string().optional(), fontSizePt: z.number().positive().optional(), color: z.string().optional(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), letterSpacingPt: z.number().optional(),
});

const editorCommandShape = {
  command: z.enum([
    "nudge", "align", "distribute", "duplicate", "delete", "group", "ungroup", "arrange", "lock", "paste", "setInspector", "insertText", "insertShape", "insertFrame",
  ]),
  slideId: z.string().min(1),
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
  expectedDeckHash: z.string().optional(),
};

export function createPitchMcpServer(projectRoot: string): McpServer {
  const workspace = new PitchWorkspaceService(resolve(projectRoot));
  const runtime = new PitchToolRuntime(workspace);
  const server = new McpServer(
    { name: "pitch-monumentum", version: "0.1.0" },
    {
      instructions: [
        "Use pitch_project_state before meaningful edits to obtain current slide/object IDs and deckHash.",
        "Use pitch_editor_command for professional scene changes instead of inventing raw deck mutations.",
        "Use setInspector when exact coordinates, dimensions, opacity, naming, locking, or whole-box typography are requested.",
        "Preserve the user's requested scope. Prefer one atomic command at a time and re-read state when a command changes object IDs or hierarchy.",
        "Use pitch_undo immediately if a mutation produced an unintended result.",
      ].join(" "),
    },
  );

  server.registerTool(
    "pitch_project_state",
    { title: "Read Pitch project state", description: "Read active branch, deck hash, slide semantics, object handles, QA, and branch-local history without loading raw asset bytes.", inputSchema: {} },
    async () => mcpResult(await runtime.callTool("pitch_project_state")),
  );

  server.registerTool(
    "pitch_editor_command",
    { title: "Execute Pitch editor command", description: "Execute an atomic hierarchy-safe professional editor command through the same engine as the Pitch UI. Auto Layout parents are reflowed automatically when needed.", inputSchema: editorCommandShape },
    async (args) => mcpResult(await runtime.callTool("pitch_editor_command", args)),
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
