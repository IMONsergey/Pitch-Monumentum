import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SceneElement, SlideDocument } from "../packages/deck-model/src/index.js";
import {
  alignSelection,
  arrangeSelection,
  buildLayerTree,
  copySelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  nudgeSelection,
  pasteClipboard,
  ungroupSelection,
} from "../packages/editor-commands/src/index.js";
import { applyDeckMutation, createMutation, validateSceneHierarchy } from "../packages/mutations/src/index.js";

function slideFixture(): SlideDocument {
  const base = (id: string, x: number, y: number, width: number, height: number, zIndex: number): SceneElement => ({
    id,
    type: "shape",
    name: id,
    semanticRole: "visual",
    geometry: { x, y, width, height },
    zIndex,
    origin: "user",
    exportStrategy: "native",
    dependencies: [],
    shape: "rect",
    fill: "#cccccc",
  });
  return {
    id: "s1",
    order: 0,
    title: "Commands",
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
      base("a", 100, 100, 100, 80, 1),
      base("b", 300, 180, 120, 80, 2),
      base("c", 620, 260, 80, 80, 3),
      {
        id: "frame",
        type: "frame",
        name: "Frame",
        semanticRole: "visual",
        geometry: { x: 900, y: 100, width: 500, height: 300 },
        zIndex: 4,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        childIds: ["d", "e"],
      },
      base("d", 940, 140, 100, 80, 5),
      base("e", 1080, 140, 100, 80, 6),
    ],
    status: "draft",
    qaIssueIds: [],
    dependencyIds: [],
  };
}

function deckWith(slide = slideFixture()): DeckDocument {
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
    slides: [slide],
  };
}

function apply(slide: SlideDocument, operations: any[]): SlideDocument {
  return applyDeckMutation(deckWith(slide), createMutation("editor command", operations)).deck.slides[0];
}

function element(slide: SlideDocument, id: string): SceneElement {
  const result = slide.scene.find((item) => item.id === id);
  if (!result) throw new Error(`Missing ${id}`);
  return result;
}

test("nudge of a frame translates its descendants as one visual block", () => {
  const slide = slideFixture();
  const result = nudgeSelection(slide, ["frame"], 10, -5);
  const next = apply(slide, result.operations);
  assert.deepEqual(element(next, "frame").geometry, { x: 910, y: 95, width: 500, height: 300 });
  assert.deepEqual(element(next, "d").geometry, { x: 950, y: 135, width: 100, height: 80 });
  assert.deepEqual(element(next, "e").geometry, { x: 1090, y: 135, width: 100, height: 80 });
});

test("align and distribute generate deterministic geometry transactions", () => {
  const slide = slideFixture();
  const aligned = apply(slide, alignSelection(slide, ["a", "b", "c"], "top").operations);
  assert.equal(element(aligned, "a").geometry.y, 100);
  assert.equal(element(aligned, "b").geometry.y, 100);
  assert.equal(element(aligned, "c").geometry.y, 100);

  const distributed = apply(slide, distributeSelection(slide, ["a", "b", "c"], "horizontal").operations);
  const a = element(distributed, "a").geometry;
  const b = element(distributed, "b").geometry;
  const c = element(distributed, "c").geometry;
  const gap1 = b.x - (a.x + a.width);
  const gap2 = c.x - (b.x + b.width);
  assert.equal(gap1, gap2);
});

test("grouping siblings inside a frame preserves their parent and ungroup restores sibling order", () => {
  const slide = slideFixture();
  const groupedCommand = groupSelection(slide, ["d", "e"], "group_de");
  let next = apply(slide, groupedCommand.operations);
  const frame = element(next, "frame");
  assert.equal(frame.type, "frame");
  if (frame.type !== "frame") throw new Error("Expected frame");
  assert.deepEqual(frame.childIds, ["group_de"]);
  const group = element(next, "group_de");
  assert.equal(group.type, "group");
  if (group.type !== "group") throw new Error("Expected group");
  assert.deepEqual(group.childIds, ["d", "e"]);
  validateSceneHierarchy(next.scene);

  const ungroupedCommand = ungroupSelection(next, ["group_de"]);
  next = apply(next, ungroupedCommand.operations);
  const restoredFrame = element(next, "frame");
  assert.equal(restoredFrame.type, "frame");
  if (restoredFrame.type !== "frame") throw new Error("Expected frame");
  assert.deepEqual(restoredFrame.childIds, ["d", "e"]);
  assert.equal(next.scene.some((item) => item.id === "group_de"), false);
  validateSceneHierarchy(next.scene);
});

