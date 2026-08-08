import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import type { DeckDocument, VectorPathData } from "../packages/deck-model/src/index.js";
import { executeEditorCommand } from "../packages/editor-commands/src/service.js";
import { applyDeckMutation, createMutation } from "../packages/mutations/src/index.js";
import { compileDeckWithIdentity } from "../packages/pptx-identity/src/index.js";
import { readZipMap } from "../packages/source-ingest/src/zip.js";
import { deleteVectorAnchor, splitVectorSegment } from "../packages/vector-path/src/edit.js";
import {
  moveVectorAnchor,
  moveVectorHandle,
  parseSvgPathData,
  vectorPathBounds,
  vectorPathToSvg,
} from "../packages/vector-path/src/index.js";

function baseDeck(pathData: VectorPathData): DeckDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: "0.1",
    id: "vector-deck",
    title: "Vector module",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b",
    narrativeId: "n",
    designSystemId: "d",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: now,
    updatedAt: now,
    slides: [{
      id: "slide_1",
      order: 0,
      title: "Vector",
      archetype: "freeform",
      semantic: {
        purpose: "test",
        takeaway: "test",
        questionAnswered: "test",
        narrativeRole: "test",
        claimIds: [],
        evidenceRefs: [],
        audienceRelevance: "test",
        density: "balanced",
      },
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
      scene: [{
        id: "vector_1",
        name: "Editable Vector",
        type: "shape",
        shape: "custom",
        semanticRole: "visual",
        geometry: { x: 200, y: 180, width: 400, height: 240 },
        zIndex: 1,
        origin: "user",
        exportStrategy: "vector",
        dependencies: [],
        fill: "#335CFF",
        pathData,
        svgPath: vectorPathToSvg(pathData),
      }],
    }],
  };
}

test("SVG parser normalizes relative and shorthand commands into canonical editable commands", () => {
  const path = parseSvgPathData("M 10 10 h 80 v 40 h -80 z");
  assert.deepEqual(path.commands.map((command) => command.command), ["M", "L", "L", "L", "Z"]);
  assert.deepEqual(vectorPathBounds(path), { left: 10, top: 10, right: 90, bottom: 50, width: 80, height: 40 });
  assert.equal(vectorPathToSvg(path), "M 10 10 L 90 10 L 90 50 L 10 50 Z");
});

test("cubic Bezier bounds use curve extrema instead of control-point bounds", () => {
  const path = parseSvgPathData("M 0 0 C 0 100 100 100 100 0");
  const bounds = vectorPathBounds(path);
  assert.equal(bounds.left, 0);
  assert.equal(bounds.right, 100);
  assert(Math.abs(bounds.bottom - 75) < 0.0001, `expected cubic max y=75, got ${bounds.bottom}`);
});

test("splitting a cubic segment with De Casteljau preserves exact visual bounds", () => {
  const original = parseSvgPathData("M 0 0 C 0 100 100 100 100 0");
  const split = splitVectorSegment(original, 1, 0.5);
  assert.deepEqual(split.commands.map((command) => command.command), ["M", "C", "C"]);
  const before = vectorPathBounds(original);
  const after = vectorPathBounds(split);
  for (const key of ["left", "top", "right", "bottom"] as const) assert(Math.abs(before[key] - after[key]) < 0.0001, `${key} drifted`);
});

test("anchor and handle edits keep structured path semantics", () => {
  const path = parseSvgPathData("M 0 0 C 30 0 70 100 100 100 L 140 100");
  const movedAnchor = moveVectorAnchor(path, 1, 120, 120, true);
  const cubic = movedAnchor.commands[1];
  assert(cubic.command === "C");
  if (cubic.command !== "C") throw new Error("expected cubic");
  assert.equal(cubic.x, 120);
  assert.equal(cubic.y, 120);
  assert.equal(cubic.x2, 90);
  assert.equal(cubic.y2, 120);
  const movedHandle = moveVectorHandle(movedAnchor, 1, "in", 80, 80);
  const edited = movedHandle.commands[1];
  assert(edited.command === "C");
  if (edited.command !== "C") throw new Error("expected cubic");
  assert.equal(edited.x2, 80);
  assert.equal(edited.y2, 80);
});

test("deleting an internal anchor keeps path valid and refuses destructive collapse", () => {
  const path = parseSvgPathData("M 0 0 L 50 20 L 100 0 L 150 20");
  const deleted = deleteVectorAnchor(path, 2);
  assert.deepEqual(deleted.commands.map((command) => command.command), ["M", "L", "L"]);
  assert.throws(() => deleteVectorAnchor(parseSvgPathData("M 0 0 L 10 10"), 1), /at least two anchors/);
});

test("fit-bounds node edit updates path and geometry atomically while preserving stable id", () => {
  const path = parseSvgPathData("M 0 0 L 100 0 L 100 100 L 0 100 Z");
  const deck = baseDeck(path);
  const edited = moveVectorAnchor(path, 0, -50, 0, true);
  const command = executeEditorCommand(deck, { command: "setVectorPath", slideId: "slide_1", elementId: "vector_1", pathData: edited, fitBounds: true });
  assert.equal(command.operations.length, 2);
  const applied = applyDeckMutation(deck, createMutation("node edit", command.operations));
  const vector = applied.deck.slides[0].scene[0];
  assert.equal(vector.id, "vector_1");
  assert(vector.type === "shape" && vector.shape === "custom");
  if (vector.type !== "shape" || vector.shape !== "custom") throw new Error("expected custom vector");
  assert.equal(vector.geometry.x, 0);
  assert.equal(vector.geometry.width, 600);
  assert(vector.pathData);
  assert.equal(vectorPathBounds(vector.pathData!).left, 0);
  assert.equal(vectorPathBounds(vector.pathData!).width, 150);
});

test("vector mutation rejects non-vector targets instead of changing arbitrary elements", () => {
  const path = parseSvgPathData("M 0 0 L 100 0 L 100 100 Z");
  const deck = baseDeck(path);
  const invalid = structuredClone(deck);
  (invalid.slides[0].scene[0] as any).shape = "rect";
  assert.throws(() => executeEditorCommand(invalid, { command: "setVectorPath", slideId: "slide_1", elementId: "vector_1", pathData: path }), /not an editable custom vector/);
});

test("vector PPTX export preserves stable Pitch identity and vector media", async () => {
  const pathData = parseSvgPathData("M 0 0 C 0 100 100 100 100 0 Z");
  const deck = baseDeck(pathData);
  const output = "/tmp/pitch-vector-module.pptx";
  await rm(output, { force: true });
  const result = await compileDeckWithIdentity(deck, output, {});
  assert(result.elementResults.some((item) => item.elementId === "vector_1" && item.strategy === "vector"));
  const entries = readZipMap(await readFile(output));
  const slideXml = entries.get("ppt/slides/slide1.xml")?.toString("utf8") ?? "";
  assert.match(slideXml, /descr="pitch:id:vector_1"/);
  assert([...entries.keys()].some((name) => /^ppt\/media\/image\d+\.svg$/.test(name)), "expected vector SVG media");
  await rm(output, { force: true });
});

test("editable SVG parser rejects arc commands explicitly instead of silently corrupting them", () => {
  assert.throws(() => parseSvgPathData("M 0 0 A 20 20 0 0 1 40 40"), /arc commands/);
});
