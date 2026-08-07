import type { ChartSpec } from "../../deck-model/src/index.js";

export type DataValueClass = "source" | "external" | "scenario" | "derived";
export interface DataValue { value: number; evidenceRef?: string; dataClass: DataValueClass; }
export interface DataSeries { name: string; values: DataValue[]; }
export interface Dataset { id: string; categories: string[]; series: DataSeries[]; sourceRefs: string[]; numberFormat?: string; }
export type ChartQuestion = "trend" | "comparison" | "composition" | "relationship" | "distribution" | "ranking";
export interface ChartIntent { question: ChartQuestion; insightStatement: string; claimId?: string; emphasizeSeries?: string[]; preferHorizontal?: boolean; }
export interface ChartIssue { severity: "minor" | "major" | "critical"; code: string; message: string; }

export function chooseChartType(dataset: Dataset, intent: ChartIntent): ChartSpec["chartType"] {
  switch (intent.question) {
    case "trend": return "line";
    case "relationship": return dataset.series.length >= 2 ? "scatter" : "line";
    case "composition": return dataset.series.length === 1 && dataset.categories.length <= 6 ? "doughnut" : "bar";
    case "ranking": return "bar";
    case "comparison": return intent.preferHorizontal || dataset.categories.some((c) => c.length > 16) ? "bar" : "column";
    case "distribution": return "column";
  }
}
export function validateDataset(dataset: Dataset): ChartIssue[] {
  const issues: ChartIssue[] = [];
  if (!dataset.categories.length) issues.push({ severity: "critical", code: "no-categories", message: "Dataset has no categories" });
  if (!dataset.series.length) issues.push({ severity: "critical", code: "no-series", message: "Dataset has no numeric series" });
  const names = new Set<string>();
  for (const series of dataset.series) {
    if (names.has(series.name)) issues.push({ severity: "major", code: "duplicate-series", message: `Duplicate series name: ${series.name}` });
    names.add(series.name);
    if (series.values.length !== dataset.categories.length) issues.push({ severity: "critical", code: "length-mismatch", message: `Series ${series.name} has ${series.values.length} values for ${dataset.categories.length} categories` });
    for (const item of series.values) {
      if (!Number.isFinite(item.value)) issues.push({ severity: "critical", code: "non-finite", message: `Series ${series.name} contains a non-finite value` });
      if (item.dataClass !== "scenario" && !item.evidenceRef) issues.push({ severity: "major", code: "missing-evidence", message: `Series ${series.name} contains a non-scenario value without evidence provenance` });
    }
  }
  if (dataset.series.length > 6) issues.push({ severity: "major", code: "too-many-series", message: "More than six series will usually reduce slide readability" });
  if (!dataset.sourceRefs.length && dataset.series.some((s) => s.values.some((v) => v.dataClass !== "scenario"))) issues.push({ severity: "major", code: "dataset-source-missing", message: "Source-backed dataset has no dataset-level source refs" });
  return issues;
}
export function buildChartSpec(dataset: Dataset, intent: ChartIntent): { chart: ChartSpec; issues: ChartIssue[] } {
  const issues = validateDataset(dataset);
  if (!intent.insightStatement.trim()) issues.push({ severity: "critical", code: "no-insight", message: "A presentation chart must state the insight it is intended to prove" });
  const chartType = chooseChartType(dataset, intent);
  if ((chartType === "pie" || chartType === "doughnut") && dataset.series.some((s) => s.values.some((v) => v.value < 0))) issues.push({ severity: "critical", code: "negative-composition", message: "Pie/doughnut charts cannot represent negative composition values" });
  if ((chartType === "pie" || chartType === "doughnut") && dataset.series.length !== 1) issues.push({ severity: "major", code: "multi-series-composition", message: "Composition chart should use a single series" });
  return {
    chart: { chartType, categories: dataset.categories, series: dataset.series.map((s) => ({ name: s.name, values: s.values.map((v) => v.value) })), numberFormat: dataset.numberFormat, showLegend: dataset.series.length > 1, insightStatement: intent.insightStatement, dataSourceRefs: [dataset.id, ...dataset.sourceRefs] },
    issues
  };
}
export function dataStoryQuality(chart: ChartSpec): ChartIssue[] {
  const issues: ChartIssue[] = [];
  if (!chart.insightStatement.trim()) issues.push({ severity: "critical", code: "no-insight", message: "Chart has no insight statement" });
  if (!chart.dataSourceRefs.length) issues.push({ severity: "critical", code: "no-provenance", message: "Chart has no data-source provenance" });
  const categories = chart.categories ?? [];
  for (const series of chart.series) if (series.values.length !== categories.length) issues.push({ severity: "critical", code: "length-mismatch", message: `Chart series ${series.name} does not align with categories` });
  if (categories.length > 18 && chart.chartType !== "line" && chart.chartType !== "scatter") issues.push({ severity: "major", code: "category-density", message: "Too many categories for a presentation-distance chart" });
  return issues;
}
