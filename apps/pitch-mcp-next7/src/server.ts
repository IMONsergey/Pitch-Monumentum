import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPitchMcpNext6Server } from "../../pitch-mcp-next6/src/server.js";
import { DeliveryRuntime, type DeliveryFormat } from "../../delivery/src/runtime.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

const policyShape = {
  requireDeckApproval: z.boolean().optional(),
  requireSlideApprovalIds: z.array(z.string().min(1)).optional(),
  blockOnOrphanedBlockingThreads: z.boolean().optional(),
};

export function createPitchMcpNext7Server(projectRoot: string) {
  const root = resolve(projectRoot);
  const server = createPitchMcpNext6Server(root);
  const delivery = new DeliveryRuntime(root);

  server.registerTool("pitch_delivery_state", {
    title: "Read Pitch Delivery Center preflight",
    description: "Read unified delivery readiness for PPTX, editable Figma Bridge, self-contained Web and macOS Keynote adapter. Includes review gate, deterministic QA, asset integrity, format blockers and explicit fidelity warnings.",
    inputSchema: policyShape,
  }, async (policy) => result(await delivery.preflight(policy)));

  server.registerTool("pitch_delivery_export", {
    title: "Export Pitch delivery artifacts",
    description: "Generate selected delivery artifacts only when their unified preflight is ready. Returns project-local artifact paths, SHA-256 hashes, warnings and delivery manifest; never bypasses review/approval blockers.",
    inputSchema: {
      formats: z.array(z.enum(["pptx", "figma", "web", "keynote"])).min(1).max(4),
      ...policyShape,
    },
  }, async (args) => {
    const { formats, ...policy } = args;
    return result(await delivery.exportBundle(formats as DeliveryFormat[], policy));
  });

  return server;
}

export async function runPitchMcpNext7Server(projectRoot: string): Promise<void> {
  await createPitchMcpNext7Server(projectRoot).connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runPitchMcpNext7Server(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
