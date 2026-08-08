import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PitchWorkspaceService } from "../../workspace/src/server.js";
import { DeliveryRuntime } from "../../delivery/src/runtime.js";
import { ReviewWorkspaceRuntime } from "../../review/src/runtime.js";
import { VersionWorkspaceRuntime } from "../../versions/src/runtime.js";
import { CreativeDirectorRuntime } from "../../creative-director/src/runtime.js";

export type HealthStatus = "ok" | "warning" | "blocker";

export interface SystemHealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface SystemHealthSnapshot {
  schemaVersion: "0.1";
  checkedAt: string;
  productVersion: string;
  projectId: string;
  activeBranchId: string;
  environment: {
    platform: NodeJS.Platform;
    arch: string;
    node: string;
    electron?: string;
    chrome?: string;
  };
  checks: SystemHealthCheck[];
  summary: {
    ok: number;
    warning: number;
    blocker: number;
    editingReady: boolean;
    deliveryReady: boolean;
    readyFormats: string[];
  };
}

export interface SystemHealthDependencies {
  service?: PitchWorkspaceService;
  delivery?: DeliveryRuntime;
  review?: ReviewWorkspaceRuntime;
  versions?: VersionWorkspaceRuntime;
  director?: CreativeDirectorRuntime;
}

const PUBLIC_LAYERS = [
  "editor-spike.js",
  "design-system-ui.js",
  "slide-masters-ui.js",
  "creative-director-ui.js",
  "creative-preview-ui.js",
  "creative-runs-ui.js",
  "versions-ui.js",
  "review-ui.js",
  "review-governance-ui.js",
  "delivery-ui.js",
  "system-health-ui.js",
];

const COMPILED_ENTRIES = [
  "dist/apps/desktop-full/src/main.js",
  "dist/apps/desktop-runtime/src/main.js",
  "dist/apps/desktop-runtime/src/preload.js",
  "dist/apps/workspace/src/full-server.js",
  "dist/apps/workspace/src/delivery-server.js",
  "dist/apps/review/src/runtime.js",
  "dist/apps/versions/src/runtime.js",
  "dist/apps/creative-director/src/runtime.js",
  "dist/apps/pitch-mcp-full/src/server.js",
];

function productVersion(): string {
  try { return JSON.parse(readFileSync(resolve("package.json"), "utf8")).version || "unknown"; }
  catch { return "unknown"; }
}
function check(id: string, label: string, status: HealthStatus, message: string, details?: Record<string, unknown>): SystemHealthCheck {
  return { id, label, status, message, details };
}
function count(checks: SystemHealthCheck[], status: HealthStatus): number { return checks.filter((item) => item.status === status).length; }

export class SystemHealthRuntime {
  readonly service: PitchWorkspaceService;
  readonly delivery: DeliveryRuntime;
  readonly review: ReviewWorkspaceRuntime;
  readonly versions: VersionWorkspaceRuntime;
  readonly director: CreativeDirectorRuntime;

  constructor(projectRoot: string, dependencies: SystemHealthDependencies = {}) {
    this.service = dependencies.service ?? new PitchWorkspaceService(projectRoot);
    this.delivery = dependencies.delivery ?? new DeliveryRuntime(projectRoot);
    this.review = dependencies.review ?? new ReviewWorkspaceRuntime(projectRoot);
    this.versions = dependencies.versions ?? new VersionWorkspaceRuntime(projectRoot);
    this.director = dependencies.director ?? new CreativeDirectorRuntime(projectRoot);
  }

