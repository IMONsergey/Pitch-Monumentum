import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  deckHash: string;
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

function referencedAssetIds(deck: DeckDocument): string[] {
  const ids = new Set<string>();
  for (const slide of deck.slides) for (const element of slide.scene) {
    if (element.type === "image" || element.type === "icon" || element.type === "video") ids.add(element.assetId);
    if (element.type === "video" && element.posterAssetId) ids.add(element.posterAssetId);
  }
  return [...ids].sort();
}

function criticalDeterministic(state: Awaited<ReturnType<PitchWorkspaceService["state"]>>): number {
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
    const state = await this.service.state();
    const review = await this.review.state();
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
      deckHash: state.deckHash,
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

  async exportPptx(policy: ReviewDeliveryPolicy = {}): Promise<{ artifact: DeliveryArtifact; preflight: DeliveryPreflight }> {
    const preflight = await this.preflight(policy); this.assertReady(preflight, "pptx");
    const result = await this.service.exportPptx();
    return { artifact: await fileArtifact("pptx", result.path, result.manifest?.warnings ?? preflight.formats.pptx.warnings), preflight };
  }

  async exportFigma(policy: ReviewDeliveryPolicy = {}): Promise<{ artifact: DeliveryArtifact; preflight: DeliveryPreflight }> {
    const preflight = await this.preflight(policy); this.assertReady(preflight, "figma");
    const state = await this.service.state();
    const assets = await this.bridgeAssets(state.deck);
    const bridge = createFigmaBridgeDocument(state.deck, assets.figma);
    await mkdir(this.exportDir(), { recursive: true });
    const path = join(this.exportDir(), `${state.deck.id}-figma-bridge.json`);
    await writeFile(path, `${JSON.stringify(bridge, null, 2)}\n`, "utf8");
    return { artifact: await fileArtifact("figma", path, bridge.warnings), preflight };
  }

  async exportWeb(policy: ReviewDeliveryPolicy = {}): Promise<{ artifact: DeliveryArtifact; preflight: DeliveryPreflight }> {
    const preflight = await this.preflight(policy); this.assertReady(preflight, "web");
    const state = await this.service.state();
    const assets = await this.bridgeAssets(state.deck);
    const rendered = exportStandaloneWeb(state.deck, assets.web, state.motion);
    await mkdir(this.exportDir(), { recursive: true });
    const path = join(this.exportDir(), `${state.deck.id}-standalone.html`);
    await writeFile(path, rendered.html, "utf8");
    return { artifact: await fileArtifact("web", path, rendered.warnings), preflight };
  }

  async exportKeynote(policy: ReviewDeliveryPolicy = {}): Promise<{ artifact: DeliveryArtifact; pptxArtifact: DeliveryArtifact; preflight: DeliveryPreflight }> {
    const preflight = await this.preflight(policy); this.assertReady(preflight, "keynote");
    const pptx = await this.service.exportPptx();
    const pptxArtifact = await fileArtifact("pptx", pptx.path, pptx.manifest?.warnings ?? []);
    const state = await this.service.state();
    const keyPath = join(this.exportDir(), `${state.deck.id}.key`);
    const converted = await convertPptxToKeynote(pptx.path, keyPath, { platform: this.platform, runner: this.keynoteRunner });
    return { artifact: await fileArtifact("keynote", keyPath, preflight.formats.keynote.warnings, converted.adapterStatus), pptxArtifact, preflight };
  }

  async exportBundle(formats: DeliveryFormat[], policy: ReviewDeliveryPolicy = {}): Promise<DeliveryManifest> {
    const requested = [...new Set(formats)];
    const artifacts: DeliveryArtifact[] = [];
    let preflight = await this.preflight(policy);
    for (const formatName of requested) {
      if (formatName === "pptx") { const result = await this.exportPptx(policy); artifacts.push(result.artifact); preflight = result.preflight; }
      else if (formatName === "figma") { const result = await this.exportFigma(policy); artifacts.push(result.artifact); preflight = result.preflight; }
      else if (formatName === "web") { const result = await this.exportWeb(policy); artifacts.push(result.artifact); preflight = result.preflight; }
      else { const result = await this.exportKeynote(policy); artifacts.push(result.artifact); if (!artifacts.some((artifact) => artifact.path === result.pptxArtifact.path)) artifacts.push(result.pptxArtifact); preflight = result.preflight; }
    }
    const manifest: DeliveryManifest = { schemaVersion: "0.1", deckId: preflight.deckId, deckHash: preflight.deckHash, generatedAt: new Date().toISOString(), preflight, artifacts };
    await mkdir(this.exportDir(), { recursive: true });
    await writeFile(join(this.exportDir(), `${preflight.deckId}-delivery-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifest;
  }
}
