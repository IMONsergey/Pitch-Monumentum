import test from "node:test";
import assert from "node:assert/strict";
import type { ChartElement } from "../packages/deck-model/src/index.js";
import { executeChartCommand, validateChartSpec } from "../packages/chart-editor/src/index.js";

function chart(): ChartElement {
  return {
    id: "chart",
    type: "chart",
    semanticRole: "chart",
    geometry: { x: 100, y: 100, width: 800, height: 500 },
    zIndex: 1,
    origin: "user",
    exportStrategy: "native",
    dependencies: [{ kind: "dataset", id: "dataset" }],
    chart: {
      chartType: "column",
      categories: ["Q1", "Q2", "Q3"],
      series: [{ name: "Revenue", values: [10, 12, 15] }],
      insightStatement: "Revenue is accelerating",
      dataSourceRefs: ["dataset"],
      showLegend: false,
      numberFormat: "0.0",
    },
  };
}

test("chart editor changes one value immutably and preserves source metadata", () => {
  const original = chart();
  const result = executeChartCommand(original, { command: "setValue", seriesIndex: 0, valueIndex: 1, value: 13.5 });
  assert.equal(result.changed, true);
  assert.equal(result.chart.series[0].values[1], 13.5);
  assert.equal(original.chart.series[0].values[1], 12);
  assert.deepEqual(result.chart.dataSourceRefs, ["dataset"]);
  assert.equal(result.warnings.length, 0);
});

test("chart editor supports type, insight, legend and native data changes", () => {
  const original = chart();
  let result = executeChartCommand(original, { command: "setChartType", chartType: "line" });
  assert.equal(result.chart.chartType, "line");
  result = executeChartCommand({ ...original, chart: result.chart }, { command: "setLegend", showLegend: true });
  assert.equal(result.chart.showLegend, true);
  result = executeChartCommand({ ...original, chart: result.chart }, { command: "setInsight", insightStatement: "  Growth continues  " });
  assert.equal(result.chart.insightStatement, "Growth continues");
  result = executeChartCommand({ ...original, chart: result.chart }, { command: "setNumberFormat", numberFormat: "$0.0m" });
  assert.equal(result.chart.numberFormat, "$0.0m");
});

test("series lifecycle keeps category/value lengths aligned", () => {
  const original = chart();
  const added = executeChartCommand(original, { command: "addSeries", series: { name: "Margin", values: [4, 5, 7] } });
  assert.equal(added.chart.series.length, 2);
  assert.equal(added.chart.series[1].name, "Margin");
  const renamed = executeChartCommand({ ...original, chart: added.chart }, { command: "renameSeries", seriesIndex: 1, name: "Gross margin" });
  assert.equal(renamed.chart.series[1].name, "Gross margin");
  const removed = executeChartCommand({ ...original, chart: renamed.chart }, { command: "removeSeries", seriesIndex: 0 });
  assert.equal(removed.chart.series.length, 1);
  assert.equal(removed.chart.series[0].name, "Gross margin");
});

test("replaceData can update dataset while retaining explicit provenance refs", () => {
  const original = chart();
  const result = executeChartCommand(original, {
    command: "replaceData",
    categories: ["2024", "2025"],
    series: [{ name: "ARR", values: [50, 78] }, { name: "Plan", values: [52, 80] }],
    dataSourceRefs: ["source:new", "source:new", "sheet:ARR"],
  });
  assert.deepEqual(result.chart.categories, ["2024", "2025"]);
  assert.deepEqual(result.chart.series[0].values, [50, 78]);
  assert.deepEqual(result.chart.dataSourceRefs, ["source:new", "sheet:ARR"]);
});

test("invalid chart edits fail closed instead of silently truncating data", () => {
  const original = chart();
  assert.throws(() => executeChartCommand(original, { command: "addSeries", series: { name: "Bad", values: [1, 2] } }), /expects 3/);
  assert.throws(() => executeChartCommand(original, { command: "setCategories", categories: ["A", "B"] }), /expects 2|has 3 values/);
  assert.throws(() => executeChartCommand(original, { command: "removeSeries", seriesIndex: 0 }), /at least one series/);
  assert.throws(() => executeChartCommand(original, { command: "setValue", seriesIndex: 0, valueIndex: 1, value: Number.NaN }), /finite/);
  assert.throws(() => executeChartCommand(original, { command: "setValue", seriesIndex: 9, valueIndex: 0, value: 1 }), /out of range/);
});

test("chart validation warns about weak semantic/provenance state", () => {
  const weak = chart().chart;
  weak.insightStatement = "";
  weak.dataSourceRefs = [];
  weak.series.push({ name: "Revenue", values: [1, 2, 3] });
  const warnings = validateChartSpec(weak);
  assert(warnings.some((warning) => warning.includes("no insight")));
  assert(warnings.some((warning) => warning.includes("no data source")));
  assert(warnings.some((warning) => warning.includes("same name")));
});
