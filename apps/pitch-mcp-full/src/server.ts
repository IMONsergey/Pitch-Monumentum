import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPitchMcpNext7Server } from "../../pitch-mcp-next7/src/server.js";

export function createPitchFullMcpServer(projectRoot: string) {
  return createPitchMcpNext7Server(projectRoot);
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
