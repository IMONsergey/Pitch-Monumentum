import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { executeEditorCommand } from "../packages/editor-commands/src/service.js";
import { applyDeckMutation, createMutation } from "../packages/mutations/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "deck",
    title: "Commands",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief",
    narrativeId: "narrative",
    designSystemId: "design",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z",
    updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1",
      order: 0,
      title: "Auto layout",
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
      scene: [
        {
          id: "frame",
          type: "frame",
          semanticRole: "visual",
          geometry: { x: 100, y: 100, width: 500, height: 180 },
          zIndex: 1,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          childIds: ["a", "b"],
          layout: {
            direction: "horizontal",
            gapDU: 20,
            padding: { top: 20, right: 20, bottom: 20, left: 20 },
            justify: "start",
            align: "start",
            widthSizing: "fixed",
            heightSizing: "fixed",
          },
        },
        {
          id: "a",
          type: "shape",
          semanticRole: "visual",
          geometry: { x: 120, y: 120, width: 100, height: 80 },
          zIndex: 2,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          shape: "rect",
          fill: "#ccc",
          layoutItem: { width: "fixed", height: "fixed" },
        },
        {
          id: "b",
          type: "shape",
          semanticRole: "visual",
          geometry: { x: 240, y: 120, width: 100, height: 80 },
          zIndex: 3,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          shape: "rect",
          fill: "#ccc",
          layoutItem: { width: "fixed", height: "fixed" },
        },
      ],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

test("delete inside Auto Layout returns one mutation batch including Yoga reflow", () => {
  const deck = fixture();
  const executed = executeEditorCommand(deck, { command: "delete", slideId: "s1", selectedIds: ["a"] });
  assert.deepEqual(executed.reflowedContainerIds, ["frame"]);
  assert(executed.operations.some((operation) => operation.op === "removeElement" && operation.elementId === "a"));
  assert(executed.operations.some((operation) => operation.op === "updateGeometry" && operation.elementId === "b"));

  const next = applyDeckMutation(deck, createMutation(executed.reason, executed.operations)).deck;
  const slide = next.slides[0];
  const frame = slide.scene.find((element) => element.id === "frame");
  assert(frame && frame.type === "frame");
  if (!frame || frame.type !== "frame") throw new Error("Frame missing");
  assert.deepEqual(frame.childIds, ["b"]);
  const b = slide.scene.find((element) => element.id === "b")!;
  assert.equal(b.geometry.x, 120);
  assert.equal(b.geometry.y, 120);
});

test("insert command uses the same canonical addElement operation and selects the new object", () => {
  const deck = fixture();
  const executed = executeEditorCommand(deck, {
    command: "insertText",
    slideId: "s1",
    geometry: { x: 700, y: 100, width: 500, height: 100 },
    text: "Decision",
  });
  assert.equal(executed.operations.length, 1);
  assert.equal(executed.operations[0].op, "addElement");
  assert.equal(executed.nextSelectionIds.length, 1);
  const next = applyDeckMutation(deck, createMutation(executed.reason, executed.operations)).deck;
  const inserted = next.slides[0].scene.find((element) => element.id === executed.nextSelectionIds[0]);
  assert(inserted && inserted.type === "text");
});
