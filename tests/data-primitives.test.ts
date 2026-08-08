import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import type { DeckDocument, SlideDocument } from "../packages/deck-model/src/index.js";
import { applyDeckMutation, createMutation } from "../packages/mutations/src/index.js";
import { executeEditorCommand } from "../packages/editor-commands/src/service.js";
import { exportProductionPptx } from "../packages/export-pipeline/src/index.js";
import { readZipMap } from "../packages/source-ingest/src/zip.js";

function deck(): DeckDocument {
  const now = new Date().toISOString();
  const slide: SlideDocument = {
    id: "s1", order: 0, title: "Data", archetype: "freeform",
    semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "balanced" },
    scene: [], status: "draft", qaIssueIds: [], dependencyIds: [],
  };
  return { schemaVersion: "0.1", id: "data_deck", title: "Data primitives", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", slides: [slide], sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: now, updatedAt: now };
}

function applyCommand(input: DeckDocument, command: any): DeckDocument {
  const executed = executeEditorCommand(input, { ...command, slideId: "s1" });
  return applyDeckMutation(input, createMutation(executed.reason, executed.operations)).deck;
}

test("manual editor commands create native line table and chart scene objects", () => {
  let current = deck();
  current = applyCommand(current, { command: "insertLine", geometry: { x: 200, y: 180, width: 600, height: 1 }, stroke: { color: "#123456", widthDU: 4 }, endMarker: "arrow" });
  current = applyCommand(current, { command: "insertTable", geometry: { x: 240, y: 280, width: 700, height: 360 }, rows: [["Metric", "Value"], ["Revenue", "120"], ["Growth", "+24%"]] });
  current = applyCommand(current, { command: "insertChart", geometry: { x: 980, y: 240, width: 760, height: 480 }, chartType: "column", categories: ["Q1", "Q2", "Q3"], series: [{ name: "Revenue", values: [42, 58, 74] }], insightStatement: "Revenue keeps growing" });
  assert.equal(current.slides[0].scene.length, 3);
  const [line, table, chart] = current.slides[0].scene;
  assert.equal(line.type, "line");
  assert.equal(line.endMarker, "arrow");
  assert.equal(table.type, "table");
  assert.equal(table.rows[1][0].text, "Revenue");
  assert.equal(chart.type, "chart");
  assert.equal(chart.chart.chartType, "column");
  assert.deepEqual(chart.chart.series[0].values, [42, 58, 74]);
  assert(current.slides[0].scene.every(element => element.exportStrategy === "native"));
});

test("line table and chart compile as native PowerPoint objects with editable chart workbook", async () => {
  let current = deck();
  current = applyCommand(current, { command: "insertLine", geometry: { x: 160, y: 150, width: 700, height: 1 }, endMarker: "arrow" });
  current = applyCommand(current, { command: "insertTable", geometry: { x: 180, y: 260, width: 720, height: 380 } });
  current = applyCommand(current, { command: "insertChart", geometry: { x: 980, y: 220, width: 760, height: 500 }, chartType: "column", categories: ["Q1", "Q2", "Q3"], series: [{ name: "Series 1", values: [40, 64, 82] }], insightStatement: "Growth" });
  const output = "/tmp/pitch-native-data-primitives.pptx";
  await rm(output, { force: true });
  const manifest = await exportProductionPptx(current, output, { allowDraft: true });
  assert.equal(manifest.unsupportedElementIds.length, 0, JSON.stringify(manifest));
  assert.equal(manifest.editability.native, 3);
  const entries = readZipMap(await readFile(output));
  assert(entries.has("ppt/charts/chart1.xml"));
  assert([...entries.keys()].some(name => /^ppt\/embeddings\/.*\.xlsx$/i.test(name)), "Native chart must keep editable workbook data");
  const slideXml = entries.get("ppt/slides/slide1.xml")?.toString("utf8") ?? "";
  for (const element of current.slides[0].scene) assert(slideXml.includes(`descr="pitch:id:${element.id}"`), `Missing stable identity for ${element.id}`);
});
