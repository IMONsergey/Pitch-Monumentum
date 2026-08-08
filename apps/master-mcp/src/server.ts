import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PitchWorkspaceService } from "../../workspace/src/server.js";
import { executeWorkspaceSlideMasterCommand, readSlideMasterState, type WorkspaceSlideMasterCommand } from "../../workspace/src/master-runtime.js";
import { runSlideMasterQA } from "../../../packages/slide-master-qa/src/index.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

const commandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("createMaster"), slideId: z.string().min(1), name: z.string().min(1), masterId: z.string().optional(), description: z.string().optional(), autoDetectPlaceholders: z.boolean().optional(), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("applyMaster"), slideId: z.string().min(1), masterId: z.string().min(1), preserveUnmatched: z.boolean().optional(), instanceId: z.string().optional(), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("updateMasterFromSlide"), slideId: z.string().min(1), masterId: z.string().min(1), name: z.string().optional(), description: z.string().optional(), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("deleteMaster"), masterId: z.string().min(1), expectedDeckHash: z.string().optional() }),
  z.object({ command: z.literal("detachMaster"), slideId: z.string().min(1), expectedDeckHash: z.string().optional() }),
]);

export async function readMasterToolState(service: PitchWorkspaceService, slideId?: string) {
  const state = await readSlideMasterState(service, slideId);
  const current = await service.state();
  const activeSlide = slideId ? current.deck.slides.find((slide) => slide.id === slideId) : undefined;
  const currentMasterId = activeSlide?.scene.flatMap((element: any) => element.tags ?? []).find((tag: string) => tag.startsWith("slide-master:"))?.slice("slide-master:".length) ?? null;
  return { ...state, currentMasterId, qa: runSlideMasterQA(current.deck) };
}

export function createMasterMcpServer(projectRoot: string): McpServer {
  const service = new PitchWorkspaceService(resolve(projectRoot));
  const server = new McpServer(
    { name: "pitch-slide-masters", version: "0.1.0" },
    { instructions: [
      "Use pitch_master_state for the target slide before changing layout. Read currentMasterId, master definitions, recommendations and QA.",
      "CreateMaster derives a reusable master from the current slide. ApplyMaster maps existing title/body/image/chart/table content into master placeholders and preserves unmatched freeform objects by default.",
      "UpdateMasterFromSlide is intentionally wide-scope: the selected slide becomes the new master source and every linked slide is refreshed in one ordinary deck version. Verify affected slides after running it.",
      "Placeholder content survives layout/master changes while master geometry, base typography and media treatment define visual structure.",
      "Stable placeholder element IDs are preserved where compatible so selections, agent handles and motion references do not churn unnecessarily.",
      "Use ordinary Pitch undo/redo for master edits; there is no separate master history.",
      "DetachMaster keeps scene objects editable and only removes master linkage. DeleteMaster fails while any slide still uses the master.",
    ].join(" ") },
  );

  server.registerTool("pitch_master_state", {
    title: "Read Pitch Slide Master state",
    description: "Read deck-local slide masters, current slide master, smart layout recommendations and master integrity/drift QA.",
    inputSchema: { slideId: z.string().optional() },
  }, async ({ slideId }) => result(await readMasterToolState(service, slideId)));

  server.registerTool("pitch_master_command", {
    title: "Edit Pitch Slide Masters",
    description: "Create/apply/update/delete/detach a slide master. Update Master propagates layout/style to every linked slide while preserving placeholder content.",
    inputSchema: {
      command: z.enum(["createMaster", "applyMaster", "updateMasterFromSlide", "deleteMaster", "detachMaster"]),
      slideId: z.string().optional(), masterId: z.string().optional(), name: z.string().optional(), description: z.string().optional(), autoDetectPlaceholders: z.boolean().optional(), preserveUnmatched: z.boolean().optional(), instanceId: z.string().optional(), expectedDeckHash: z.string().optional(),
    },
  }, async (args) => {
    const command = commandSchema.parse(args) as WorkspaceSlideMasterCommand;
    return result(await executeWorkspaceSlideMasterCommand(service, command));
  });
  return server;
}

export async function runMasterMcpServer(projectRoot: string): Promise<void> {
  await createMasterMcpServer(projectRoot).connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runMasterMcpServer(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
