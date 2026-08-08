import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArtifactStore, type ProjectManifest, type BranchArtifactHead } from "../../../packages/artifact-store/src/index.js";
import { AssetRegistry, type ImageMimeType } from "../../../packages/assets/src/index.js";
import type { AutoLayoutSpec, DeckDocument, ImageElement } from "../../../packages/deck-model/src/index.js";
import { applyDeckMutation, createMutation, deckHash, type DeckMutationOperation } from "../../../packages/mutations/src/index.js";
import { setAutoLayoutMutationOperations, wrapSelectionInAutoLayoutOperations } from "../../../packages/auto-layout/src/index.js";
import { runDeterministicQA } from "../../../packages/qa/src/index.js";
import { exportProductionPptx } from "../../../packages/export-pipeline/src/index.js";
import { VersionJournal } from "../../../packages/version-history/src/index.js";
import { editorSpikeHtml, workspaceHtml } from "./ui.js";

function json(res: any, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
async function body(req: any): Promise<any> {
  const parts: Buffer[] = [];
  for await (const chunk of req) parts.push(Buffer.from(chunk));
  if (!parts.length) return {};
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
function activeHeadByKind(manifest: ProjectManifest, kind: string): BranchArtifactHead | undefined {
  return Object.values(manifest.branches[manifest.activeBranchId]?.heads ?? {}).find((head) => head.kind === kind);
}
async function staticAsset(name: "workspace.css" | "workspace.js" | "editor-spike.js"): Promise<string> {
  return readFile(resolve("apps", "workspace", "public", name), "utf8");
}

function fittedImageSize(widthPx: number, heightPx: number, widthDU?: number, heightDU?: number): { width: number; height: number } {
  if (widthDU !== undefined && heightDU !== undefined) return { width: Math.max(1, widthDU), height: Math.max(1, heightDU) };
  if (widthDU !== undefined) return { width: Math.max(1, widthDU), height: Math.max(1, Math.round(widthDU * heightPx / widthPx)) };
  if (heightDU !== undefined) return { width: Math.max(1, Math.round(heightDU * widthPx / heightPx)), height: Math.max(1, heightDU) };
  const scale = Math.min(720 / widthPx, 540 / heightPx);
  return { width: Math.max(1, Math.round(widthPx * scale)), height: Math.max(1, Math.round(heightPx * scale)) };
}

export class PitchWorkspaceService {
  readonly root: string;
  readonly store: ArtifactStore;
  readonly journal: VersionJournal;
  readonly assets: AssetRegistry;
  constructor(root: string) {
    this.root = resolve(root);
    this.store = new ArtifactStore(this.root);
    this.journal = new VersionJournal(this.root);
    this.assets = new AssetRegistry(this.root);
  }

  async state() {
    const manifest = await this.store.readManifest();
    const head = activeHeadByKind(manifest, "deck");
    if (!head) throw new Error("No deck artifact on active branch");
    const storedDeck = (await this.store.read<DeckDocument>(head.id, head.version)).payload;
    const deck = storedDeck.activeBranchId === manifest.activeBranchId ? storedDeck : { ...storedDeck, activeBranchId: manifest.activeBranchId };
    const qa = runDeterministicQA(deck);
    const history = await this.journal.status(manifest.activeBranchId, head.id);
    const assets = await this.assets.list();
    return { manifest, deck, deckHash: deckHash(deck), qa, history, assets };
  }

  async mutate(input: { reason?: string; operations: DeckMutationOperation[]; expectedDeckHash?: string }) {
    const current = await this.state();
    const head = activeHeadByKind(current.manifest, "deck")!;
    await this.journal.record(current.manifest.activeBranchId, head);
    const mutation = createMutation(input.reason ?? "Workspace edit", input.operations, "user", input.expectedDeckHash);
    const applied = applyDeckMutation(current.deck, mutation);
    const deckArtifact = await this.store.write({ id: head.id, kind: "deck", payload: applied.deck, producer: { type: "user" }, inputs: [head] });
    await this.journal.record(current.manifest.activeBranchId, { id: deckArtifact.id, kind: deckArtifact.kind, version: deckArtifact.version, contentHash: deckArtifact.contentHash, status: deckArtifact.status });
    const qa = runDeterministicQA(applied.deck);
    await this.store.write({
      id: "qa_current", kind: "qa", payload: { deckId: applied.deck.id, issues: qa, mutationId: mutation.id, impact: applied.impact },
      producer: { type: "deterministic" }, inputs: [deckArtifact], status: qa.some((issue) => issue.severity === "critical") ? "needsReview" : "ready"
    });
    return this.state();
  }

  async setAutoLayout(input: { slideId: string; elementId: string; layout: AutoLayoutSpec; expectedDeckHash?: string }) {
    const current = await this.state();
    if (input.expectedDeckHash && input.expectedDeckHash !== current.deckHash) {
      throw new Error(`Deck changed since auto-layout edit was authored: expected ${input.expectedDeckHash}, got ${current.deckHash}`);
    }
    const slide = current.deck.slides.find((item) => item.id === input.slideId);
    if (!slide) throw new Error(`Unknown slide: ${input.slideId}`);
    const operations = setAutoLayoutMutationOperations(slide, input.elementId, input.layout);
    return this.mutate({ reason: `Set auto layout on ${input.elementId}`, operations, expectedDeckHash: current.deckHash });
  }

  async wrapSelectionInAutoLayout(input: {
    slideId: string;
    selectedIds: string[];
    direction?: AutoLayoutSpec["direction"];
    gapDU?: number;
    paddingDU?: number;
    expectedDeckHash?: string;
  }) {
    const current = await this.state();
    if (input.expectedDeckHash && input.expectedDeckHash !== current.deckHash) {
      throw new Error(`Deck changed since auto-layout wrap was authored: expected ${input.expectedDeckHash}, got ${current.deckHash}`);
    }
    const slide = current.deck.slides.find((item) => item.id === input.slideId);
    if (!slide) throw new Error(`Unknown slide: ${input.slideId}`);
    const built = wrapSelectionInAutoLayoutOperations(slide, input.selectedIds, {
      direction: input.direction,
      gapDU: input.gapDU,
      paddingDU: input.paddingDU,
    });
    const next = await this.mutate({ reason: `Wrap selection in auto layout ${built.frameId}`, operations: built.operations, expectedDeckHash: current.deckHash });
    return { ...next, createdFrameId: built.frameId };
  }

  async insertImageAsset(input: {
    assetId: string;
    slideId?: string;
    xDU?: number;
    yDU?: number;
    widthDU?: number;
    heightDU?: number;
    expectedDeckHash?: string;
  }) {
    const current = await this.state();
    if (input.expectedDeckHash && input.expectedDeckHash !== current.deckHash) {
      throw new Error(`Deck changed since image insertion was authored: expected ${input.expectedDeckHash}, got ${current.deckHash}`);
    }
    const record = await this.assets.get(input.assetId);
    const slide = input.slideId
      ? current.deck.slides.find((item) => item.id === input.slideId)
      : current.deck.slides[0];
    if (!slide) throw new Error(`Unknown slide: ${input.slideId ?? "<first>"}`);
    const size = fittedImageSize(record.width, record.height, input.widthDU, input.heightDU);
    const maxX = Math.max(0, current.deck.canvas.widthDU - size.width);
    const maxY = Math.max(0, current.deck.canvas.heightDU - size.height);
    const x = Math.max(0, Math.min(maxX, input.xDU ?? Math.round((current.deck.canvas.widthDU - size.width) / 2)));
    const y = Math.max(0, Math.min(maxY, input.yDU ?? Math.round((current.deck.canvas.heightDU - size.height) / 2)));
    const element: ImageElement = {
      id: `image_${randomUUID()}`,
      type: "image",
      name: record.originalName,
      semanticRole: "visual",
      geometry: { x, y, width: size.width, height: size.height },
      zIndex: Math.max(0, ...slide.scene.map((item) => item.zIndex)) + 1,
      origin: "user",
      exportStrategy: "native",
      dependencies: [{ kind: "asset", id: record.id }],
      assetId: record.id,
      fit: "cover",
      alt: record.originalName,
    };
    const next = await this.mutate({
      reason: `Insert image asset ${record.id}`,
      expectedDeckHash: current.deckHash,
      operations: [{ op: "addElement", slideId: slide.id, element }],
    });
    return { ...next, insertedElementId: element.id, asset: record };
  }

  async uploadImage(input: {
    bytesBase64: string;
    originalName: string;
    mimeType?: ImageMimeType;
    slideId?: string;
    xDU?: number;
    yDU?: number;
    widthDU?: number;
    heightDU?: number;
    expectedDeckHash?: string;
  }) {
    if (!input.bytesBase64 || !input.originalName) throw new Error("bytesBase64 and originalName are required");
    const record = await this.assets.registerImage({
      bytes: Buffer.from(input.bytesBase64, "base64"),
      originalName: input.originalName,
      mimeType: input.mimeType,
      provenance: { source: "import", label: input.originalName },
    });
    return this.insertImageAsset({
      assetId: record.id,
      slideId: input.slideId,
      xDU: input.xDU,
      yDU: input.yDU,
      widthDU: input.widthDU,
      heightDU: input.heightDU,
      expectedDeckHash: input.expectedDeckHash,
    });
  }

  async fork(name: string) {
    const before = await this.state();
    const parentId = before.manifest.activeBranchId;
    const head = activeHeadByKind(before.manifest, "deck")!;
    await this.journal.record(parentId, head);
    const id = await this.store.forkBranch(name);
    await this.journal.fork(parentId, id);
    return this.state();
  }
  async checkout(branchId: string) { await this.store.checkoutBranch(branchId); return this.state(); }
  async undo() {
    const current = await this.state();
    const head = activeHeadByKind(current.manifest, "deck")!;
    await this.journal.undo(current.manifest.activeBranchId, head.id);
    return this.state();
  }
  async redo() {
    const current = await this.state();
    const head = activeHeadByKind(current.manifest, "deck")!;
    await this.journal.redo(current.manifest.activeBranchId, head.id);
    return this.state();
  }
  async exportPptx() {
    const current = await this.state();
    const head = activeHeadByKind(current.manifest, "deck")!;
    const dir = join(this.root, ".project", "exports");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${current.deck.id}-v${head.version}.pptx`);
    const imageAssetIds = new Set(current.deck.slides.flatMap((slide) => slide.scene
      .filter((element): element is ImageElement => element.type === "image")
      .map((element) => element.assetId)));
    const assets = await this.assets.resolveRichAssets(imageAssetIds);
    const manifest = await exportProductionPptx(current.deck, path, { assets });
    return { path, manifest };
  }
}

export function createWorkspaceServer(projectRoot: string) {
  const service = new PitchWorkspaceService(projectRoot);
  const server = createServer(async (req: any, res: any) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(workspaceHtml()); return; }
      if (req.method === "GET" && url.pathname === "/editor-spike") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(editorSpikeHtml()); return; }
      if (req.method === "GET" && url.pathname === "/workspace.css") { res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" }); res.end(await staticAsset("workspace.css")); return; }
      if (req.method === "GET" && url.pathname === "/workspace.js") { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); res.end(await staticAsset("workspace.js")); return; }
      if (req.method === "GET" && url.pathname === "/editor-spike.js") { res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }); res.end(await staticAsset("editor-spike.js")); return; }
      if (req.method === "GET" && url.pathname === "/api/project") { json(res, 200, await service.state()); return; }
      if (req.method === "GET" && url.pathname.startsWith("/api/assets/")) {
        const assetId = decodeURIComponent(url.pathname.slice("/api/assets/".length));
        const record = await service.assets.get(assetId);
        const bytes = await service.assets.readBytes(assetId);
        res.writeHead(200, {
          "content-type": record.mimeType,
          "content-length": String(bytes.length),
          "cache-control": "private, max-age=31536000, immutable",
          etag: `\"${record.contentHash}\"`,
        });
        res.end(bytes);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/mutate") { json(res, 200, await service.mutate(await body(req))); return; }
      if (req.method === "POST" && url.pathname === "/api/auto-layout") {
        const data = await body(req);
        if (!data.slideId || !data.elementId || !data.layout) throw new Error("slideId, elementId and layout are required");
        json(res, 200, await service.setAutoLayout(data));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/wrap-auto-layout") {
        const data = await body(req);
        if (!data.slideId || !Array.isArray(data.selectedIds)) throw new Error("slideId and selectedIds are required");
        json(res, 200, await service.wrapSelectionInAutoLayout(data));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/assets/upload") { json(res, 200, await service.uploadImage(await body(req))); return; }
      if (req.method === "POST" && url.pathname === "/api/assets/insert") { json(res, 200, await service.insertImageAsset(await body(req))); return; }
      if (req.method === "POST" && url.pathname === "/api/branch") { const data = await body(req); if (!data.name) throw new Error("Branch name required"); json(res, 200, await service.fork(data.name)); return; }
      if (req.method === "POST" && url.pathname === "/api/checkout") { const data = await body(req); if (!data.branchId) throw new Error("branchId required"); json(res, 200, await service.checkout(data.branchId)); return; }
      if (req.method === "POST" && url.pathname === "/api/undo") { json(res, 200, await service.undo()); return; }
      if (req.method === "POST" && url.pathname === "/api/redo") { json(res, 200, await service.redo()); return; }
      if (req.method === "POST" && url.pathname === "/api/export") { json(res, 200, await service.exportPptx()); return; }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server, service };
}

if (process.argv[1]?.endsWith("server.js")) {
  const projectRoot = process.argv[2] ?? ".pitch-demo";
  const port = Number(process.argv[3] ?? "4173");
  const { server } = createWorkspaceServer(projectRoot);
  server.listen(port, "127.0.0.1", () => console.log(`Pitch Monumentum workspace: http://127.0.0.1:${port}`));
}
