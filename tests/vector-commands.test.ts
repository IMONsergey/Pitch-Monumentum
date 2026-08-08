import test from "node:test";
import assert from "node:assert/strict";
import type { SlideDocument } from "../packages/deck-model/src/index.js";
import { buildInsertVectorCommand } from "../packages/vector-commands/src/index.js";
import { applyDeckMutation, createMutation } from "../packages/mutations/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { parseSvgPathData, vectorPathToSvg } from "../packages/vector-path/src/index.js";

function slide(): SlideDocument {
  return {
    id: "s1", order: 0, title: "Vector", archetype: "freeform",
    semantic: { purpose: "draw", takeaway: "", questionAnswered: "", narrativeRole: "working", claimIds: [], evidenceRefs: [], audienceRelevance: "", density: "balanced" },
    scene: [{ id: "existing", type: "shape", semanticRole: "visual", geometry: { x: 0, y: 0, width: 100, height: 100 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#FFFFFF" }],
    status: "draft", qaIssueIds: [], dependencyIds: [],
  };
}

function deck(s: SlideDocument): DeckDocument {
  return { schemaVersion: "0.1", id: "d", title: "Vector", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "ds", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides: [s] };
}

test("legacy insertVector facade upgrades supported SVG path into canonical pathData", () => {
  const s = slide();
  const built = buildInsertVectorCommand(s, {
    geometry: { x: 220, y: 160, width: 480, height: 210, rotation: 5 },
    svgPath: "M 0 120 C 120 0 240 240 480 80",
    fill: "transparent",
    stroke: { color: "#111111", widthDU: 4 },
    name: "Pen curve",
  });
  assert.equal(built.operations.length, 1);
  assert.equal(built.element.shape, "custom");
  assert.equal(built.element.exportStrategy, "vector");
  assert.equal(built.element.zIndex, 5);
  assert.equal(built.element.name, "Pen curve");
  assert(built.element.pathData, "supported SVG must be upgraded to structured vector data");
  assert.equal(built.element.svgPath, vectorPathToSvg(built.element.pathData!));
  const applied = applyDeckMutation(deck(s), createMutation("insert vector", built.operations)).deck;
  const inserted = applied.slides[0].scene.find(element => element.id === built.element.id) as any;
  assert(inserted?.pathData);
  assert.equal(inserted.svgPath, vectorPathToSvg(inserted.pathData));
});

test("insertVector accepts canonical pathData directly and derives compatibility SVG", () => {
  const s = slide();
  const pathData = parseSvgPathData("M 0 0 L 100 0 L 100 100 Z");
  const built = buildInsertVectorCommand(s, { geometry: { x: 40, y: 60, width: 200, height: 200 }, pathData, fill: "#C7FF5E" });
  assert.deepEqual(built.element.pathData, pathData);
  assert.equal(built.element.svgPath, vectorPathToSvg(pathData));
});

test("unsupported arc stays explicit legacy vector instead of being corrupted", () => {
  const s = slide();
  const built = buildInsertVectorCommand(s, { geometry: { x: 0, y: 0, width: 100, height: 100 }, svgPath: "M 0 0 A 50 50 0 0 1 100 100" });
  assert.equal(built.element.pathData, undefined);
  assert.equal(built.element.svgPath, "M 0 0 A 50 50 0 0 1 100 100");
});

test("insertVector fails closed for empty, markup-like or invalid geometry/path style", () => {
  const s = slide();
  assert.throws(() => buildInsertVectorCommand(s, { geometry: { x: 0, y: 0, width: 100, height: 100 } }), /pathData or svgPath is required/);
  assert.throws(() => buildInsertVectorCommand(s, { geometry: { x: 0, y: 0, width: 100, height: 100 }, svgPath: "<script>alert(1)</script>" }), /move command|invalid markup/);
  assert.throws(() => buildInsertVectorCommand(s, { geometry: { x: 0, y: 0, width: 0, height: 100 }, svgPath: "M 0 0 L 10 10" }), /width must be greater than zero/);
  assert.throws(() => buildInsertVectorCommand(s, { geometry: { x: 0, y: 0, width: 100, height: 100 }, svgPath: "M 0 0 L 10 10", fill: "red" }), /fill must be/);
  assert.throws(() => buildInsertVectorCommand(s, { geometry: { x: 0, y: 0, width: 100, height: 100 }, svgPath: "M 0 0 L 10 10", stroke: { color: "black", widthDU: 2 } }), /stroke color/);
});
