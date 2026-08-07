import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { compileDeckWithNativeCharts } from "../packages/pptx-charts/src/index.js";
import { inspectPptx } from "../packages/pptx-roundtrip/src/index.js";

const out = "/tmp/pitchos-chart.pptx";
const deck: DeckDocument = {
  schemaVersion: "0.1", id: "chart", title: "Chart", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
  briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T00:00:00Z",
  slides: [{ id: "s1", order: 0, title: "CAC trend", archetype: "chartInsight", semantic: { purpose: "prove trend", takeaway: "CAC declined each quarter", questionAnswered: "is efficiency improving?", narrativeRole: "evidence", claimIds: [], evidenceRefs: ["e1", "e2", "e3"], audienceRelevance: "board", density: "balanced" }, status: "ready", qaIssueIds: [], dependencyIds: [], scene: [
    { id: "chart1", type: "chart", semanticRole: "chart", geometry: { x: 150, y: 250, width: 1500, height: 650 }, zIndex: 1, origin: "deterministic", exportStrategy: "native", dependencies: [{ kind: "dataset", id: "dataset_cac" }], chart: { chartType: "line", categories: ["Q1", "Q2", "Q3"], series: [{ name: "CAC", values: [100, 88, 76] }], numberFormat: "0", showLegend: false, insightStatement: "CAC declined each quarter", dataSourceRefs: ["dataset_cac", "source_sheet"] } }
  ] }]
};

test("native chart compiler emits chart OOXML plus embedded editable XLSX data", async () => {
  await rm(out, { force: true });
  const result = await compileDeckWithNativeCharts(deck, out, { assets: {} });
  assert.equal(result.chartElementResults[0].strategy, "native");
  const inspected = await inspectPptx(out);
  assert.equal(inspected.slides[0].graphicFrameCount, 1);
  assert.ok(inspected.entryNames.includes("ppt/charts/chart1.xml"));
  assert.ok(inspected.entryNames.includes("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx"));
});
