import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPitchMcpNext7Server } from "../../pitch-mcp-next7/src/server.js";
import { SystemHealthRuntime } from "../../system-health/src/runtime.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

export function createPitchFullMcpServer(projectRoot: string) {
  const root = resolve(projectRoot);
  const server = createPitchMcpNext7Server(root);
  const health = new SystemHealthRuntime(root);
  server.registerTool("pitch_system_health", {
    title: "Read Pitch Full system health",
    description: "Read full-stack project/runtime diagnostics: canonical project integrity, QA, assets, masters, motion, review approvals, Creative Director, versions, Delivery readiness, UI/build entrypoints and current platform/architecture. This tool is read-only.",
    inputSchema: {},
  }, async () => result(await health.snapshot()));
  return server;
}

export async function runPitchFullMcpServer(projectRoot: string): Promise<void> {
  await createPitchFullMcpServer(projectRoot).connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) {
  runPitchFullMcpServer(process.argv[2] ?? ".pitch-demo").catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
