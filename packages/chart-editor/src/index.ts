import type { ChartElement, ChartSeries, ChartSpec } from "../../deck-model/src/index.js";

export type ChartCommand =
  | { command: "setChartType"; chartType: ChartSpec["chartType"] }
  | { command: "setInsight"; insightStatement: string }
  | { command: "setCategories"; categories: string[] }
  | { command: "setNumberFormat"; numberFormat?: string }
  | { command: "setLegend"; showLegend: boolean }
  | { command: "addSeries"; series: ChartSeries; index?: number }
  | { command: "removeSeries"; seriesIndex: number }
  | { command: "renameSeries"; seriesIndex: number; name: string }
  | { command: "setValue"; seriesIndex: number; valueIndex: number; value: number }
  | { command: "replaceSeries"; series: ChartSeries[] }
  | { command: "replaceData"; categories: string[]; series: ChartSeries[]; dataSourceRefs?: string[] };

export interface ChartEditResult {
  chart: ChartSpec;
  changed: boolean;
  warnings: string[];
}

function cleanCategories(categories: string[]): string[] {
  return categories.map((value) => String(value ?? "").trim());
}

function cleanSeries(series: ChartSeries): ChartSeries {
  const name = String(series.name ?? "").trim() || "Series";
  const values = series.values.map((value, index) => {
    if (!Number.isFinite(value)) throw new Error(`Series ${name} value ${index} must be finite`);
    return value;
  });
  return { name, values };
}

function validateData(categories: string[] | undefined, series: ChartSeries[]): string[] {
  const warnings: string[] = [];
  if (!series.length) throw new Error("Chart must contain at least one series");
  const expected = categories?.length ?? Math.max(...series.map((item) => item.values.length));
  if (expected <= 0) throw new Error("Chart data must contain at least one value/category");
  for (const item of series) {
    if (item.values.length !== expected) throw new Error(`Series ${item.name} has ${item.values.length} values but chart expects ${expected}`);
  }
  if (categories && categories.some((category) => !category)) warnings.push("One or more chart categories are empty.");
  const names = series.map((item) => item.name);
  if (new Set(names).size !== names.length) warnings.push("Two or more chart series have the same name.");
  return warnings;
}

function cloneChart(chart: ChartSpec): ChartSpec {
  return structuredClone(chart);
}

function indexInRange(index: number, length: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) throw new Error(`${label} index ${index} is out of range`);
}

export function validateChartSpec(chart: ChartSpec): string[] {
  const categories = chart.categories ? cleanCategories(chart.categories) : undefined;
  const series = chart.series.map(cleanSeries);
  const warnings = validateData(categories, series);
  if (!chart.insightStatement?.trim()) warnings.push("Chart has no insight statement.");
  if (!chart.dataSourceRefs?.length) warnings.push("Chart has no data source references.");
  return warnings;
}

export function executeChartCommand(element: ChartElement, input: ChartCommand): ChartEditResult {
  const chart = cloneChart(element.chart);
  const before = JSON.stringify(chart);

  if (input.command === "setChartType") chart.chartType = input.chartType;
  else if (input.command === "setInsight") chart.insightStatement = input.insightStatement.trim();
  else if (input.command === "setNumberFormat") chart.numberFormat = input.numberFormat?.trim() || undefined;
  else if (input.command === "setLegend") chart.showLegend = input.showLegend;
  else if (input.command === "setCategories") {
    const categories = cleanCategories(input.categories);
    validateData(categories, chart.series.map(cleanSeries));
    chart.categories = categories;
  } else if (input.command === "addSeries") {
    const series = cleanSeries(input.series);
    const expected = chart.categories?.length ?? chart.series[0]?.values.length;
    if (expected !== undefined && series.values.length !== expected) throw new Error(`New series has ${series.values.length} values but chart expects ${expected}`);
    const index = input.index === undefined ? chart.series.length : Math.max(0, Math.min(chart.series.length, input.index));
    chart.series.splice(index, 0, series);
  } else if (input.command === "removeSeries") {
    indexInRange(input.seriesIndex, chart.series.length, "Series");
    if (chart.series.length === 1) throw new Error("Chart must keep at least one series");
    chart.series.splice(input.seriesIndex, 1);
  } else if (input.command === "renameSeries") {
    indexInRange(input.seriesIndex, chart.series.length, "Series");
    chart.series[input.seriesIndex].name = input.name.trim() || "Series";
  } else if (input.command === "setValue") {
    indexInRange(input.seriesIndex, chart.series.length, "Series");
    indexInRange(input.valueIndex, chart.series[input.seriesIndex].values.length, "Value");
    if (!Number.isFinite(input.value)) throw new Error("Chart value must be finite");
    chart.series[input.seriesIndex].values[input.valueIndex] = input.value;
  } else if (input.command === "replaceSeries") {
    chart.series = input.series.map(cleanSeries);
  } else {
    chart.categories = cleanCategories(input.categories);
    chart.series = input.series.map(cleanSeries);
    if (input.dataSourceRefs) chart.dataSourceRefs = [...new Set(input.dataSourceRefs.map((value) => String(value).trim()).filter(Boolean))];
  }

  chart.series = chart.series.map(cleanSeries);
  if (chart.categories) chart.categories = cleanCategories(chart.categories);
  const warnings = validateData(chart.categories, chart.series);
  if (!chart.insightStatement?.trim()) warnings.push("Chart has no insight statement.");
  if (!chart.dataSourceRefs?.length) warnings.push("Chart has no data source references.");
  return { chart, changed: JSON.stringify(chart) !== before, warnings };
}
