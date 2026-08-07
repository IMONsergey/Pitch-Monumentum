import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChartElement, DeckDocument } from "../../deck-model/src/index.js";
import { dataStoryQuality } from "../../data-storytelling/src/index.js";
import { compileDeckWithNativeCharts } from "../../pptx-charts/src/index.js";
import type { RichAsset } from "../../pptx-rich/src/index.js";
import { validatePptxRoundTrip, type RoundTripIssue } from "../../pptx-roundtrip/src/index.js";
import { runDeterministicQA, type QAIssue } from "../../qa/src/index.js";

export interface ProductionExportOptions {
  assets?: Record<string, RichAsset>;
  allowDraft?: boolean;
  manifestPath?: string;
}
export interface ExportStrategyCounts {
  native: number;
  vector: number;
  rasterFallback: number;
  unsupported: number;
}
export interface ExportPreflightIssue {
  severity: "minor" | "major" | "critical";
  lane: "deterministic" | "data" | "export";
  slideId?: string;
  elementId?: string;
  code: string;
  message: string;
}
export interface ProductionExportManifest {
  schemaVersion: "0.1";
  deckId: string;
  outputPath: string;
  outputHash: string;
  slideCount: number;
  generatedAt: string;
  ready: boolean;
  allowDraft: boolean;
  editability: ExportStrategyCounts;
  preflightIssues: ExportPreflightIssue[];
  roundTripIssues: RoundTripIssue[];
  unsupportedElementIds: string[];
  warnings: string[];
}
export class ProductionExportBlockedError extends Error {
  readonly issues: ExportPreflightIssue[];
  constructor(issues: ExportPreflightIssue[]) {
    super(`Production export blocked by ${issues.filter((issue) => issue.severity === "critical").length} critical issue(s)`);
    this.name = "ProductionExportBlockedError";
    this.issues = issues;
  }
}

const NATIVE_CHART_TYPES = new Set(["bar", "column", "line", "area", "pie", "doughnut"]);
function deterministicIssues(issues: QAIssue[]): ExportPreflightIssue[] {
  return issues.map((issue) => ({
    severity: issue.severity,
    lane: "deterministic",
    slideId: issue.scope.slideId,
    elementId: issue.scope.elementIds?.[0],
    code: `qa:${issue.category}`,
    message: issue.message,
  }));
}
function chartIssues(deck: DeckDocument): ExportPreflightIssue[] {
  const issues: ExportPreflightIssue[] = [];
  for (const slide of deck.slides) {
    for (const element of slide.scene) {
      if (element.type !== "chart") continue;
      const chart = element as ChartElement;
      for (const issue of dataStoryQuality(chart.chart)) {
        issues.push({ severity: issue.severity, lane: "data", slideId: slide.id, elementId: element.id, code: `chart:${issue.code}`, message: issue.message });
      }
      if (element.exportStrategy === "native" && !NATIVE_CHART_TYPES.has(chart.chart.chartType)) {
        issues.push({ severity: "critical", lane: "export", slideId: slide.id, elementId: element.id, code: "chart:native-type-unsupported", message: `Native PowerPoint export is not implemented for ${chart.chart.chartType} charts` });
      }
    }
  }
  return issues;
}
export function productionPreflight(deck: DeckDocument): ExportPreflightIssue[] {
  return [...deterministicIssues(runDeterministicQA(deck)), ...chartIssues(deck)];
}
function strategyCounts(results: Array<{ strategy: "native" | "vector" | "rasterFallback" | "unsupported" }>): ExportStrategyCounts {
  const counts: ExportStrategyCounts = { native: 0, vector: 0, rasterFallback: 0, unsupported: 0 };
  for (const result of results) counts[result.strategy] += 1;
  return counts;
}
async function writeManifest(path: string, manifest: ProductionExportManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function exportProductionPptx(deck: DeckDocument, outputPath: string, options: ProductionExportOptions = {}): Promise<ProductionExportManifest> {
  const allowDraft = options.allowDraft ?? false;
  const preflightIssues = productionPreflight(deck);
  const blockingPreflight = preflightIssues.filter((issue) => issue.severity === "critical");
  if (blockingPreflight.length && !allowDraft) throw new ProductionExportBlockedError(preflightIssues);

  const compiled = await compileDeckWithNativeCharts(deck, outputPath, { assets: options.assets ?? {} });
  const editability = strategyCounts(compiled.elementResults);
  const unsupportedElementIds = compiled.elementResults.filter((item) => item.strategy === "unsupported").map((item) => item.elementId);
  const roundTrip = await validatePptxRoundTrip(deck, outputPath);
  const blockingRoundTrip = roundTrip.issues.some((issue) => issue.severity === "critical");
  const ready = blockingPreflight.length === 0 && !blockingRoundTrip && unsupportedElementIds.length === 0;
  const warnings = compiled.elementResults.flatMap((item) => item.warnings.map((warning) => `${item.elementId}: ${warning}`));
  const manifest: ProductionExportManifest = {
    schemaVersion: "0.1",
    deckId: deck.id,
    outputPath,
    outputHash: compiled.contentHash,
    slideCount: compiled.slideCount,
    generatedAt: new Date().toISOString(),
    ready,
    allowDraft,
    editability,
    preflightIssues,
    roundTripIssues: roundTrip.issues,
    unsupportedElementIds,
    warnings,
  };
  await writeManifest(options.manifestPath ?? `${outputPath}.manifest.json`, manifest);
  if (!allowDraft && !ready) {
    const issues: ExportPreflightIssue[] = [
      ...preflightIssues,
      ...roundTrip.issues.filter((issue) => issue.severity === "critical").map((issue) => ({ severity: issue.severity, lane: "export" as const, slideId: issue.slideId, elementId: issue.elementId, code: `roundtrip:${issue.kind}`, message: issue.message })),
      ...unsupportedElementIds.map((elementId) => ({ severity: "critical" as const, lane: "export" as const, elementId, code: "export:unsupported", message: `Element ${elementId} did not receive a supported export representation` })),
    ];
    throw new ProductionExportBlockedError(issues);
  }
  return manifest;
}
