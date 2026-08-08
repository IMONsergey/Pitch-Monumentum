import test from "node:test";
import assert from "node:assert/strict";
import type { SlideDocument } from "../packages/deck-model/src/index.js";
import { autoLayoutMutationOperations, solveAutoLayout, validateAutoLayoutSpec, wrapSelectionInAutoLayoutOperations } from "../packages/auto-layout/src/index.js";
import { applyDeckMutation, createMutation } from "../packages/mutations/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";

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

function unframedFixture(): SlideDocument {
  const slide = fixture();
  return {
    ...slide,
    scene: slide.scene.filter((element) => element.id !== "frame_1").map((element, index) => ({
      ...element,
      groupId: undefined,
      layoutItem: undefined,
      geometry: {
        ...element.geometry,
        x: 100 + index * 180,
        y: 240,
        height: 120,
      },
    })),
  };
}

function deckWith(slide: SlideDocument): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "deck",
    title: "Layout",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b",
    narrativeId: "n",
    designSystemId: "d",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z",
    updatedAt: "2026-08-08T00:00:00Z",
    slides: [slide],
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

test("Shift+A domain command creates a frame and solves child geometry atomically", () => {
  const slide = unframedFixture();
  const selected = ["card_1", "card_2"];
  const built = wrapSelectionInAutoLayoutOperations(slide, selected, { frameId: "frame_new", gapDU: 24, paddingDU: 24 });
  assert.equal(built.frameId, "frame_new");
  assert.equal(built.operations[0].op, "addElement");
  const frameOperation = built.operations[0] as Extract<typeof built.operations[number], { op: "addElement" }>;
  assert.equal(frameOperation.element.type, "frame");
  if (frameOperation.element.type !== "frame") throw new Error("Expected frame element");
  assert.deepEqual(frameOperation.element.childIds, selected);
  assert.equal(frameOperation.element.layout?.gapDU, 24);

  const applied = applyDeckMutation(deckWith(slide), createMutation("wrap", built.operations));
  const nextSlide = applied.deck.slides[0];
  const frame = nextSlide.scene.find((element) => element.id === "frame_new");
  assert(frame && frame.type === "frame");
  if (!frame || frame.type !== "frame") throw new Error("Frame missing after mutation");
  assert.equal(frame.layout?.direction, "horizontal");
  const first = nextSlide.scene.find((element) => element.id === "card_1")!;
  const second = nextSlide.scene.find((element) => element.id === "card_2")!;
  assert(second.geometry.x > first.geometry.x);
  assert.equal(second.geometry.x - (first.geometry.x + first.geometry.width), 24);
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