test("duplicate of a container deep-clones descendants and remaps child ids", () => {
  const slide = slideFixture();
  const command = duplicateSelection(slide, ["frame"], 32);
  const next = apply(slide, command.operations);
  assert.equal(command.nextSelectionIds.length, 1);
  const duplicateFrame = element(next, command.nextSelectionIds[0]);
  assert.equal(duplicateFrame.type, "frame");
  if (duplicateFrame.type !== "frame") throw new Error("Expected duplicated frame");
  assert.equal(duplicateFrame.childIds.length, 2);
  assert(!duplicateFrame.childIds.includes("d"));
  assert(!duplicateFrame.childIds.includes("e"));
  for (const childId of duplicateFrame.childIds) assert(next.scene.some((item) => item.id === childId));
  assert.equal(duplicateFrame.geometry.x, 932);
  assert.equal(duplicateFrame.geometry.y, 132);
  validateSceneHierarchy(next.scene);
});

test("delete child automatically cleans parent childIds", () => {
  const slide = slideFixture();
  const command = deleteSelection(slide, ["d"]);
  const next = apply(slide, command.operations);
  assert.equal(next.scene.some((item) => item.id === "d"), false);
  const frame = element(next, "frame");
  assert.equal(frame.type, "frame");
  if (frame.type !== "frame") throw new Error("Expected frame");
  assert.deepEqual(frame.childIds, ["e"]);
  validateSceneHierarchy(next.scene);
});

test("clipboard paste regenerates stable ids and preserves internal hierarchy", () => {
  const slide = slideFixture();
  const clipboard = copySelection(slide, ["frame"]);
  const command = pasteClipboard(slide, clipboard, 40);
  const next = apply(slide, command.operations);
  const pastedFrame = element(next, command.nextSelectionIds[0]);
  assert.equal(pastedFrame.type, "frame");
  if (pastedFrame.type !== "frame") throw new Error("Expected pasted frame");
  assert.deepEqual(pastedFrame.childIds.length, 2);
  assert(pastedFrame.childIds.every((id) => id !== "d" && id !== "e"));
  assert.equal(pastedFrame.geometry.x, 940);
  validateSceneHierarchy(next.scene);
});

test("arrange commands normalize z-order while preserving selection", () => {
  const slide = slideFixture();
  const command = arrangeSelection(slide, ["a"], "bringToFront");
  const next = apply(slide, command.operations);
  const max = Math.max(...next.scene.map((item) => item.zIndex));
  assert.equal(element(next, "a").zIndex, max);
  assert.deepEqual(command.nextSelectionIds, ["a"]);
});

test("layer tree derives nested hierarchy from canonical childIds", () => {
  const tree = buildLayerTree(slideFixture());
  const frame = tree.find((node) => node.id === "frame");
  assert(frame);
  assert.deepEqual(frame.children.map((node) => node.id), ["d", "e"]);
  assert(frame.children.every((node) => node.depth === 1));
});

test("hierarchy validator rejects cycles at transaction boundary", () => {
  const slide = slideFixture();
  const group: SceneElement = {
    id: "g",
    type: "group",
    semanticRole: "visual",
    geometry: { x: 0, y: 0, width: 100, height: 100 },
    zIndex: 20,
    origin: "user",
    exportStrategy: "native",
    dependencies: [],
    childIds: [],
  };
  const withGroup = apply(slide, [{ op: "addElement", slideId: slide.id, element: group }]);
  assert.throws(() => apply(withGroup, [
    { op: "updateContainerChildren", slideId: slide.id, elementId: "g", childIds: ["frame"] },
    { op: "updateContainerChildren", slideId: slide.id, elementId: "frame", childIds: ["d", "e", "g"] },
  ]), /cycle/);
});
