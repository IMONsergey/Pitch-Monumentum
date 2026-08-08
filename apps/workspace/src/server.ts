import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArtifactStore, type ProjectManifest, type BranchArtifactHead } from "../../../packages/artifact-store/src/index.js";
import { ProjectAssetStore, type ImportImageAssetInput } from "../../../packages/asset-store/src/index.js";
import type { AutoLayoutSpec, DeckDocument } from "../../../packages/deck-model/src/index.js";
import { applyDeckMutation, createMutation, deckHash, type DeckMutationOperation } from "../../../packages/mutations/src/index.js";
import { setAutoLayoutMutationOperations, wrapSelectionInAutoLayoutOperations } from "../../../packages/auto-layout/src/index.js";
import { executeEditorCommand, type EditorCommandInput } from "../../../packages/editor-commands/src/service.js";
import { executeSlideCommand, isSlideCommand, type SlideCommandInput } from "../../../packages/slide-commands/src/index.js";
import { executePitchCodexTool, pitchCodexToolDefinitions, type PitchCodexToolCall } from "../../../packages/codex-editor-tools/src/index.js";
import { runDeterministicQA } from "../../../packages/qa/src/index.js";
import { exportProductionPptx } from "../../../packages/export-pipeline/src/index.js";
import { VersionJournal } from "../../../packages/version-history/src/index.js";
import type { MotionDocument } from "../../../packages/motion-engine/src/index.js";
import { emptyMotionDocument, executeMotionCommand, reconcileMotionDocument, type MotionCommand } from "../../../packages/motion-commands/src/index.js";
import { executeMediaCommand, type MediaCommand } from "../../../packages/media-commands/src/index.js";
import type { ComponentDefinition, ComponentOverride, ComponentInstanceTransform } from "../../../packages/components/src/index.js";
import { createComponentDefinitionFromSelection, detachComponentFromDeck, instantiateComponentIntoDeck } from "../../../packages/component-commands/src/index.js";
import { editorSpikeHtml, workspaceHtml } from "./ui.js";

