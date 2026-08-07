import test from "node:test";
import assert from "node:assert/strict";
import { buildChartSpec, dataStoryQuality, type Dataset } from "../packages/data-storytelling/src/index.js";

const dataset: Dataset = {
  id: "dataset_cac", categories: ["Q1", "Q2", "Q3"],
  series: [{ name: "CAC", values: [{ value: 100, dataClass: "source", evidenceRef: "e1" }, { value: 88, dataClass: "source", evidenceRef: "e2" }, { value: 76, dataClass: "source", evidenceRef: "e3" }] }],
  sourceRefs: ["source_sheet"], numberFormat: "0"
};

test("data storyteller chooses chart from the communication question and preserves provenance", () => {
  const result = buildChartSpec(dataset, { question: "trend", insightStatement: "CAC declined each quarter", claimId: "claim_cac" });
  assert.equal(result.chart.chartType, "line");
  assert.deepEqual(result.chart.dataSourceRefs, ["dataset_cac", "source_sheet"]);
  assert.equal(result.issues.some((issue) => issue.severity === "critical"), false);
  assert.equal(dataStoryQuality(result.chart).length, 0);
});

test("source values without evidence are flagged instead of silently treated as facts", () => {
  const broken: Dataset = { ...dataset, series: [{ name: "CAC", values: [{ value: 100, dataClass: "source" }, { value: 90, dataClass: "source" }, { value: 80, dataClass: "source" }] }] };
  const result = buildChartSpec(broken, { question: "trend", insightStatement: "CAC fell" });
  assert.ok(result.issues.some((issue) => issue.code === "missing-evidence"));
});
