import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { exportProductionPptx, ProductionExportBlockedError } from "../packages/export-pipeline/src/index.js";
import { inspectPptx } from "../packages/pptx-roundtrip/src/index.js";

const out = "/tmp/pitchos-production.pptx";
const png = "/tmp/pitchos-production-dot.png";
const onePx = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=";
function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "production", title: "Production", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: ["src"], claimIds: ["claim"], activeBranchId: "branch_main", createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Business evidence", archetype: "chartInsight", semantic: { purpose: "prove trend", takeaway: "CAC declined each quarter", questionAnswered: "is efficiency improving?", narrativeRole: "evidence", claimIds: ["claim"], evidenceRefs: ["e1"], audienceRelevance: "board", density: "balanced" }, status: "ready", qaIssueIds: [], dependencyIds: ["claim"], scene: [
      { id: "title", type: "text", semanticRole: "title", geometry: { x: 140, y: 80, width: 1300, height: 120 }, zIndex: 1, origin: "deterministic", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "CAC declined each quarter", fontSizePt: 36, bold: true, underline: true, letterSpacingPt: 0.2, color: "#111111" }] }] },
      { id: "frame", type: "frame", semanticRole: "visual", geometry: { x: 120, y: 280, width: 1040, height: 460 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], childIds: ["img", "table"], layout: { direction: "horizontal", gapDU: 40, padding: { top: 20, right: 20, bottom: 20, left: 20 }, justify: "start", align: "stretch", widthSizing: "fixed", heightSizing: "fixed" } },
      { id: "img", type: "image", semanticRole: "visual", geometry: { x: 140, y: 300, width: 420, height: 420 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], assetId: "asset", fit: "cover" },
      { id: "table", type: "table", semanticRole: "table", geometry: { x: 620, y: 300, width: 520, height: 420 }, zIndex: 3, origin: "deterministic", exportStrategy: "native", dependencies: [{ kind: "evidence", id: "e1" }], rows: [[{ text: "Metric" }, { text: "Value" }], [{ text: "CAC" }, { text: "76" }]], columnWidths: [0.6, 0.4] },
      { id: "chart", type: "chart", semanticRole: "chart", geometry: { x: 1180, y: 280, width: 600, height: 480 }, zIndex: 4, origin: "deterministic", exportStrategy: "native", dependencies: [{ kind: "dataset", id: "dataset" }], chart: { chartType: "line", categories: ["Q1", "Q2", "Q3"], series: [{ name: "CAC", values: [100, 88, 76] }], showLegend: false, insightStatement: "CAC declined each quarter", dataSourceRefs: ["dataset", "src"] } }
    ] }]
  };
}

test("production export gates, compiles rich native objects, flattens structural frames, round-trips and writes a manifest", async () => {
  await rm(out, { force: true }); await rm(`${out}.manifest.json`, { force: true }); await writeFile(png, Buffer.from(onePx, "base64"));
  const manifest = await exportProductionPptx(fixture(), out, { assets: { asset: { path: png, mimeType: "image/png" } } });
  assert.equal(manifest.ready, true);
  assert.equal(manifest.editability.unsupported, 0);
  assert.ok(manifest.editability.native >= 5);
  assert.equal(manifest.roundTripIssues.some((issue) => issue.severity === "critical"), false);
  assert(manifest.warnings.some((warning) => warning.includes("Structural auto-layout frame flattened")));
  const inspected = await inspectPptx(out);
  assert.equal(inspected.slides[0].pictureCount, 1);
  assert.ok(inspected.entryNames.includes("ppt/charts/chart1.xml"));
  assert.ok(inspected.entryNames.includes("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx"));
  const diskManifest = JSON.parse(await readFile(`${out}.manifest.json`, "utf8"));
  assert.equal(diskManifest.outputHash, manifest.outputHash);
});

test("production export blocks unsupported native scatter instead of silently dropping the chart", async () => {
  const deck = fixture();
  const chart = deck.slides[0].scene.find((element) => element.id === "chart") as any;
  chart.chart.chartType = "scatter";
  await assert.rejects(() => exportProductionPptx(deck, "/tmp/pitchos-blocked.pptx", { assets: { asset: { path: png, mimeType: "image/png" } } }), ProductionExportBlockedError);
});