function json(res: any, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
function binary(res: any, status: number, value: Buffer, mimeType: string, filename?: string): void {
  res.writeHead(status, {
    "content-type": mimeType,
    "content-length": String(value.length),
    "cache-control": "private, max-age=31536000, immutable",
    ...(filename ? { "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}` } : {}),
  });
  res.end(value);
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
function activeHeadsByKind(manifest: ProjectManifest, kind: string): BranchArtifactHead[] {
  return Object.values(manifest.branches[manifest.activeBranchId]?.heads ?? {}).filter((head) => head.kind === kind);
}
async function staticAsset(name: "workspace.css" | "workspace.js" | "editor-spike.js"): Promise<string> {
  return readFile(resolve("apps", "workspace", "public", name), "utf8");
}

type EditorCommandRequest = (EditorCommandInput | SlideCommandInput) & { expectedDeckHash?: string };
type MotionCommandRequest = MotionCommand & { expectedDeckHash?: string; expectedMotionHash?: string };
type MediaCommandRequest = MediaCommand & { expectedDeckHash?: string };
type ComponentCommandRequest =
  | { command: "createFromSelection"; slideId: string; selectedIds: string[]; name: string; componentId?: string; description?: string; expectedDeckHash?: string }
  | { command: "insert"; slideId: string; componentId: string; transform: ComponentInstanceTransform; overrides?: ComponentOverride[]; instanceId?: string; expectedDeckHash?: string }
  | { command: "detach"; slideId: string; instanceId: string; expectedDeckHash?: string };

function impactForVisualEdit(affectedSlideIds: string[], affectedElementIds: string[]) {
  return {
    affectedSlideIds,
    affectedElementIds,
    staleArtifacts: ["qa:visual", "qa:readability", "export"],
    narrativeChanged: false,
    evidenceRisk: false,
    slideOrderChanged: false,
  };
}

export class PitchWorkspaceService {
  readonly root: string;
  readonly store: ArtifactStore;
  readonly journal: VersionJournal;
  readonly assets: ProjectAssetStore;
  constructor(root: string) {
    this.root = resolve(root);
    this.store = new ArtifactStore(this.root);
    this.journal = new VersionJournal(this.root);
    this.assets = new ProjectAssetStore(this.root);
  }

  async state() {
    const manifest = await this.store.readManifest();
    const head = activeHeadByKind(manifest, "deck");
    if (!head) throw new Error("No deck artifact on active branch");
    const storedDeck = (await this.store.read<DeckDocument>(head.id, head.version)).payload;
    const deck = storedDeck.activeBranchId === manifest.activeBranchId ? storedDeck : { ...storedDeck, activeBranchId: manifest.activeBranchId };
    const qa = runDeterministicQA(deck);
    const history = await this.journal.status(manifest.activeBranchId, head.id);

    const motionHead = activeHeadByKind(manifest, "motion");
    const storedMotion = motionHead ? (await this.store.read<MotionDocument>(motionHead.id, motionHead.version)).payload : emptyMotionDocument(deck);
    const motion = reconcileMotionDocument(deck, storedMotion);
    const motionHistory = motionHead
      ? await this.journal.status(manifest.activeBranchId, motionHead.id)
      : { canUndo: false, canRedo: false, depth: 0, cursor: -1 };

    const componentHeads = activeHeadsByKind(manifest, "component");
    const components = await Promise.all(componentHeads.map(async (componentHead) => {
      const definition = (await this.store.read<ComponentDefinition>(componentHead.id, componentHead.version)).payload;
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        widthDU: definition.widthDU,
        heightDU: definition.heightDU,
        slots: definition.slots,
        version: componentHead.version,
        contentHash: componentHead.contentHash,
      };
    }));
    const assetItems = await this.assets.list();
    const assetUsage = await this.assets.usage(deck);
    const assets = assetItems.map(asset => ({ ...asset, usageCount: assetUsage[asset.id] ?? 0, contentUrl: `/api/assets/${encodeURIComponent(asset.id)}/content` }));

    return {
      manifest,
      deck,
      deckHash: deckHash(deck),
      qa,
      history,
      motion,
      motionHash: motionHead?.contentHash,
      motionHistory,
      components,
      assets,
    };
  }

  private async writeDeckVersion(input: {
    current: Awaited<ReturnType<PitchWorkspaceService["state"]>>;
    deck: DeckDocument;
    reason: string;
    impact: unknown;
    producer?: "user" | "codex" | "deterministic";
  }) {
    const head = activeHeadByKind(input.current.manifest, "deck")!;
    await this.journal.record(input.current.manifest.activeBranchId, head);
    const deckArtifact = await this.store.write({
      id: head.id,
      kind: "deck",
      payload: input.deck,
      producer: { type: input.producer ?? "user" },
      inputs: [head],
    });
    await this.journal.record(input.current.manifest.activeBranchId, {
      id: deckArtifact.id,
      kind: deckArtifact.kind,
      version: deckArtifact.version,
      contentHash: deckArtifact.contentHash,
      status: deckArtifact.status,
    });
    const qa = runDeterministicQA(input.deck);
    await this.store.write({
      id: "qa_current",
      kind: "qa",
      payload: { deckId: input.deck.id, issues: qa, reason: input.reason, impact: input.impact },
      producer: { type: "deterministic" },
      inputs: [deckArtifact],
      status: qa.some((issue) => issue.severity === "critical") ? "needsReview" : "ready",
    });
    return this.state();
  }

  private assertDeckHash(current: Awaited<ReturnType<PitchWorkspaceService["state"]>>, expectedDeckHash?: string): void {
    if (expectedDeckHash && expectedDeckHash !== current.deckHash) {
      throw new Error(`Deck changed since command was authored: expected ${expectedDeckHash}, got ${current.deckHash}`);
    }
  }

  async mutate(input: { reason?: string; operations: DeckMutationOperation[]; expectedDeckHash?: string }) {
    const current = await this.state();
    this.assertDeckHash(current, input.expectedDeckHash);
    const mutation = createMutation(input.reason ?? "Workspace edit", input.operations, "user", current.deckHash);
    const applied = applyDeckMutation(current.deck, mutation);
    return this.writeDeckVersion({ current, deck: applied.deck, reason: mutation.reason, impact: applied.impact });
  }

  async importAsset(input: ImportImageAssetInput) {
    const asset = await this.assets.importImage(input);
    return { ...(await this.state()), asset, commandReason: `Import asset ${asset.filename}` };
  }

  async removeAsset(assetId: string) {
    const current = await this.state();
    await this.assets.remove(assetId, current.deck);
    return { ...(await this.state()), removedAssetId: assetId, commandReason: `Remove asset ${assetId}` };
  }

  async assetContent(assetId: string) {
    const item = await this.assets.content(assetId);
    return { metadata: item.metadata, buffer: await readFile(item.path) };
  }

  async codexTool(call: PitchCodexToolCall) {
    const current = await this.state();
    const normalizedCall: PitchCodexToolCall = {
      ...call,
      expectedDeckHash: call.expectedDeckHash ?? current.deckHash,
    } as PitchCodexToolCall;
    const result = executePitchCodexTool(current.deck, normalizedCall);
    const next = await this.writeDeckVersion({
      current,
      deck: result.applied.deck,
      reason: `Codex tool ${result.tool}: ${result.command}`,
      impact: result.applied.impact,
      producer: "codex",
    });
    return {
      ...next,
      tool: result.tool,
      command: result.command,
      mutationId: result.mutationId,
      nextSelectionIds: result.nextSelectionIds,
      affectedSlideIds: result.affectedSlideIds,
      affectedElementIds: result.affectedElementIds,
    };
  }

  async editorCommand(input: EditorCommandRequest) {
    const current = await this.state();
    this.assertDeckHash(current, input.expectedDeckHash);

    if (isSlideCommand(input)) {
      const executed = executeSlideCommand(current.deck, input);
      const next = await this.writeDeckVersion({
        current,
        deck: executed.deck,
        reason: executed.reason,
        impact: {
          affectedSlideIds: executed.affectedSlideIds,
          affectedElementIds: [],
          staleArtifacts: ["storyboard", "qa:narrative", "qa:evidence", "qa:visual", "qa:readability", "export"],
          narrativeChanged: true,
          evidenceRisk: input.command === "deleteSlide",
          slideOrderChanged: input.command !== "renameSlide",
        },
      });
      return {
        ...next,
        nextSelectionIds: [],
        nextSlideId: executed.nextSlideId,
        reflowedContainerIds: [],
        commandReason: executed.reason,
      };
    }

    if (input.command === "insertImage") await this.assets.read(input.assetId);
    const executed = executeEditorCommand(current.deck, input);
    if (!executed.operations.length) {
      return {
        ...current,
        nextSelectionIds: executed.nextSelectionIds,
        reflowedContainerIds: executed.reflowedContainerIds,
        commandReason: executed.reason,
        clipboard: executed.clipboard,
      };
    }
    const next = await this.mutate({ reason: executed.reason, operations: executed.operations, expectedDeckHash: current.deckHash });
    return {
      ...next,
      nextSelectionIds: executed.nextSelectionIds,
      reflowedContainerIds: executed.reflowedContainerIds,
      commandReason: executed.reason,
      clipboard: executed.clipboard,
    };
  }

  async editorUndo() {
    const next = await this.undo();
    return { ...next, nextSelectionIds: [], reflowedContainerIds: [], commandReason: "Undo" };
  }

  async editorRedo() {
    const next = await this.redo();
    return { ...next, nextSelectionIds: [], reflowedContainerIds: [], commandReason: "Redo" };
  }

  async mediaCommand(input: MediaCommandRequest) {
    const current = await this.state();
    this.assertDeckHash(current, input.expectedDeckHash);
    const assetId = input.command === "replaceImageAsset" ? input.assetId : input.command === "setImageProperties" ? input.changes.assetId : undefined;
    if (assetId) await this.assets.read(assetId);
    const result = executeMediaCommand(current.deck, input);
    if (!result.changed) return { ...current, ...result, commandReason: result.reason };
    const next = await this.writeDeckVersion({
      current,
      deck: result.deck,
      reason: result.reason,
      impact: impactForVisualEdit(result.affectedSlideIds, result.affectedElementIds),
    });
    return { ...next, nextSelectionIds: result.nextSelectionIds, commandReason: result.reason };
  }

  async motionCommand(input: MotionCommandRequest) {
    const current = await this.state();
    this.assertDeckHash(current, input.expectedDeckHash);
    if (input.expectedMotionHash && current.motionHash && input.expectedMotionHash !== current.motionHash) {
      throw new Error(`Motion changed since command was authored: expected ${input.expectedMotionHash}, got ${current.motionHash}`);
    }
    const result = executeMotionCommand(current.deck, current.motion, input);
    if (!result.changed) return { ...current, ...result, commandReason: result.reason };

    const deckHead = activeHeadByKind(current.manifest, "deck")!;
    let motionHead = activeHeadByKind(current.manifest, "motion");
    const motionId = motionHead?.id ?? `motion_${current.deck.id}`;
    if (!motionHead) {
      const baseline = await this.store.write({ id: motionId, kind: "motion", payload: emptyMotionDocument(current.deck), producer: { type: "deterministic" }, inputs: [deckHead] });
      motionHead = { id: baseline.id, kind: baseline.kind, version: baseline.version, contentHash: baseline.contentHash, status: baseline.status };
      await this.journal.record(current.manifest.activeBranchId, motionHead);
    } else {
      await this.journal.record(current.manifest.activeBranchId, motionHead);
    }
    const artifact = await this.store.write({ id: motionId, kind: "motion", payload: result.motion, producer: { type: "user" }, inputs: [deckHead] });
    await this.journal.record(current.manifest.activeBranchId, { id: artifact.id, kind: artifact.kind, version: artifact.version, contentHash: artifact.contentHash, status: artifact.status });
    const next = await this.state();
    return {
      ...next,
      affectedSlideIds: result.affectedSlideIds,
      affectedElementIds: result.affectedElementIds,
      nextBuildId: result.nextBuildId,
      nextTrackId: result.nextTrackId,
      commandReason: result.reason,
    };
  }

  async motionUndo() {
    const current = await this.state();
    const head = activeHeadByKind(current.manifest, "motion");
    if (!head) throw new Error("Nothing to undo in motion history");
    await this.journal.undo(current.manifest.activeBranchId, head.id);
    return { ...(await this.state()), commandReason: "Undo motion" };
  }

  async motionRedo() {
    const current = await this.state();
    const head = activeHeadByKind(current.manifest, "motion");
    if (!head) throw new Error("Nothing to redo in motion history");
    await this.journal.redo(current.manifest.activeBranchId, head.id);
    return { ...(await this.state()), commandReason: "Redo motion" };
  }

  async componentCommand(input: ComponentCommandRequest) {
    const current = await this.state();
    this.assertDeckHash(current, input.expectedDeckHash);
    const deckHead = activeHeadByKind(current.manifest, "deck")!;

    if (input.command === "createFromSelection") {
      const slide = current.deck.slides.find((item) => item.id === input.slideId);
      if (!slide) throw new Error(`Unknown slide: ${input.slideId}`);
      const definition = createComponentDefinitionFromSelection({ slide, selectedIds: input.selectedIds, name: input.name, componentId: input.componentId, description: input.description });
      const existing = current.manifest.artifacts[definition.id];
      if (existing && existing.kind !== "component") throw new Error(`Artifact ${definition.id} already exists as ${existing.kind}`);
      const artifact = await this.store.write({ id: definition.id, kind: "component", payload: definition, producer: { type: "user" }, inputs: [deckHead] });
      return { ...(await this.state()), component: definition, componentVersion: artifact.version, commandReason: `Create component ${definition.name}` };
    }

    if (input.command === "insert") {
      const componentHead = current.manifest.branches[current.manifest.activeBranchId]?.heads[input.componentId];
      if (!componentHead || componentHead.kind !== "component") throw new Error(`Unknown component: ${input.componentId}`);
      const definition = (await this.store.read<ComponentDefinition>(componentHead.id, componentHead.version)).payload;
      const result = instantiateComponentIntoDeck({ deck: current.deck, slideId: input.slideId, definition, transform: input.transform, overrides: input.overrides, instanceId: input.instanceId });
      const next = await this.writeDeckVersion({ current, deck: result.deck, reason: result.reason, impact: impactForVisualEdit(result.affectedSlideIds, result.affectedElementIds) });
      return { ...next, instance: result.instance, nextSelectionIds: result.nextSelectionIds, commandReason: result.reason };
    }

    const result = detachComponentFromDeck(current.deck, input.slideId, input.instanceId);
    const next = await this.writeDeckVersion({ current, deck: result.deck, reason: result.reason, impact: impactForVisualEdit(result.affectedSlideIds, result.affectedElementIds) });
    return { ...next, nextSelectionIds: result.nextSelectionIds, commandReason: result.reason };
  }

  async setAutoLayout(input: { slideId: string; elementId: string; layout: AutoLayoutSpec; expectedDeckHash?: string }) {
    const current = await this.state();
    this.assertDeckHash(current, input.expectedDeckHash);
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
    this.assertDeckHash(current, input.expectedDeckHash);
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
    const assets = await this.assets.richAssetMapForDeck(current.deck);
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
      const assetContent = url.pathname.match(/^\/api\/assets\/([^/]+)\/content$/);
      if (req.method === "GET" && assetContent) {
        const item = await service.assetContent(decodeURIComponent(assetContent[1]));
        binary(res, 200, item.buffer, item.metadata.mimeType, item.metadata.filename);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/project") { json(res, 200, await service.state()); return; }
      if (req.method === "GET" && url.pathname === "/api/codex/tools") { json(res, 200, { tools: pitchCodexToolDefinitions }); return; }
      if (req.method === "POST" && url.pathname === "/api/assets/import") { json(res, 200, await service.importAsset(await body(req))); return; }
      const assetDelete = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
      if (req.method === "DELETE" && assetDelete) { json(res, 200, await service.removeAsset(decodeURIComponent(assetDelete[1]))); return; }
      if (req.method === "POST" && url.pathname === "/api/codex/tool") { json(res, 200, await service.codexTool(await body(req))); return; }
      if (req.method === "POST" && url.pathname === "/api/mutate") { json(res, 200, await service.mutate(await body(req))); return; }
      if (req.method === "POST" && url.pathname === "/api/editor-command") {
        const data = await body(req);
        if (data.command === "undo") { json(res, 200, await service.editorUndo()); return; }
        if (data.command === "redo") { json(res, 200, await service.editorRedo()); return; }
        json(res, 200, await service.editorCommand(data));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/media-command") { json(res, 200, await service.mediaCommand(await body(req))); return; }
      if (req.method === "POST" && url.pathname === "/api/motion-command") { json(res, 200, await service.motionCommand(await body(req))); return; }
      if (req.method === "POST" && url.pathname === "/api/motion-undo") { json(res, 200, await service.motionUndo()); return; }
      if (req.method === "POST" && url.pathname === "/api/motion-redo") { json(res, 200, await service.motionRedo()); return; }
      if (req.method === "POST" && url.pathname === "/api/component-command") { json(res, 200, await service.componentCommand(await body(req))); return; }
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
