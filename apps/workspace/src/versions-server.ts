import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCreativeDirectorWorkspaceServer } from "./creative-director-server.js";
import { VersionWorkspaceRuntime } from "../../versions/src/runtime.js";

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage, limit = 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("Versions request body exceeds 1 MB");
    chunks.push(buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export function createVersionsWorkspaceServer(projectRoot: string) {
  const root = resolve(projectRoot);
  const inner = createCreativeDirectorWorkspaceServer(root);
  const versions = new VersionWorkspaceRuntime(root);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (req.method === "GET" && url.pathname === "/editor-spike.js") {
        const [editor, design, masters, director, preview, runs, versionUi] = await Promise.all([
          readFile(resolve("apps", "workspace", "public", "editor-spike.js"), "utf8"),
          readFile(resolve("apps", "workspace", "public", "design-system-ui.js"), "utf8"),
          readFile(resolve("apps", "workspace", "public", "slide-masters-ui.js"), "utf8"),
          readFile(resolve("apps", "workspace", "public", "creative-director-ui.js"), "utf8"),
          readFile(resolve("apps", "workspace", "public", "creative-preview-ui.js"), "utf8"),
          readFile(resolve("apps", "workspace", "public", "creative-runs-ui.js"), "utf8"),
          readFile(resolve("apps", "workspace", "public", "versions-ui.js"), "utf8"),
        ]);
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(`${editor}\n${design}\n${masters}\n${director}\n${preview}\n${runs}\n${versionUi}\n`);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/versions-state") {
        json(res, 200, await versions.state());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/versions-checkpoint") {
        const input = await body(req) as { name?: string; description?: string };
        if (!input.name) throw new Error("Checkpoint name is required");
        json(res, 200, { checkpoint: await versions.createCheckpoint(input.name, input.description), state: await versions.state() });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/versions-checkpoint-remove") {
        const input = await body(req) as { checkpointId?: string };
        if (!input.checkpointId) throw new Error("checkpointId is required");
        await versions.removeCheckpoint(input.checkpointId);
        json(res, 200, await versions.state());
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/versions-checkpoint-restore") {
        const input = await body(req) as { checkpointId?: string; branchName?: string };
        if (!input.checkpointId) throw new Error("checkpointId is required");
        const restored = await versions.restoreCheckpoint(input.checkpointId, input.branchName);
        json(res, 200, { checkpoint: restored.checkpoint, restoredBranchId: restored.restoredBranchId, deckHash: restored.state.deckHash, activeBranchId: restored.state.manifest.activeBranchId, versions: await versions.state() });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/versions-branch") {
        const input = await body(req) as { name?: string };
        if (!input.name) throw new Error("Branch name is required");
        const state = await versions.createBranch(input.name);
        json(res, 200, { deckHash: state.deckHash, activeBranchId: state.manifest.activeBranchId, versions: await versions.state() });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/versions-checkout") {
        const input = await body(req) as { branchId?: string };
        if (!input.branchId) throw new Error("branchId is required");
        const state = await versions.checkout(input.branchId);
        json(res, 200, { deckHash: state.deckHash, activeBranchId: state.manifest.activeBranchId, versions: await versions.state() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/versions-compare") {
        const before = url.searchParams.get("before"); const after = url.searchParams.get("after");
        if (!before || !after) throw new Error("before and after branch ids are required");
        json(res, 200, await versions.compareBranches(before, after));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/versions-checkpoint-compare") {
        const checkpointId = url.searchParams.get("checkpointId");
        if (!checkpointId) throw new Error("checkpointId is required");
        json(res, 200, await versions.compareCheckpoint(checkpointId, url.searchParams.get("branchId") ?? undefined));
        return;
      }
      inner.server.emit("request", req, res);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server, service: inner.service, versions, director: inner.director };
}

if (process.argv[1]?.endsWith("versions-server.js")) {
  const root = process.argv[2] ?? ".pitch-demo";
  const port = Number(process.argv[3] ?? "4173");
  const { server } = createVersionsWorkspaceServer(root);
  server.listen(port, "127.0.0.1", () => console.log(`Pitch Monumentum Versions Workspace: http://127.0.0.1:${port}/editor-spike`));
}
