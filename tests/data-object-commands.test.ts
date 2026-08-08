import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { executeDataObjectCommand } from "../packages/data-object-commands/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Data objects", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1", order: 0, title: "Data", archetype: "chartInsight",
      semantic: { purpose: "prove", takeaway: "", questionAnswered: "", narrativeRole: "evidence", claimIds: [], evidenceRefs: [], audienceRelevance: "board", density: "balanced" },
      scene: [
        { id: "title", type: "text", semanticRole: "title", geometry: { x: 100, y: 80, width: 900, height: 100 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Performance", fontSizePt: 36 }] }] },
        { id: "chart", type: "chart", semanticRole: "chart", geometry: { x: 100, y: 240, width: 800, height: 500 }, zIndex: 2, origin: "agent", exportStrategy: "native", dependencies: [{ kind: "dataset", id: "data" }], chart: { chartType: "column", categories: ["Q1", "Q2"], series: [{ name: "Revenue", values: [10, 12] }], insightStatement: "Revenue grew", dataSourceRefs: ["data"] } },
        { id: "table", type: "table", semanticRole: "table", geometry: { x: 980, y: 240, width: 700, height: 400 }, zIndex: 3, origin: "agent", exportStrategy: "native", dependencies: [{ kind: "evidence", id: "e1" }], rows: [[{ text: "Metric" }, { text: "Value" }], [{ text: "CAC" }, { text: "76" }]], columnWidths: [0.6, 0.4] },
      ],
      status: "ready", qaIssueIds: [], dependencyIds: [],
    }]
  };
}

test("chart command replaces only selected chart and marks evidence QA stale", () => {
  const deck = fixture();
  const titleBefore = structuredClone(deck.slides[0].scene[0]);
  const tableBefore = structuredClone(deck.slides[0].scene[2]);
  const result = executeDataObjectCommand(deck, { command: "chart", slideId: "s1", elementId: "chart", edit: { command: "setValue", seriesIndex: 0, valueIndex: 1, value: 13.5 } });
  assert.equal(result.changed, true);
  const chart = result.deck.slides[0].scene.find(element => element.id === "chart") as any;
  assert.equal(chart.chart.series[0].values[1], 13.5);
  assert.equal(chart.origin, "user");
  assert.deepEqual(result.deck.slides[0].scene[0], titleBefore);
  assert.deepEqual(result.deck.slides[0].scene[2], tableBefore);
  assert.equal(result.impact.evidenceRisk, true);
  assert(result.impact.staleArtifacts.includes("qa:evidence"));
});

test("table command replaces only selected table and preserves stable id/geometry", () => {
  const deck = fixture();
  const before = deck.slides[0].scene.find(element => element.id === "table") as any;
  const result = executeDataObjectCommand(deck, { command: "table", slideId: "s1", elementId: "table", edit: { command: "setCellText", row: 1, column: 1, text: "74" } });
  assert.equal(result.changed, true);
  const table = result.deck.slides[0].scene.find(element => element.id === "table") as any;
  assert.equal(table.id, "table");
  assert.deepEqual(table.geometry, before.geometry);
  assert.equal(table.rows[1][1].text, "74");
  assert.equal(table.origin, "user");
  assert.equal(result.impact.evidenceRisk, true);
});

test("data command rejects wrong element type and unknown handles", () => {
  const deck = fixture();
  assert.throws(() => executeDataObjectCommand(deck, { command: "chart", slideId: "s1", elementId: "table", edit: { command: "setLegend", showLegend: true } }), /not a chart/);
  assert.throws(() => executeDataObjectCommand(deck, { command: "table", slideId: "s1", elementId: "chart", edit: { command: "setCellText", row: 0, column: 0, text: "x" } }), /not a table/);
  assert.throws(() => executeDataObjectCommand(deck, { command: "chart", slideId: "missing", elementId: "chart", edit: { command: "setLegend", showLegend: true } }), /Unknown slide/);
  assert.throws(() => executeDataObjectCommand(deck, { command: "chart", slideId: "s1", elementId: "missing", edit: { command: "setLegend", showLegend: true } }), /Unknown element/);
});

test("no-op data command returns original deck object without inventing a new version candidate", () => {
  const deck = fixture();
  const result = executeDataObjectCommand(deck, { command: "chart", slideId: "s1", elementId: "chart", edit: { command: "setLegend", showLegend: false } });
  assert.equal(result.changed, false);
  assert.equal(result.deck, deck);
});
