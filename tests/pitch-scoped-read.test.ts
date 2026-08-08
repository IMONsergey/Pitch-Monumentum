import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { buildScopedObjectContext } from "../packages/pitch-tools/src/scoped-read.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Scoped", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: ["claim"], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1", order: 0, title: "Decision", archetype: "chartInsight",
      semantic: { purpose: "prove", takeaway: "CAC is improving", questionAnswered: "is efficiency improving?", narrativeRole: "evidence", claimIds: ["claim"], evidenceRefs: ["e1"], audienceRelevance: "board", density: "balanced" },
      scene: [
        { id: "title", type: "text", semanticRole: "title", geometry: { x: 100, y: 80, width: 1200, height: 120 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [{ kind: "claim", id: "claim" }], paragraphs: [{ runs: [{ text: "CAC is improving", fontFamily: "Inter", fontSizePt: 38, bold: true }] }] },
        { id: "chart", type: "chart", semanticRole: "chart", geometry: { x: 100, y: 260, width: 900, height: 520 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [{ kind: "dataset", id: "data" }], chart: { chartType: "line", categories: ["Q1", "Q2"], series: [{ name: "CAC", values: [100, 76] }], insightStatement: "CAC declined", dataSourceRefs: ["data"] } },
        { id: "table", type: "table", semanticRole: "table", geometry: { x: 1100, y: 260, width: 600, height: 300 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [], rows: [[{ text: "Metric" }, { text: "Value" }], [{ text: "CAC" }, { text: "76" }]] },
      ],
      status: "draft", qaIssueIds: [], dependencyIds: [],
    }],
  };
}

test("scoped read returns exact selected text/chart details plus slide semantic contract", () => {
  const context = buildScopedObjectContext(fixture(), { slideId: "s1", elementIds: ["title", "chart"] });
  assert.equal(context.slide.takeaway, undefined);
  assert.equal(context.slide.semantic.takeaway, "CAC is improving");
  const title = context.objects[0] as any;
  const chart = context.objects[1] as any;
  assert.equal(title.id, "title");
  assert.equal(title.paragraphs[0].runs[0].text, "CAC is improving");
  assert.equal(title.paragraphs[0].runs[0].fontSizePt, 38);
  assert.deepEqual(chart.chart.series[0].values, [100, 76]);
  assert.deepEqual(chart.chart.dataSourceRefs, ["data"]);
  assert.equal((context as any).slides, undefined, "scoped read must not return unrelated deck slides");
});

test("scoped text budget truncates large text deterministically and emits a warning", () => {
  const deck = fixture();
  const text = deck.slides[0].scene.find((element) => element.id === "title") as any;
  text.paragraphs[0].runs[0].text = "A".repeat(3000);
  const context = buildScopedObjectContext(deck, { slideId: "s1", elementIds: ["title"], maxTextChars: 500 });
  const value = (context.objects[0] as any).paragraphs[0].runs[0].text;
  assert(value.length <= 500);
  assert(value.endsWith("…"));
  assert(context.warnings.some((warning) => warning.includes("truncated")));
});

test("scoped read deduplicates ids, limits object count, and fails on unknown handles", () => {
  const deck = fixture();
  const context = buildScopedObjectContext(deck, { slideId: "s1", elementIds: ["title", "title", "chart", "table"], maxElements: 2 });
  assert.equal(context.objects.length, 2);
  assert(context.warnings.some((warning) => warning.includes("only the first 2")));
  assert.throws(() => buildScopedObjectContext(deck, { slideId: "s1", elementIds: ["missing"] }), /Unknown element/);
  assert.throws(() => buildScopedObjectContext(deck, { slideId: "missing", elementIds: [] }), /Unknown slide/);
});
