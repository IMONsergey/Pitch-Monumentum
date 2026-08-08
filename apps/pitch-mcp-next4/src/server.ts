import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPitchMcpNext3Server } from "../../pitch-mcp-next3/src/server.js";
import { PitchWorkspaceService } from "../../workspace/src/server.js";
import { listCreativeRuns, readCreativeRun } from "../../creative-director/src/audit-runtime.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

export function createPitchMcpNext4Server(projectRoot: string) {
  const root = resolve(projectRoot);
  const server = createPitchMcpNext3Server(root);
  const workspace = new PitchWorkspaceService(root);

  server.registerTool("pitch_creative_runs", {
    title: "List Creative Director run audits",
    description: "List branch-local Creative Director execution audits with request id, action counts, before/after production score, acceptance and errors. Inherited run records are identified on forked branches.",
    inputSchema: { branchId: z.string().optional() },
  }, async ({ branchId }) => result({ runs: await listCreativeRuns(workspace, branchId) }));

  server.registerTool("pitch_creative_run", {
    title: "Read Creative Director run audit",
    description: "Read the immutable audit for one Creative Director execution: server-issued plan, validation, concrete canonical actions, per-action deck hashes, post-review and rollback/error state.",
    inputSchema: { runId: z.string().min(1), branchId: z.string().optional() },
  }, async ({ runId, branchId }) => result(await readCreativeRun(workspace, runId, branchId)));

  return server;
}

export async function runPitchMcpNext4Server(projectRoot: string): Promise<void> {
  await createPitchMcpNext4Server(projectRoot).connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runPitchMcpNext4Server(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
