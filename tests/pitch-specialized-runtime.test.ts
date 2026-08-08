import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import { PitchSpecializedRuntime } from "../packages/pitch-specialized-runtime/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";

const root = "/tmp/pitch-specialized-runtime-test";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Specialized", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Data", archetype: "chartInsight", semantic: { purpose: "prove", takeaway: "", questionAnswered: "", narrativeRole: "evidence", claimIds: [], evidenceRefs: [], audienceRelevance: "board", density: "balanced" }, scene: [
      { id: "title", type: "text", semanticRole: "title", geometry: { x: 100, y: 80, width: 900, height: 120 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Performance", fontSizePt: 38 }] }] },
      { id: "chart", type: "chart", semanticRole: "chart", geometry: { x: 100, y: 260, width: 800, height: 500 }, zIndex: 2, origin: "agent", exportStrategy: "native", dependencies: [{ kind: "dataset", id: "data" }], chart: { chartType: "column", categories: ["Q1", "Q2"], series: [{ name: "Revenue", values: [10, 12] }], insightStatement: "Revenue grew", dataSourceRefs: ["data"] } },
      { id: "table", type: "table", semanticRole: "table", geometry: { x: 980, y: 260, width: 700, height: 400 }, zIndex: 3, origin: "agent", exportStrategy: "native", dependencies: [], rows: [[{ text: "Metric" }, { text: "Value" }], [{ text: "CAC" }, { text: "76" }]] }
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }]
  };
}

async function setup(): Promise<PitchSpecializedRuntime> {
  await rm(root, { recursive: true, force: true });
  const store = new ArtifactStore(root);
  await store.init("Specialized", "specialized_project");
  await store.write({ id: "deck", kind: "deck", payload: fixture(), producer: { type: "deterministic" } });
  return new PitchSpecializedRuntime(root);
}

test("scoped read exposes selected chart data without dumping unrelated objects", async () => {
  const runtime = await setup();
  const context = await runtime.readObjects({ slideId: "s1", elementIds: ["chart"] });
  assert.equal(context.objects.length, 1);
  assert.equal((context.objects[0] as any).id, "chart");
  assert.deepEqual((context.objects[0] as any).chart.series[0].values, [10, 12]);
});

test("Codex vector insertion creates exactly one deck version and undo restores it", async () => {
  const runtime = await setup();
  const before = await runtime.state();
  const inserted = await runtime.insertVector({
    slideId: "s1",
    expectedDeckHash: before.deckHash,
    vector: { geometry: { x: 240, y: 820, width: 400, height: 120 }, svgPath: "M 0 70 C 120 0 240 120 400 50", fill: "transparent", stroke: { color: "#111111", widthDU: 4 }, name: "Codex curve" },
  });
  assert(inserted.insertedElementId);
  assert(inserted.deck.slides[0].scene.some(element => element.id === inserted.insertedElementId && element.type === "shape" && element.shape === "custom"));
  assert.equal(inserted.deck.slides[0].scene.find(element => element.id === inserted.insertedElementId)?.origin, "agent");
  const head = Object.values(inserted.manifest.branches[inserted.manifest.activeBranchId].heads).find((value: any) => value.kind === "deck") as any;
  assert.equal(head.version, 2);
  const undone = await runtime.undo();
  assert.equal(undone.deck.slides[0].scene.some(element => element.id === inserted.insertedElementId), false);
});

test("Codex chart and table edits are bounded, versioned and preserve unrelated text", async () => {
  const runtime = await setup();
  const before = await runtime.state();
  const chart = await runtime.editDataObject({ expectedDeckHash: before.deckHash, edit: { command: "chart", slideId: "s1", elementId: "chart", edit: { command: "setValue", seriesIndex: 0, valueIndex: 1, value: 13.5 } } });
  assert.equal(chart.changed, true);
  assert.equal(((chart.deck.slides[0].scene.find(element => element.id === "chart") as any).chart.series[0].values[1]), 13.5);
  assert.equal((chart.deck.slides[0].scene.find(element => element.id === "title") as any).paragraphs[0].runs[0].text, "Performance");

  const table = await runtime.editDataObject({ expectedDeckHash: chart.deckHash, edit: { command: "table", slideId: "s1", elementId: "table", edit: { command: "setCellText", row: 1, column: 1, text: "74" } } });
  assert.equal(((table.deck.slides[0].scene.find(element => element.id === "table") as any).rows[1][1].text), "74");
  const head = Object.values(table.manifest.branches[table.manifest.activeBranchId].heads).find((value: any) => value.kind === "deck") as any;
  assert.equal(head.version, 3);
});

test("specialized runtime rejects stale optimistic edits", async () => {
  const runtime = await setup();
  const before = await runtime.state();
  await runtime.editDataObject({ expectedDeckHash: before.deckHash, edit: { command: "chart", slideId: "s1", elementId: "chart", edit: { command: "setLegend", showLegend: true } } });
  await assert.rejects(() => runtime.insertVector({ slideId: "s1", expectedDeckHash: before.deckHash, vector: { geometry: { x: 0, y: 0, width: 100, height: 100 }, svgPath: "M 0 0 L 100 100" } }), /Deck changed/);
});
