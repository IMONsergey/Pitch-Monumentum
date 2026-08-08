import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import type { DeckDocument, SlideDocument, VectorPathData } from "../packages/deck-model/src/index.js";
import { applyDeckMutation, createMutation } from "../packages/mutations/src/index.js";
import { executeEditorCommand } from "../packages/editor-commands/src/service.js";
import { buildFreehandVector, buildPenVector, moveVectorAnchor, vectorAnchors, vectorPathToSvg } from "../packages/vector-engine/src/index.js";
import { moveVectorHandle, replaceVectorPathOperations } from "../packages/vector-engine/src/path-edit.js";
import { exportProductionPptx } from "../packages/export-pipeline/src/index.js";
import { readZipMap } from "../packages/source-ingest/src/zip.js";

function semantic() {
  return { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" as const };
}

function baseDeck(slide: SlideDocument): DeckDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: "0.1", id: "vector_deck", title: "Vector", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: now, updatedAt: now, slides: [slide],
  };
}

const simplePath: VectorPathData = {
  fillRule: "nonzero",
  commands: [
    { command: "M", x: 0, y: 0 },
    { command: "C", x1: 20, y1: 0, x2: 80, y2: 50, x: 100, y: 50 },
    { command: "L", x: 0, y: 50 },
    { command: "Z" },
  ],
};

test("Pen and Pencil builders persist structured vector pathData", () => {
  const pen = buildPenVector([
    { x: 100, y: 100 },
    { x: 240, y: 130, in: { x: 190, y: 80 } },
    { x: 280, y: 280 },
  ], true);
  assert(pen.element.pathData);
  assert.equal(pen.element.svgPath, vectorPathToSvg(pen.element.pathData!));
  assert(pen.element.pathData!.commands.some(command => command.command === "C"));
  assert.equal(pen.element.pathData!.commands.at(-1)?.command, "Z");

  const pencil = buildFreehandVector([
    { x: 50, y: 50, pressure: .2 }, { x: 80, y: 70, pressure: .4 }, { x: 120, y: 90, pressure: .8 }, { x: 160, y: 120, pressure: .6 },
  ]);
  assert(pencil.element.pathData);
  assert.equal(pencil.element.svgPath, vectorPathToSvg(pencil.element.pathData!));
  assert(pencil.element.pathData!.commands.length > 3);
});

test("vector anchors and handles are editable without changing path identity", () => {
  const anchors = vectorAnchors(simplePath);
  assert(anchors.length >= 3);
  const moved = moveVectorAnchor(simplePath, 1, 120, 60, true);
  assert.notEqual(vectorPathToSvg(moved), vectorPathToSvg(simplePath));
  const handleMoved = moveVectorHandle(moved, 1, "in", 90, 30);
  const command = handleMoved.commands[1];
  assert.equal(command.command, "C");
  if (command.command !== "C") throw new Error("Expected cubic segment");
  assert.equal(command.x2, 90);
  assert.equal(command.y2, 30);
});

test("insertVector creates one canonical structured vector scene element", () => {
  const slide: SlideDocument = { id: "s1", order: 0, title: "Vector", archetype: "freeform", semantic: semantic(), scene: [], status: "draft", qaIssueIds: [], dependencyIds: [] };
  const deck = baseDeck(slide);
  const command = executeEditorCommand(deck, {
    command: "insertVector", slideId: "s1", geometry: { x: 200, y: 200, width: 500, height: 250 }, pathData: simplePath, fill: "#112233", name: "Structured vector",
  });
  const applied = applyDeckMutation(deck, createMutation(command.reason, command.operations));
  assert.equal(applied.deck.slides[0].scene.length, 1);
  const element = applied.deck.slides[0].scene[0];
  assert.equal(element.type, "shape");
  if (element.type !== "shape") throw new Error("Expected shape");
  assert.equal(element.shape, "custom");
  assert.deepEqual(element.pathData, simplePath);
  assert.equal(element.svgPath, vectorPathToSvg(simplePath));
  assert.equal(element.exportStrategy, "vector");
});

test("node edit preserves stable vector id and parent hierarchy in one batch", () => {
  const vector = {
    id: "vector_1", type: "shape" as const, name: "Vector", semanticRole: "visual" as const, geometry: { x: 100, y: 100, width: 300, height: 150 }, zIndex: 2,
    origin: "user" as const, exportStrategy: "vector" as const, dependencies: [], groupId: "frame_1", shape: "custom" as const, fill: "#111111", pathData: simplePath, svgPath: vectorPathToSvg(simplePath),
  };
  const slide: SlideDocument = {
    id: "s1", order: 0, title: "Nested vector", archetype: "freeform", semantic: semantic(), status: "draft", qaIssueIds: [], dependencyIds: [],
    scene: [
      { id: "frame_1", type: "frame", semanticRole: "visual", geometry: { x: 60, y: 60, width: 600, height: 400 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], childIds: ["vector_1"] },
      vector,
    ],
  };
  const changedPath = moveVectorAnchor(simplePath, 1, 130, 65);
  const operations = replaceVectorPathOperations(slide, "vector_1", changedPath);
  const applied = applyDeckMutation(baseDeck(slide), createMutation("Edit nodes", operations));
  const frame = applied.deck.slides[0].scene.find(element => element.id === "frame_1");
  const nextVector = applied.deck.slides[0].scene.find(element => element.id === "vector_1");
  assert(frame?.type === "frame" && frame.childIds.includes("vector_1"));
  assert(nextVector?.type === "shape" && nextVector.pathData);
  if (!nextVector || nextVector.type !== "shape") throw new Error("Expected vector");
  assert.equal(nextVector.id, "vector_1");
  assert.equal(nextVector.svgPath, vectorPathToSvg(changedPath));
});

test("structured vector PPTX uses intrinsic viewBox and stable identity after resize", async () => {
  const slide: SlideDocument = {
    id: "s1", order: 0, title: "Export vector", archetype: "freeform", semantic: semantic(), status: "draft", qaIssueIds: [], dependencyIds: [],
    scene: [{
      id: "vector_export", type: "shape", name: "Resizable vector", semanticRole: "visual", geometry: { x: 220, y: 180, width: 900, height: 420 }, zIndex: 1,
      origin: "user", exportStrategy: "vector", dependencies: [], shape: "custom", fill: "#334455", stroke: { color: "#FFFFFF", widthDU: 3 }, pathData: simplePath, svgPath: vectorPathToSvg(simplePath),
    }],
  };
  const output = "/tmp/pitch-structured-vector.pptx";
  await rm(output, { force: true });
  const manifest = await exportProductionPptx(baseDeck(slide), output);
  assert.equal(manifest.ready, true, JSON.stringify(manifest.roundTripIssues));
  assert.equal(manifest.editability.vector, 1);
  const entries = readZipMap(await readFile(output));
  const svg = [...entries.entries()].find(([name]) => /^ppt\/media\/image\d+\.svg$/.test(name))?.[1].toString("utf8") ?? "";
  assert.match(svg, /viewBox="0 0 100 50"/);
  assert.match(svg, /width="900"/);
  assert.match(svg, /height="420"/);
  const slideXml = entries.get("ppt/slides/slide1.xml")?.toString("utf8") ?? "";
  assert.match(slideXml, /descr="pitch:id:vector_export"/);
  assert.equal(slideXml.includes("__pitch_scene_id__"), false);
});
