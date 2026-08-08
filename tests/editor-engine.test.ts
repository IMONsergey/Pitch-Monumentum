import test from "node:test";
import assert from "node:assert/strict";
import {
  EditorEngineController,
  geometryCommit,
  normalizeSelection,
  type EditorInteractionPreview,
} from "../packages/editor-engine/src/index.js";

test("selection normalization removes duplicates and chooses a stable primary element", () => {
  const selection = normalizeSelection({
    slideId: "slide_1",
    elementIds: ["a", "b", "a"],
    primaryElementId: "missing",
    mode: "element",
  });
  assert.deepEqual(selection.elementIds, ["a", "b"]);
  assert.equal(selection.primaryElementId, "a");
});

test("geometry interaction commits one domain mutation for a multi-selection", () => {
  const controller = new EditorEngineController();
  controller.setSelection({
    slideId: "slide_1",
    elementIds: ["a", "b"],
    primaryElementId: "a",
    mode: "element",
  });
  const preview: EditorInteractionPreview = {
    sessionId: "drag_1",
    slideId: "slide_1",
    elementIds: ["a", "b"],
    geometryByElementId: {
      a: { x: 120, y: 80 },
      b: { x: 440, y: 80 },
    },
    guides: [{ id: "center", kind: "slide-center", axis: "y", positionDU: 540 }],
  };
  controller.previewInteraction(preview);
  const mutation = controller.commitInteraction("Move selected elements", "user", "hash_before");
  assert.equal(mutation.operations.length, 2);
  assert.equal(mutation.expectedDeckHash, "hash_before");
  assert.deepEqual(mutation.operations.map((operation) => operation.op), ["updateGeometry", "updateGeometry"]);
  assert.equal(controller.getState().interactionPreview, null);
});

test("interaction preview cannot silently cross the active slide boundary", () => {
  const controller = new EditorEngineController();
  controller.setSelection({ slideId: "slide_1", elementIds: ["a"], mode: "element" });
  assert.throws(() => controller.previewInteraction({
    sessionId: "bad",
    slideId: "slide_2",
    elementIds: ["a"],
    geometryByElementId: { a: { x: 10 } },
    guides: [],
  }), /cannot cross/);
});

test("geometryCommit emits standard Pitch mutations usable by Codex and manual editing", () => {
  const mutation = geometryCommit(
    "slide_1",
    { a: { x: 10, y: 20, rotation: 15 } },
    "Rotate and move",
    "codex",
    "hash",
  );
  assert.equal(mutation.origin, "codex");
  assert.equal(mutation.operations[0].op, "updateGeometry");
  assert.equal(mutation.expectedDeckHash, "hash");
});
