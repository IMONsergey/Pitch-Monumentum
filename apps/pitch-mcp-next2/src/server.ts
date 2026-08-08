import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPitchMcpNextServer } from "../../pitch-mcp-next/src/server.js";
import { PitchWorkspaceService } from "../../workspace/src/server.js";
import { executeWorkspaceSlideMasterCommand, type WorkspaceSlideMasterCommand } from "../../workspace/src/master-runtime.js";
import { readMasterToolState } from "../../master-mcp/src/server.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

const masterCommand = z.discriminatedUnion("command", [
  z.object({ command: z.literal("createMaster"), slideId: z.string().min(1), name: z.string().min(1), masterId: z.string().optional(), description: z.string().optional(), autoDetectPlaceholders: z.boolean().optional(), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("applyMaster"), slideId: z.string().min(1), masterId: z.string().min(1), preserveUnmatched: z.boolean().optional(), instanceId: z.string().optional(), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("updateMasterFromSlide"), slideId: z.string().min(1), masterId: z.string().min(1), name: z.string().optional(), description: z.string().optional(), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("deleteMaster"), masterId: z.string().min(1), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("detachMaster"), slideId: z.string().min(1), expectedDeckHash: z.string().optional() }),
]);

export function createPitchMcpNext2Server(projectRoot: string) {
  const root = resolve(projectRoot);
  const server = createPitchMcpNextServer(root);
  const service = new PitchWorkspaceService(root);

  server.registerTool("pitch_master_state", {
    title: "Read Pitch Slide Master state",
    description: "Read deck-local masters, current layout, Smart Layout recommendations and master integrity/drift QA for a slide.",
    inputSchema: { slideId: z.string().optional() },
  }, async ({ slideId }) => result(await readMasterToolState(service, slideId)));

  server.registerTool("pitch_master_command", {
    title: "Edit Pitch Slide Masters",
    description: "Create/apply/update/delete/detach slide masters. Update Master refreshes every linked slide in one ordinary deck version while retaining placeholder content and compatible element identities.",
    inputSchema: {
      command: z.enum(["createMaster", "applyMaster", "updateMasterFromSlide", "deleteMaster", "detachMaster"]),
      slideId: z.string().optional(), masterId: z.string().optional(), name: z.string().optional(), description: z.string().optional(), autoDetectPlaceholders: z.boolean().optional(), preserveUnmatched: z.boolean().optional(), instanceId: z.string().optional(), expectedDeckHash: z.string().optional(),
    },
  }, async (args) => result(await executeWorkspaceSlideMasterCommand(service, masterCommand.parse(args) as WorkspaceSlideMasterCommand)));

  return server;
}

export async function runPitchMcpNext2Server(projectRoot: string): Promise<void> {
  await createPitchMcpNext2Server(projectRoot).connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runPitchMcpNext2Server(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
