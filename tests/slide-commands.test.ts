import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { duplicateSlideDocument, executeSlideCommand } from "../packages/slide-commands/src/index.js";
import { validateSceneHierarchy } from "../packages/mutations/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "deck_slides",
    title: "Slides",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief",
    narrativeId: "narrative",
    designSystemId: "design",
    sourceIds: ["source"],
    claimIds: ["claim"],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z",
    updatedAt: "2026-08-08T00:00:00Z",
    slides: [
      {
        id: "s1",
        order: 0,
        title: "Original",
        archetype: "evidence",
        semantic: { purpose: "prove", takeaway: "claim", questionAnswered: "why", narrativeRole: "evidence", claimIds: ["claim"], evidenceRefs: ["e1"], audienceRelevance: "board", density: "balanced" },
        scene: [
          { id: "frame", type: "frame", semanticRole: "visual", geometry: { x: 100, y: 100, width: 600, height: 300 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], childIds: ["text"] },
          { id: "text", type: "text", semanticRole: "body", geometry: { x: 140, y: 140, width: 500, height: 120 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [{ kind: "claim", id: "claim" }, { kind: "evidence", id: "e1" }], groupId: "frame", paragraphs: [{ runs: [{ text: "Evidence", fontSizePt: 24 }] }] },
        ],
        status: "ready",
        qaIssueIds: ["old_issue"],
        dependencyIds: ["claim", "e1"],
      },
      {
        id: "s2",
        order: 1,
        title: "Second",
        archetype: "freeform",
        semantic: { purpose: "next", takeaway: "", questionAnswered: "", narrativeRole: "working", claimIds: [], evidenceRefs: [], audienceRelevance: "", density: "balanced" },
        scene: [], status: "draft", qaIssueIds: [], dependencyIds: [],
      },
    ],
  };
}

test("duplicate slide deep-remaps scene hierarchy but preserves evidence dependencies", () => {
  const source = fixture().slides[0];
  const duplicate = duplicateSlideDocument(source);
  assert.notEqual(duplicate.id, source.id);
  assert.equal(duplicate.status, "draft");
  assert.deepEqual(duplicate.qaIssueIds, []);
  assert.deepEqual(duplicate.semantic.claimIds, source.semantic.claimIds);
  assert.deepEqual(duplicate.semantic.evidenceRefs, source.semantic.evidenceRefs);
  assert.deepEqual(duplicate.dependencyIds, source.dependencyIds);
  const sourceIds = new Set(source.scene.map(element => element.id));
  assert(duplicate.scene.every(element => !sourceIds.has(element.id)));
  const frame = duplicate.scene.find(element => element.type === "frame") as any;
  const text = duplicate.scene.find(element => element.type === "text") as any;
  assert(frame && text);
  assert.deepEqual(frame.childIds, [text.id]);
  assert.equal(text.groupId, frame.id);
  assert.deepEqual(text.dependencies, source.scene[1].dependencies);
  validateSceneHierarchy(duplicate.scene);
});

test("new, duplicate, move, rename and delete keep contiguous slide order", () => {
  let deck = fixture();
  const created = executeSlideCommand(deck, { command: "newSlide", afterSlideId: "s1", title: "Inserted" });
  deck = created.deck;
  assert.equal(deck.slides.length, 3);
  assert.equal(deck.slides[1].id, created.nextSlideId);
  assert.deepEqual(deck.slides.map(slide => slide.order), [0, 1, 2]);

  const duplicated = executeSlideCommand(deck, { command: "duplicateSlide", slideId: "s1" });
  deck = duplicated.deck;
  assert.equal(deck.slides[1].id, duplicated.nextSlideId);
  assert.equal(deck.slides[1].title, "Original Copy");
  assert.deepEqual(deck.slides.map(slide => slide.order), [0, 1, 2, 3]);

  deck = executeSlideCommand(deck, { command: "moveSlide", slideId: duplicated.nextSlideId, toIndex: 3 }).deck;
  assert.equal(deck.slides[3].id, duplicated.nextSlideId);
  assert.deepEqual(deck.slides.map(slide => slide.order), [0, 1, 2, 3]);

  deck = executeSlideCommand(deck, { command: "renameSlide", slideId: duplicated.nextSlideId, title: "CFO appendix" }).deck;
  assert.equal(deck.slides.find(slide => slide.id === duplicated.nextSlideId)?.title, "CFO appendix");

  const deleted = executeSlideCommand(deck, { command: "deleteSlide", slideId: duplicated.nextSlideId });
  deck = deleted.deck;
  assert.equal(deck.slides.some(slide => slide.id === duplicated.nextSlideId), false);
  assert.deepEqual(deck.slides.map(slide => slide.order), [0, 1, 2]);
});

test("delete refuses to remove the final slide", () => {
  const deck = fixture();
  deck.slides = [deck.slides[0]];
  assert.throws(() => executeSlideCommand(deck, { command: "deleteSlide", slideId: "s1" }), /at least one slide/);
});

test("invalid move and empty rename fail closed", () => {
  const deck = fixture();
  assert.throws(() => executeSlideCommand(deck, { command: "moveSlide", slideId: "s1", toIndex: 9 }), /Invalid slide destination/);
  assert.throws(() => executeSlideCommand(deck, { command: "renameSlide", slideId: "s1", title: "   " }), /cannot be empty/);
});
