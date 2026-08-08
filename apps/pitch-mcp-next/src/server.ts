import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPitchMcpServer } from "../../pitch-mcp/src/server.js";
import { PitchWorkspaceService } from "../../workspace/src/server.js";
import { executeWorkspaceDesignCommand, type WorkspaceDesignCommand } from "../../workspace/src/design-runtime.js";
import { bootstrapThemeFromDesignSystem, readDesignState } from "../../design-mcp/src/server.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

const target = z.enum(["fill", "strokeColor", "textColor", "fontFamily", "fontSizePt"]);
const category = z.enum(["colors", "fonts", "typeScalePt", "spacingDU"]);
const theme = z.object({
  schemaVersion: z.literal("0.1"), id: z.string().min(1), name: z.string().min(1),
  colors: z.record(z.string(), z.string()), fonts: z.record(z.string(), z.string()), typeScalePt: z.record(z.string(), z.number()), spacingDU: z.record(z.string(), z.number()),
});

export function createPitchMcpNextServer(projectRoot: string) {
  const root = resolve(projectRoot);
  const server = createPitchMcpServer(root);
  const designService = new PitchWorkspaceService(root);

  server.registerTool("pitch_design_state", {
    title: "Read Pitch Design System state",
    description: "Read live deck theme, source DesignSystem, brand coverage/QA and high-confidence token binding suggestions.",
    inputSchema: {},
  }, async () => result(await readDesignState(designService)));

  server.registerTool("pitch_design_bootstrap", {
    title: "Initialize live Pitch theme",
    description: "Initialize the deck-local live theme from the existing canonical DesignSystem artifact. The result is an ordinary deck version.",
    inputSchema: { expectedDeckHash: z.string().optional() },
  }, async ({ expectedDeckHash }) => result(await bootstrapThemeFromDesignSystem(designService, expectedDeckHash)));

  server.registerTool("pitch_design_command", {
    title: "Edit Pitch Design System",
    description: "Edit theme tokens or bind/unbind scene objects. Token propagation updates all bound native objects in one ordinary deck version and standard Pitch undo point.",
    inputSchema: {
      command: z.enum(["initializeTheme", "renameTheme", "setToken", "bindToken", "unbindToken", "deleteToken"]),
      theme: theme.optional(), name: z.string().optional(), category: category.optional(), token: z.string().optional(), value: z.union([z.string(), z.number()]).optional(),
      slideId: z.string().optional(), elementIds: z.array(z.string()).optional(), target: target.optional(), expectedDeckHash: z.string().optional(),
    },
  }, async (args) => result(await executeWorkspaceDesignCommand(designService, args as WorkspaceDesignCommand)));

  return server;
}

export async function runPitchMcpNextServer(projectRoot: string): Promise<void> {
  const server = createPitchMcpNextServer(projectRoot);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runPitchMcpNextServer(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
