import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SceneElement } from "../packages/deck-model/src/index.js";
import { executeEditorCommand } from "../packages/editor-commands/src/service.js";
import { applyDeckMutation, createMutation } from "../packages/mutations/src/index.js";

function deck(): DeckDocument {
  const scene: SceneElement[] = [
    { id: "shape", type: "shape", semanticRole: "visual", geometry: { x: 100, y: 100, width: 300, height: 180 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], shape: "roundRect", fill: "#eeeeee" },
    { id: "frame", type: "frame", semanticRole: "visual", geometry: { x: 500, y: 100, width: 500, height: 300 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], childIds: ["child"] },
    { id: "child", type: "shape", semanticRole: "visual", geometry: { x: 540, y: 140, width: 100, height: 80 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#cccccc" },
    { id: "image", type: "image", semanticRole: "visual", geometry: { x: 100, y: 500, width: 320, height: 200 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset" }], assetId: "asset", fit: "cover" },
    { id: "line", type: "line", semanticRole: "visual", geometry: { x: 500, y: 500, width: 400, height: 100 }, zIndex: 5, origin: "user", exportStrategy: "native", dependencies: [], start: [0, 0], end: [400, 100], stroke: { color: "#111111", widthDU: 2 } },
    { id: "text", type: "text", semanticRole: "body", geometry: { x: 100, y: 760, width: 600, height: 100 }, zIndex: 6, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Text", fontSizePt: 24 }] }] },
  ];
  return {
    schemaVersion: "0.1", id: "deck", title: "Style", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Style", archetype: "freeform", semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "balanced" }, scene, status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

function applyCommand(source: DeckDocument, input: any): DeckDocument {
  const executed = executeEditorCommand(source, { slideId: "s1", ...input });
  return applyDeckMutation(source, createMutation(executed.reason, executed.operations)).deck;
}

test("shape and frame styles remain canonical editable properties", () => {
  let current = applyCommand(deck(), {
    command: "setStyle",
    elementId: "shape",
    style: { kind: "shape", fill: "#ff0000", stroke: { color: "#000000", widthDU: 3, dash: "dash" }, radiusDU: 28 },
  });
  const shape = current.slides[0].scene.find((element) => element.id === "shape")!;
  assert.equal(shape.type, "shape");
  if (shape.type !== "shape") throw new Error("shape missing");
  assert.equal(shape.fill, "#ff0000");
  assert.deepEqual(shape.stroke, { color: "#000000", widthDU: 3, dash: "dash" });
  assert.equal(shape.radiusDU, 28);

  current = applyCommand(current, {
    command: "setStyle",
    elementId: "frame",
    style: { kind: "frame", fill: "#ffffff", stroke: { color: "#333333", widthDU: 1 }, radiusDU: 20, clipContent: true },
  });
  const frame = current.slides[0].scene.find((element) => element.id === "frame")!;
  assert.equal(frame.type, "frame");
  if (frame.type !== "frame") throw new Error("frame missing");
  assert.equal(frame.clipContent, true);
  assert.deepEqual(frame.childIds, ["child"]);
});

test("image and line style commands preserve their native semantics", () => {
  let current = applyCommand(deck(), { command: "setStyle", elementId: "image", style: { kind: "image", fit: "contain", cornerRadiusDU: 36 } });
  const image = current.slides[0].scene.find((element) => element.id === "image")!;
  assert.equal(image.type, "image");
  if (image.type !== "image") throw new Error("image missing");
  assert.equal(image.fit, "contain");
  assert.equal(image.cornerRadiusDU, 36);

  current = applyCommand(current, {
    command: "setStyle",
    elementId: "line",
    style: { kind: "line", stroke: { color: "#00aa66", widthDU: 5, dash: "dot" }, startMarker: "dot", endMarker: "arrow" },
  });
  const line = current.slides[0].scene.find((element) => element.id === "line")!;
  assert.equal(line.type, "line");
  if (line.type !== "line") throw new Error("line missing");
  assert.deepEqual(line.stroke, { color: "#00aa66", widthDU: 5, dash: "dot" });
  assert.equal(line.startMarker, "dot");
  assert.equal(line.endMarker, "arrow");
});

test("visual style type mismatch is rejected before mutation commit", () => {
  assert.throws(() => executeEditorCommand(deck(), {
    command: "setStyle",
    slideId: "s1",
    elementId: "text",
    style: { kind: "shape", fill: "#ff0000" },
  }), /does not match text element/);
});

test("Inspector can atomically change geometry, presentation and visual style", () => {
  const source = deck();
  const executed = executeEditorCommand(source, {
    command: "setInspector",
    slideId: "s1",
    elementId: "shape",
    geometry: { x: 140, y: 160 },
    presentation: { opacity: 0.75, name: "Hero shape" },
    style: { kind: "shape", fill: "#2244aa", radiusDU: 18 },
  });
  assert.equal(executed.operations.length, 3);
  const next = applyDeckMutation(source, createMutation(executed.reason, executed.operations)).deck;
  const shape = next.slides[0].scene.find((element) => element.id === "shape")!;
  assert.equal(shape.geometry.x, 140);
  assert.equal(shape.opacity, 0.75);
  assert.equal(shape.name, "Hero shape");
  assert.equal(shape.type, "shape");
  if (shape.type === "shape") {
    assert.equal(shape.fill, "#2244aa");
    assert.equal(shape.radiusDU, 18);
  }
});
