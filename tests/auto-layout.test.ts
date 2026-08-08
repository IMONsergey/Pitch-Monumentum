import test from "node:test";
import assert from "node:assert/strict";
import type { SlideDocument } from "../packages/deck-model/src/index.js";
import { autoLayoutMutationOperations, solveAutoLayout, validateAutoLayoutSpec } from "../packages/auto-layout/src/index.js";

function fixture(): SlideDocument {
  return {
    id: "slide_1",
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
        id: "frame_1",
        type: "frame",
        semanticRole: "visual",
        geometry: { x: 100, y: 200, width: 700, height: 220 },
        zIndex: 1,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        childIds: ["card_1", "card_2", "card_3"],
        layout: {
          direction: "horizontal",
          gapDU: 20,
          padding: { top: 10, right: 20, bottom: 10, left: 20 },
          justify: "start",
          align: "stretch",
          widthSizing: "fixed",
          heightSizing: "fixed",
        },
      },
      {
        id: "card_1",
        type: "shape",
        semanticRole: "visual",
        geometry: { x: 0, y: 0, width: 120, height: 100 },
        zIndex: 2,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        shape: "roundRect",
        fill: "#ffffff",
        groupId: "frame_1",
        layoutItem: { width: "fixed", height: "fill" },
      },
      {
        id: "card_2",
        type: "shape",
        semanticRole: "visual",
        geometry: { x: 0, y: 0, width: 160, height: 100 },
        zIndex: 3,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        shape: "roundRect",
        fill: "#ffffff",
        groupId: "frame_1",
        layoutItem: { width: "fill", height: "fill", grow: 1 },
      },
      {
        id: "card_3",
        type: "shape",
        semanticRole: "visual",
        geometry: { x: 0, y: 0, width: 100, height: 100 },
        zIndex: 4,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        shape: "roundRect",
        fill: "#ffffff",
        groupId: "frame_1",
        layoutItem: { width: "fixed", height: "fill" },
      },
    ],
    status: "draft",
    qaIssueIds: [],
    dependencyIds: [],
  };
}

test("horizontal auto layout honors padding, gap and fill sizing", () => {
  const result = solveAutoLayout(fixture(), "frame_1");
  assert.deepEqual(result.containerGeometry, { x: 100, y: 200, width: 700, height: 220 });
  assert.equal(result.children.length, 3);

  const [first, second, third] = result.children;
  assert.deepEqual(first.geometry, { x: 120, y: 210, width: 120, height: 200 });
  assert.equal(second.geometry.x, 260);
  assert.equal(second.geometry.y, 210);
  assert.equal(second.geometry.height, 200);
  assert.equal(third.geometry.y, 210);
  assert.equal(third.geometry.width, 100);
  assert.equal(third.geometry.height, 200);
  assert.equal(third.geometry.x + third.geometry.width, 780);
});

test("auto layout produces ordinary geometry DeckMutation operations", () => {
  const slide = fixture();
  const operations = autoLayoutMutationOperations(slide, "frame_1");
  assert.equal(operations.length, 4);
  assert(operations.every((operation) => operation.op === "updateGeometry"));
  assert.deepEqual(operations.map((operation) => "elementId" in operation ? operation.elementId : null), ["frame_1", "card_1", "card_2", "card_3"]);
});

test("invalid layout spec fails before touching geometry", () => {
  const errors = validateAutoLayoutSpec({
    direction: "horizontal",
    gapDU: -1,
    padding: { top: 0, right: -2, bottom: 0, left: 0 },
    justify: "start",
    align: "start",
  });
  assert.equal(errors.length, 2);
});
