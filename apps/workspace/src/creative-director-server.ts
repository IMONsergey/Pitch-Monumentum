import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createMasterDesignWorkspaceServer } from "./master-design-server.js";
import { CreativeDirectorRuntime, type CreativeDirectorPreparation } from "../../creative-director/src/runtime.js";
import { executeCreativeSafeFixes, previewCreativeSafeFixes } from "../../creative-director/src/autofix-runtime.js";
import { acceptCreativePreview, discardCreativePreview, reviewCreativePreview } from "../../creative-director/src/branch-review.js";
import { listCreativeRuns, readCreativeRun } from "../../creative-director/src/audit-runtime.js";
import type { CreativeChangeRequest } from "../../../packages/creative-director/src/index.js";
import type { CreativeExecutionBundle } from "../../../packages/creative-director/src/execution.js";

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
    if (size > limit) throw new Error("Creative Director request body exceeds 1 MB");
    chunks.push(buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function editorBundle(): Promise<string> {
  const [editor, design, masters, director, preview] = await Promise.all([
    readFile(resolve("apps", "workspace", "public", "editor-spike.js"), "utf8"),
    readFile(resolve("apps", "workspace", "public", "design-system-ui.js"), "utf8"),
    readFile(resolve("apps", "workspace", "public", "slide-masters-ui.js"), "utf8"),
    readFile(resolve("apps", "workspace", "public", "creative-director-ui.js"), "utf8"),
    readFile(resolve("apps", "workspace", "public", "creative-preview-ui.js"), "utf8"),
  ]);
  return `${editor}\n;/* Pitch Design System 2.0 */\n${design}\n;/* Pitch Slide Masters */\n${masters}\n;/* Pitch Creative Director */\n${director}\n;/* Pitch Creative Preview Review */\n${preview}\n`;
}

function compactReview(reviewed: Awaited<ReturnType<CreativeDirectorRuntime["review"]>>) {
  return {
    deckId: reviewed.state.deck.id,
    deckHash: reviewed.state.deckHash,
    activeBranchId: reviewed.state.manifest.activeBranchId,
    review: reviewed.review,
    assets: reviewed.input.assets,
    motion: reviewed.input.motion,
    brandCoverage: reviewed.input.brandCoverage,
    brandQA: reviewed.input.brandQA,
    masterQA: reviewed.input.masterQA,
  };
}

export function createCreativeDirectorWorkspaceServer(projectRoot: string) {
  const root = resolve(projectRoot);
  const inner = createMasterDesignWorkspaceServer(root);
  const director = new CreativeDirectorRuntime(root);
  const plans = new Map<string, CreativeDirectorPreparation>();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (req.method === "GET" && url.pathname === "/editor-spike.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(await editorBundle());
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/creative-review") {
        const reviewed = await director.review();
        const activeBranch = reviewed.state.manifest.branches[reviewed.state.manifest.activeBranchId];
        const previewReview = activeBranch?.parentBranchId ? await reviewCreativePreview(director.service, activeBranch.id).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })) : null;
        json(res, 200, { ...compactReview(reviewed), previewReview, recentRuns: await listCreativeRuns(director.service, reviewed.state.manifest.activeBranchId) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/creative-runs") {
        json(res, 200, { runs: await listCreativeRuns(director.service, url.searchParams.get("branchId") ?? undefined) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/creative-run") {
        const runId = url.searchParams.get("runId");
        if (!runId) throw new Error("runId is required");
        json(res, 200, await readCreativeRun(director.service, runId, url.searchParams.get("branchId") ?? undefined));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/creative-preview-review") {
        const branchId = url.searchParams.get("branchId") || (await director.service.state()).manifest.activeBranchId;
        json(res, 200, await reviewCreativePreview(director.service, branchId));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/creative-preview-accept") {
        const input = await body(req) as { previewBranchId: string; expectedTargetDeckHash: string; expectedPreviewDeckHash: string };
        const result = await acceptCreativePreview(director.service, input);
        json(res, 200, { review: result.review, acceptedIntoBranchId: result.acceptedIntoBranchId, previewBranchId: result.previewBranchId, deckHash: result.state.deckHash, activeBranchId: result.state.manifest.activeBranchId, history: result.state.history, motionHistory: result.state.motionHistory });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/creative-preview-discard") {
        const input = await body(req) as { previewBranchId: string };
        const result = await discardCreativePreview(director.service, input.previewBranchId);
        json(res, 200, { review: result.review, discardedPreviewBranchId: result.discardedPreviewBranchId, activeBranchId: result.activeBranchId, deckHash: result.state.deckHash });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/creative-safe-fixes") {
        json(res, 200, await previewCreativeSafeFixes(director.service));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/creative-safe-fixes") {
        const input = await body(req) as { expectedDeckHash?: string };
        const result = await executeCreativeSafeFixes(director.service, input.expectedDeckHash);
        json(res, 200, { deckHash: result.deckHash, activeBranchId: result.manifest.activeBranchId, plan: result.plan, commandReason: result.commandReason, affectedSlideIds: result.affectedSlideIds, affectedElementIds: result.affectedElementIds, history: result.history });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/creative-plan") {
        const request = await body(req) as CreativeChangeRequest;
        const prepared = await director.prepare(request);
        plans.set(prepared.plan.requestId, prepared);
        json(res, 200, { plan: prepared.plan, deckHash: prepared.deckHash, activeBranchId: prepared.activeBranchId });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/creative-plan-status") {
        const requestId = url.searchParams.get("requestId") ?? "";
        const prepared = plans.get(requestId);
        const current = await director.service.state();
        json(res, 200, prepared ? {
          requestId,
          exists: true,
          stale: current.deckHash !== prepared.deckHash || current.manifest.activeBranchId !== prepared.activeBranchId,
          plannedDeckHash: prepared.deckHash,
          currentDeckHash: current.deckHash,
          plannedBranchId: prepared.activeBranchId,
          currentBranchId: current.manifest.activeBranchId,
          plan: prepared.plan,
        } : { requestId, exists: false, currentDeckHash: current.deckHash, currentBranchId: current.manifest.activeBranchId });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/creative-execute") {
        const input = await body(req) as { requestId: string; bundle: Omit<CreativeExecutionBundle, "schemaVersion" | "requestId" | "deckId">; acceptanceResults?: Record<string, boolean> };
        const prepared = plans.get(input.requestId);
        if (!prepared) throw new Error(`No server-issued Creative Director plan ${input.requestId}`);
        const current = await director.service.state();
        if (current.deckHash !== prepared.deckHash || current.manifest.activeBranchId !== prepared.activeBranchId) {
          plans.delete(input.requestId);
          json(res, 409, { error: "Creative Director plan is stale; re-plan against current deck state", stalePlan: true, plannedDeckHash: prepared.deckHash, currentDeckHash: current.deckHash });
          return;
        }
        const bundle: CreativeExecutionBundle = { schemaVersion: "0.1", requestId: prepared.plan.requestId, deckId: prepared.plan.deckId, ...input.bundle };
        const result = await director.execute(prepared.plan, bundle, input.acceptanceResults ?? {});
        plans.delete(input.requestId);
        json(res, result.validation.valid ? 200 : 400, result);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/creative-discard-plan") {
        const input = await body(req) as { requestId?: string };
        if (input.requestId) plans.delete(input.requestId);
        json(res, 200, { removed: input.requestId ?? null });
        return;
      }
      inner.server.emit("request", req, res);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return { server, service: inner.service, director };
}

if (process.argv[1]?.endsWith("creative-director-server.js")) {
  const root = process.argv[2] ?? ".pitch-demo";
  const port = Number(process.argv[3] ?? "4173");
  const { server } = createCreativeDirectorWorkspaceServer(root);
  server.listen(port, "127.0.0.1", () => console.log(`Pitch Monumentum Creative Director Workspace: http://127.0.0.1:${port}/editor-spike`));
}
