import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PitchWorkspaceService } from "../../workspace/src/server.js";
import { ReviewWorkspaceRuntime } from "../../review/src/runtime.js";
import { reviewDeliveryGate, type ReviewDeliveryGate, type ReviewDeliveryPolicy } from "../../../packages/review-engine/src/delivery.js";
import { productionPreflight } from "../../../packages/export-pipeline/src/index.js";
import { createFigmaBridgeDocument, type FigmaBridgeAsset } from "../../../packages/figma-bridge/src/index.js";
import { exportStandaloneWeb, type WebExportAsset } from "../../../packages/web-export/src/index.js";
import { convertPptxToKeynote, keynoteAvailability, type KeynoteAvailability, type KeynoteCommandRunner } from "../../../packages/keynote-export/src/index.js";
import { inspectFilesystemArtifact } from "../../../packages/fs-artifact/src/index.js";
import type { DeckDocument } from "../../../packages/deck-model/src/index.js";

export type DeliveryFormat = "pptx" | "figma" | "web" | "keynote";

export interface DeliveryFormatState {
  format: DeliveryFormat;
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

export interface DeliveryPreflight {
  schemaVersion: "0.1";
  deckId: string;
  activeBranchId: string;
  deckHash: string;
  reviewHash?: string;
  motionHash?: string;
  generatedAt: string;
  reviewGate: ReviewDeliveryGate;
  deterministicCritical: number;
  assetReferences: number;
  missingAssetIds: string[];
  keynote: KeynoteAvailability;
  formats: Record<DeliveryFormat, DeliveryFormatState>;
  readyFormats: DeliveryFormat[];
}

export interface DeliveryArtifact {
  format: DeliveryFormat;
  path: string;
  filename: string;
  bytes: number;
  sha256: string;
  filesystemKind: "file" | "directory";
  fileCount: number;
  warnings: string[];
  adapterStatus?: string;
}

export interface DeliveryManifest {
  schemaVersion: "0.1";
  deckId: string;
  deckHash: string;
  generatedAt: string;
  preflight: DeliveryPreflight;
  artifacts: DeliveryArtifact[];
}

type WorkspaceState = Awaited<ReturnType<PitchWorkspaceService["state"]>>;
type ReviewState = Awaited<ReturnType<ReviewWorkspaceRuntime["state"]>>;

function referencedAssetIds(deck: DeckDocument): string[] {
  const ids = new Set<string>();
  for (const slide of deck.slides) for (const element of slide.scene) {
    if (element.type === "image" || element.type === "icon" || element.type === "video") ids.add(element.assetId);
    if (element.type === "video" && element.posterAssetId) ids.add(element.posterAssetId);
  }
  return [...ids].sort();
}

function criticalDeterministic(state: WorkspaceState): number {
  return state.qa.filter((issue) => issue.severity === "critical").length;
}

function format(format: DeliveryFormat, ready: boolean, blockers: string[], warnings: string[]): DeliveryFormatState {
  return { format, ready, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

async function fileArtifact(formatName: DeliveryFormat, path: string, warnings: string[] = [], adapterStatus?: string): Promise<DeliveryArtifact> {
  const inspected = await inspectFilesystemArtifact(path);
  return {
    format: formatName,
    path: inspected.path,
    filename: inspected.path.split(/[\\/]/).pop() || inspected.path,
    bytes: inspected.bytes,
    sha256: inspected.sha256,
    filesystemKind: inspected.kind,
    fileCount: inspected.fileCount,
    warnings: [...new Set(warnings)],
    adapterStatus,
  };
}

function sameOptionalHash(a?: string, b?: string): boolean { return (a ?? "") === (b ?? ""); }

export class DeliveryRuntime {
  readonly root: string;
  readonly service: PitchWorkspaceService;
  readonly review: ReviewWorkspaceRuntime;
  private readonly keynoteRunner?: KeynoteCommandRunner;
  private readonly platform?: NodeJS.Platform;

  constructor(projectRoot: string, options: { keynoteRunner?: KeynoteCommandRunner; platform?: NodeJS.Platform } = {}) {
    this.root = projectRoot;
    this.service = new PitchWorkspaceService(projectRoot);
    this.review = new ReviewWorkspaceRuntime(projectRoot);
    this.keynoteRunner = options.keynoteRunner;
    this.platform = options.platform;
  }

  private exportDir(): string { return join(this.root, ".project", "exports"); }

  private async consistentState(): Promise<{ state: WorkspaceState; review: ReviewState }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.service.state();
      const review = await this.review.state();
      const after = await this.service.state();
      if (
        before.manifest.activeBranchId === after.manifest.activeBranchId &&
        before.deckHash === after.deckHash &&
        sameOptionalHash(before.motionHash, after.motionHash) &&
        review.activeBranchId === after.manifest.activeBranchId &&
        review.deckHash === after.deckHash
      ) return { state: after, review };
    }
    throw new Error("Pitch project changed while Delivery preflight was being prepared; retry against the current project state.");
  }

  private async assertSnapshot(preflight: DeliveryPreflight): Promise<WorkspaceState> {
    const { state, review } = await this.consistentState();
    const problems: string[] = [];
    if (state.manifest.activeBranchId !== preflight.activeBranchId) problems.push(`branch ${preflight.activeBranchId} → ${state.manifest.activeBranchId}`);
    if (state.deckHash !== preflight.deckHash) problems.push(`deck ${preflight.deckHash.slice(0, 10)} → ${state.deckHash.slice(0, 10)}`);
    if (!sameOptionalHash(state.motionHash, preflight.motionHash)) problems.push("motion document changed");
    if (!sameOptionalHash(review.reviewHash, preflight.reviewHash)) problems.push("review document changed");
    if (problems.length) throw new Error(`Delivery snapshot is stale: ${problems.join("; ")}. Re-run preflight/export.`);
    return state;
  }

  private async removeArtifact(path: string | undefined): Promise<void> {
    if (!path) return;
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }

  private async assetIntegrity(deck: DeckDocument) {
    const ids = referencedAssetIds(deck);
    const missing: string[] = [];
    for (const id of ids) {
      try { await this.service.assets.content(id); } catch { missing.push(id); }
    }
    return { ids, missing };
  }

  private async bridgeAssets(deck: DeckDocument): Promise<{ figma: Record<string, FigmaBridgeAsset>; web: Record<string, WebExportAsset> }> {
    const figma: Record<string, FigmaBridgeAsset> = {};
    const web: Record<string, WebExportAsset> = {};
    for (const id of referencedAssetIds(deck)) {
      const { metadata, path } = await this.service.assets.content(id);
      if (metadata.kind !== "image") continue;
      const bytes = await readFile(path);
      const base64 = bytes.toString("base64");
      figma[id] = { assetId: id, mimeType: metadata.mimeType, base64, width: metadata.width, height: metadata.height };
      web[id] = { assetId: id, mimeType: metadata.mimeType, base64 };
    }
    return { figma, web };
  }

  async preflight(policy: ReviewDeliveryPolicy = {}): Promise<DeliveryPreflight> {
    const { state, review } = await this.consistentState();
    const reviewGate = reviewDeliveryGate(state.deck, review.document, policy);
    const integrity = await this.assetIntegrity(state.deck);
    const deterministicCritical = criticalDeterministic(state);
    const pptxPreflight = productionPreflight(state.deck);
    const pptxCritical = pptxPreflight.filter((issue) => issue.severity === "critical");
    const pptxWarnings = pptxPreflight.filter((issue) => issue.severity === "minor" || issue.severity === "major").map((issue) => `${issue.code}: ${issue.message}`);
    const keynote = await keynoteAvailability({ platform: this.platform, runner: this.keynoteRunner });
    const coreBlockers = [
      ...reviewGate.issues.filter((issue) => issue.severity === "blocker").map((issue) => `${issue.code}: ${issue.message}`),
      ...(deterministicCritical ? [`${deterministicCritical} critical deterministic QA issue(s)`] : []),
      ...integrity.missing.map((id) => `Missing asset bytes: ${id}`),
    ];
    const formats: Record<DeliveryFormat, DeliveryFormatState> = {
      pptx: format("pptx", coreBlockers.length === 0 && pptxCritical.length === 0, [...coreBlockers, ...pptxCritical.map((issue) => `${issue.code}: ${issue.message}`)], pptxWarnings),
      figma: format("figma", coreBlockers.length === 0, coreBlockers, ["Structured chart/table/diagram nodes may use editable fallback containers in the current Figma bridge importer."]),
      web: format("web", coreBlockers.length === 0, coreBlockers, state.motion.slides.some((slide) => slide.tracks.length > 0) ? ["Standalone Web currently preserves builds but not exact keyframe-track playback."] : []),
      keynote: format("keynote", coreBlockers.length === 0 && pptxCritical.length === 0 && keynote.supportedPlatform && keynote.keynoteInstalled, [...coreBlockers, ...pptxCritical.map((issue) => `${issue.code}: ${issue.message}`), ...(!keynote.supportedPlatform || !keynote.keynoteInstalled ? [keynote.reason ?? "Apple Keynote is unavailable"] : [])], ["Keynote conversion adapter remains unverified until exercised with a real installed Keynote build.", ...pptxWarnings]),
    };
    return {
      schemaVersion: "0.1",
      deckId: state.deck.id,
      activeBranchId: state.manifest.activeBranchId,
      deckHash: state.deckHash,
      reviewHash: review.reviewHash,
      motionHash: state.motionHash,
      generatedAt: new Date().toISOString(),
      reviewGate,
      deterministicCritical,
      assetReferences: integrity.ids.length,
      missingAssetIds: integrity.missing,
      keynote,
      formats,
      readyFormats: (Object.keys(formats) as DeliveryFormat[]).filter((key) => formats[key].ready),
    };
  }

  private assertReady(preflight: DeliveryPreflight, formatName: DeliveryFormat): void {
    const state = preflight.formats[formatName];
    if (!state.ready) throw new Error(`${formatName.toUpperCase()} delivery is blocked: ${state.blockers.join("; ")}`);
  }

  private async generatePptx(preflight: DeliveryPreflight): Promise<DeliveryArtifact> {
    await this.assertSnapshot(preflight);
    let path: string | undefined;
    try {
      const result = await this.service.exportPptx();
      path = result.path;
      await this.assertSnapshot(preflight);
      return await fileArtifact("pptx", path, result.manifest?.warnings ?? preflight.formats.pptx.warnings);
    } catch (error) {
      if (path) await this.removeArtifact(path);
      throw error;
    }
  }

  private async generateFigma(preflight: DeliveryPreflight): Promise<DeliveryArtifact> {
    const state = await this.assertSnapshot(preflight);
    const assets = await this.bridgeAssets(state.deck);
    await this.assertSnapshot(preflight);
    const bridge = createFigmaBridgeDocument(state.deck, assets.figma);
    await mkdir(this.exportDir(), { recursive: true });
    const path = join(this.exportDir(), `${state.deck.id}-figma-bridge.json`);
    try {
      await writeFile(path, `${JSON.stringify(bridge, null, 2)}\n`, "utf8");
      await this.assertSnapshot(preflight);
      return await fileArtifact("figma", path, bridge.warnings);
    } catch (error) {
      await this.removeArtifact(path);
      throw error;
    }
  }

  private async generateWeb(preflight: DeliveryPreflight): Promise<DeliveryArtifact> {
    const state = await this.assertSnapshot(preflight);
    const assets = await this.bridgeAssets(state.deck);
    await this.assertSnapshot(preflight);
    const rendered = exportStandaloneWeb(state.deck, assets.web, state.motion);
    await mkdir(this.exportDir(), { recursive: true });
    const path = join(this.exportDir(), `${state.deck.id}-standalone.html`);
    try {
      await writeFile(path, rendered.html, "utf8");
      await this.assertSnapshot(preflight);
      return await fileArtifact("web", path, rendered.warnings);
    } catch (error) {
      await this.removeArtifact(path);
      throw error;
    }
  }

  private async generateKeynote(preflight: DeliveryPreflight): Promise<{ artifact: DeliveryArtifact; pptxArtifact: DeliveryArtifact }> {
    await this.assertSnapshot(preflight);
    let pptxPath: string | undefined;
    let keyPath: string | undefined;
    try {
      const pptx = await this.service.exportPptx();
      pptxPath = pptx.path;
      await this.assertSnapshot(preflight);
      const pptxArtifact = await fileArtifact("pptx", pptx.path, pptx.manifest?.warnings ?? []);
      const state = await this.assertSnapshot(preflight);
      keyPath = join(this.exportDir(), `${state.deck.id}.key`);
      const converted = await convertPptxToKeynote(pptx.path, keyPath, { platform: this.platform, runner: this.keynoteRunner });
      await this.assertSnapshot(preflight);
      return { artifact: await fileArtifact("keynote", keyPath, preflight.formats.keynote.warnings, converted.adapterStatus), pptxArtifact };
    } catch (error) {
      await this.removeArtifact(keyPath);
      await this.removeArtifact(pptxPath);
      throw error;
    }
  }

  async exportPptx(policy: ReviewDeliveryPolicy = {}): Promise<{ artifact: DeliveryArtifact; preflight: DeliveryPreflight }> {
    const preflight = await this.preflight(policy);
    this.assertReady(preflight, "pptx");
    return { artifact: await this.generatePptx(preflight), preflight };
  }

  async exportFigma(policy: ReviewDeliveryPolicy = {}): Promise<{ artifact: DeliveryArtifact; preflight: DeliveryPreflight }> {
    const preflight = await this.preflight(policy);
    this.assertReady(preflight, "figma");
    return { artifact: await this.generateFigma(preflight), preflight };
  }

  async exportWeb(policy: ReviewDeliveryPolicy = {}): Promise<{ artifact: DeliveryArtifact; preflight: DeliveryPreflight }> {
    const preflight = await this.preflight(policy);
    this.assertReady(preflight, "web");
    return { artifact: await this.generateWeb(preflight), preflight };
  }

  async exportKeynote(policy: ReviewDeliveryPolicy = {}): Promise<{ artifact: DeliveryArtifact; pptxArtifact: DeliveryArtifact; preflight: DeliveryPreflight }> {
    const preflight = await this.preflight(policy);
    this.assertReady(preflight, "keynote");
    const generated = await this.generateKeynote(preflight);
    return { ...generated, preflight };
  }

  async exportBundle(formats: DeliveryFormat[], policy: ReviewDeliveryPolicy = {}): Promise<DeliveryManifest> {
    const requested = [...new Set(formats)];
    if (!requested.length) throw new Error("At least one delivery format is required");
    const preflight = await this.preflight(policy);
    for (const formatName of requested) this.assertReady(preflight, formatName);

    const artifacts: DeliveryArtifact[] = [];
    try {
      for (const formatName of requested) {
        if (formatName === "pptx") artifacts.push(await this.generatePptx(preflight));
        else if (formatName === "figma") artifacts.push(await this.generateFigma(preflight));
        else if (formatName === "web") artifacts.push(await this.generateWeb(preflight));
        else {
          const result = await this.generateKeynote(preflight);
          artifacts.push(result.artifact);
          if (!artifacts.some((artifact) => artifact.path === result.pptxArtifact.path)) artifacts.push(result.pptxArtifact);
        }
      }
      await this.assertSnapshot(preflight);
      const manifest: DeliveryManifest = { schemaVersion: "0.1", deckId: preflight.deckId, deckHash: preflight.deckHash, generatedAt: new Date().toISOString(), preflight, artifacts };
      await mkdir(this.exportDir(), { recursive: true });
      const manifestPath = join(this.exportDir(), `${preflight.deckId}-delivery-manifest.json`);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await this.assertSnapshot(preflight);
      return manifest;
    } catch (error) {
      await Promise.all(artifacts.map((artifact) => this.removeArtifact(artifact.path)));
      throw error;
    }
  }
}