  async snapshot(): Promise<SystemHealthSnapshot> {
    const checks: SystemHealthCheck[] = [];
    const state = await this.service.state();
    const manifest = state.manifest;

    checks.push(check(
      "project",
      "Canonical project",
      state.deck.id && manifest.branches[manifest.activeBranchId] ? "ok" : "blocker",
      `Project ${manifest.projectId} · deck ${state.deck.id} · branch ${manifest.activeBranchId}`,
      { projectId: manifest.projectId, deckId: state.deck.id, branchCount: Object.keys(manifest.branches).length, deckHash: state.deckHash },
    ));

    const criticalQA = state.qa.filter((issue) => issue.severity === "critical");
    const majorQA = state.qa.filter((issue) => issue.severity === "major");
    checks.push(check(
      "deterministic-qa",
      "Deterministic QA",
      criticalQA.length ? "blocker" : majorQA.length ? "warning" : "ok",
      criticalQA.length ? `${criticalQA.length} critical QA issue(s)` : majorQA.length ? `${majorQA.length} major QA issue(s)` : "No critical/major deterministic QA issues",
      { critical: criticalQA.length, major: majorQA.length, total: state.qa.length },
    ));

    let deliveryState: Awaited<ReturnType<DeliveryRuntime["preflight"]>> | undefined;
    try {
      deliveryState = await this.delivery.preflight();
      checks.push(check(
        "assets",
        "Asset integrity",
        deliveryState.missingAssetIds.length ? "blocker" : "ok",
        deliveryState.missingAssetIds.length ? `${deliveryState.missingAssetIds.length} referenced asset(s) are missing bytes` : `${deliveryState.assetReferences} referenced asset(s), all bytes available`,
        { references: deliveryState.assetReferences, missingAssetIds: deliveryState.missingAssetIds },
      ));
    } catch (error) {
      checks.push(check("assets", "Asset integrity", "blocker", error instanceof Error ? error.message : String(error)));
    }

    let reviewState: Awaited<ReturnType<ReviewWorkspaceRuntime["state"]>> | undefined;
    try {
      reviewState = await this.review.state();
      const summary = reviewState.summary;
      const status: HealthStatus = summary.blockingThreads || summary.deckApprovalStale || summary.slideApprovalsStale ? "warning" : "ok";
      checks.push(check(
        "review",
        "Comments & approvals",
        status,
        summary.blockingThreads ? `${summary.blockingThreads} blocking review thread(s)` : summary.deckApprovalStale || summary.slideApprovalsStale ? "One or more approvals are stale" : `${summary.openThreads} open review thread(s), no stale approval gate`,
        { ...summary, reviewHash: reviewState.reviewHash },
      ));
    } catch (error) {
      checks.push(check("review", "Comments & approvals", "blocker", error instanceof Error ? error.message : String(error)));
    }

    try {
      const creative = await this.director.review();
      const masterQA = creative.input.masterQA;
      checks.push(check(
        "masters",
        "Slide Masters",
        masterQA && !masterQA.ready ? "blocker" : masterQA?.issues.some((issue) => issue.severity === "major") ? "warning" : "ok",
        masterQA ? `${masterQA.masterCount} master(s) · ${masterQA.linkedSlideCount} linked slide(s) · ${masterQA.issues.length} issue(s)` : "Master QA unavailable",
        masterQA ? { ready: masterQA.ready, masterCount: masterQA.masterCount, linkedSlideCount: masterQA.linkedSlideCount, issueCount: masterQA.issues.length } : undefined,
      ));
      checks.push(check(
        "motion",
        "Motion integrity",
        creative.input.motion?.staleReferences ? "blocker" : "ok",
        creative.input.motion ? `${creative.input.motion.slidesWithMotion} slide(s) with motion · ${creative.input.motion.staleReferences} stale reference(s)` : "Motion review unavailable",
        creative.input.motion ? { ...creative.input.motion } : undefined,
      ));
      checks.push(check(
        "creative-director",
        "Creative Director",
        creative.review.blockerCount ? "blocker" : creative.review.score < 85 ? "warning" : "ok",
        `Production score ${creative.review.score}/100 · ${creative.review.blockerCount} blocker(s) · ${creative.review.warningCount} warning(s)`,
        { score: creative.review.score, ready: creative.review.ready, priorities: creative.review.priorities },
      ));
    } catch (error) {
      checks.push(check("creative-director", "Creative Director", "blocker", error instanceof Error ? error.message : String(error)));
    }

    try {
      const versions = await this.versions.state();
      checks.push(check(
        "versions",
        "Versions & checkpoints",
        "ok",
        `${versions.branches.length} branch(es) · ${versions.checkpoints.length} checkpoint(s)`,
        { branchCount: versions.branches.length, checkpointCount: versions.checkpoints.length, activeBranchId: versions.activeBranchId },
      ));
    } catch (error) {
      checks.push(check("versions", "Versions & checkpoints", "warning", error instanceof Error ? error.message : String(error)));
    }

    if (deliveryState) {
      const readyFormats = deliveryState.readyFormats;
      checks.push(check(
        "delivery",
        "Delivery Center",
        readyFormats.length ? (deliveryState.reviewGate.ready ? "ok" : "warning") : "blocker",
        `${readyFormats.length}/4 server delivery format(s) ready: ${readyFormats.join(", ") || "none"}`,
        { readyFormats, formats: deliveryState.formats, activeBranchId: deliveryState.activeBranchId, deckHash: deliveryState.deckHash },
      ));
      checks.push(check(
        "keynote",
        "Keynote adapter",
        deliveryState.keynote.keynoteInstalled ? "warning" : "warning",
        deliveryState.keynote.keynoteInstalled ? `Keynote found (${deliveryState.keynote.bundleId ?? "bundle id unknown"}); adapter still requires real-app fidelity validation` : deliveryState.keynote.reason ?? "Keynote unavailable",
        { ...deliveryState.keynote, adapterStatus: "adapter-unverified" },
      ));
    }

    const missingLayers = PUBLIC_LAYERS.filter((name) => !existsSync(resolve("apps", "workspace", "public", name)));
    checks.push(check(
      "ui-layers",
      "Full editor UI layers",
      missingLayers.length ? "blocker" : "ok",
      missingLayers.length ? `Missing UI layer(s): ${missingLayers.join(", ")}` : `${PUBLIC_LAYERS.length} Full editor UI layer(s) present`,
      { missing: missingLayers, expected: PUBLIC_LAYERS },
    ));

    const missingCompiled = COMPILED_ENTRIES.filter((path) => !existsSync(resolve(path)));
    checks.push(check(
      "compiled-entries",
      "Compiled Full entrypoints",
      missingCompiled.length ? "warning" : "ok",
      missingCompiled.length ? `${missingCompiled.length} compiled entrypoint(s) are not present in this runtime tree` : "All guarded Full build entrypoints are present",
      { missing: missingCompiled },
    ));

    const environment = {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    };
    const desktopRuntime = Boolean(process.versions.electron);
    checks.push(check(
      "environment",
      "Runtime environment",
      "ok",
      `${environment.platform} ${environment.arch} · Node ${environment.node}${desktopRuntime ? ` · Electron ${environment.electron}` : ""}`,
      environment,
    ));
    if (environment.platform === "darwin") checks.push(check(
      "mac-architecture",
      "macOS architecture",
      environment.arch === "x64" ? "ok" : "warning",
      environment.arch === "x64" ? "Running natively as x64/Intel" : `Running as ${environment.arch}; Intel release validation requires a real x64 build/runtime`,
      { arch: environment.arch, intelTarget: "x64" },
    ));

    const readyFormats = deliveryState?.readyFormats ?? [];
    return {
      schemaVersion: "0.1",
      checkedAt: new Date().toISOString(),
      productVersion: productVersion(),
      projectId: manifest.projectId,
      activeBranchId: manifest.activeBranchId,
      environment,
      checks,
      summary: {
        ok: count(checks, "ok"),
        warning: count(checks, "warning"),
        blocker: count(checks, "blocker"),
        editingReady: !checks.some((item) => item.status === "blocker" && ["project", "deterministic-qa", "assets", "masters", "motion", "ui-layers"].includes(item.id)),
        deliveryReady: readyFormats.length > 0 && Boolean(deliveryState?.reviewGate.ready),
        readyFormats,
      },
    };
  }
}
