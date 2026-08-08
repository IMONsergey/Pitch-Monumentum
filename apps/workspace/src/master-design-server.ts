import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDesignWorkspaceServer } from "./design-server.js";
import { executeWorkspaceSlideMasterCommand, readSlideMasterState, type WorkspaceSlideMasterCommand } from "./master-runtime.js";

function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage, limit = 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > limit) throw new Error("Master command body exceeds 1 MB"); chunks.push(buffer); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
async function editorBundle(): Promise<string> {
  const [editor, design, masters] = await Promise.all([
    readFile(resolve("apps", "workspace", "public", "editor-spike.js"), "utf8"),
    readFile(resolve("apps", "workspace", "public", "design-system-ui.js"), "utf8"),
    readFile(resolve("apps", "workspace", "public", "slide-masters-ui.js"), "utf8"),
  ]);
  return `${editor}\n;/* Pitch Design System 2.0 */\n${design}\n;/* Pitch Slide Masters */\n${masters}\n`;
}

export function createMasterDesignWorkspaceServer(projectRoot: string) {
  const inner = createDesignWorkspaceServer(projectRoot);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (req.method === "GET" && url.pathname === "/editor-spike.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); res.end(await editorBundle()); return;
      }
      if (req.method === "GET" && url.pathname === "/api/master-state") { json(res, 200, await readSlideMasterState(inner.service, url.searchParams.get("slideId") ?? undefined)); return; }
      if (req.method === "POST" && url.pathname === "/api/master-command") { json(res, 200, await executeWorkspaceSlideMasterCommand(inner.service, await body(req) as WorkspaceSlideMasterCommand)); return; }
      inner.server.emit("request", req, res);
    } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  return { server, service: inner.service };
}

if (process.argv[1]?.endsWith("master-design-server.js")) {
  const root = process.argv[2] ?? ".pitch-demo"; const port = Number(process.argv[3] ?? "4173");
  const { server } = createMasterDesignWorkspaceServer(root);
  server.listen(port, "127.0.0.1", () => console.log(`Pitch Monumentum Master + Design Workspace: http://127.0.0.1:${port}/editor-spike`));
}
