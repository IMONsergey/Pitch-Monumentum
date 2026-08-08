import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createVersionsWorkspaceServer } from "./versions-server.js";
import { ReviewWorkspaceRuntime } from "../../review/src/runtime.js";
import { reviewDeliveryGate } from "../../../packages/review-engine/src/delivery.js";
import type { WorkspaceReviewCommand } from "../../review/src/runtime.js";

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage, limit = 1024 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk); size += buffer.length;
    if (size > limit) throw new Error("Review request body exceeds 1 MB");
    chunks.push(buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function editorBundle(): Promise<string> {
  const names = ["editor-spike.js", "design-system-ui.js", "slide-masters-ui.js", "creative-director-ui.js", "creative-preview-ui.js", "creative-runs-ui.js", "versions-ui.js", "review-ui.js"];
  const parts = await Promise.all(names.map((name) => readFile(resolve("apps", "workspace", "public", name), "utf8")));
  return `${parts.join("\n;\n")}\n`;
}

export function createReviewWorkspaceServer(projectRoot: string) {
  const root = resolve(projectRoot);
  const inner = createVersionsWorkspaceServer(root);
  const review = new ReviewWorkspaceRuntime(root);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (req.method === "GET" && url.pathname === "/editor-spike.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(await editorBundle()); return;
      }
      if (req.method === "GET" && url.pathname === "/api/review-state") {
        const state = await review.state();
        const deck = await review.service.state();
        json(res, 200, { ...state, delivery: reviewDeliveryGate(deck.deck, state.document) }); return;
      }
      if (req.method === "POST" && url.pathname === "/api/review-command") {
        const result = await review.command(await body(req) as WorkspaceReviewCommand);
        const deck = await review.service.state();
        json(res, 200, { ...result, delivery: reviewDeliveryGate(deck.deck, result.document) }); return;
      }
      if (req.method === "POST" && url.pathname === "/api/review-undo") {
        const result = await review.undo(); const deck = await review.service.state(); json(res, 200, { ...result, delivery: reviewDeliveryGate(deck.deck, result.document) }); return;
      }
      if (req.method === "POST" && url.pathname === "/api/review-redo") {
        const result = await review.redo(); const deck = await review.service.state(); json(res, 200, { ...result, delivery: reviewDeliveryGate(deck.deck, result.document) }); return;
      }
      if (req.method === "POST" && url.pathname === "/api/review-delivery-gate") {
        const input = await body(req) as { requireDeckApproval?: boolean; requireSlideApprovalIds?: string[]; blockOnOrphanedBlockingThreads?: boolean };
        const state = await review.state(); const deck = await review.service.state();
        json(res, 200, reviewDeliveryGate(deck.deck, state.document, input)); return;
      }
      if (req.method === "POST" && url.pathname === "/api/export") {
        const reviewState = await review.state();
        const deckState = await review.service.state();
        const gate = reviewDeliveryGate(deckState.deck, reviewState.document);
        if (!gate.ready) {
          json(res, 409, { error: "Production export blocked by unresolved review/approval state", reviewGate: gate });
          return;
        }
        const exported = await inner.service.exportPptx();
        json(res, 200, { ...exported, reviewGate: gate });
        return;
      }
      inner.server.emit("request", req, res);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server, service: inner.service, review, versions: inner.versions, director: inner.director };
}

if (process.argv[1]?.endsWith("review-server.js")) {
  const root = process.argv[2] ?? ".pitch-demo"; const port = Number(process.argv[3] ?? "4173");
  const { server } = createReviewWorkspaceServer(root);
  server.listen(port, "127.0.0.1", () => console.log(`Pitch Monumentum Review Workspace: http://127.0.0.1:${port}/editor-spike`));
}
