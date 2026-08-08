import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { mergeDecks } from "../packages/deck-merge/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Merge", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [
      { id: "s1", order: 0, title: "Decision", archetype: "freeform", semantic: { purpose: "ask", takeaway: "Approve", questionAnswered: "what now?", narrativeRole: "decision", claimIds: [], evidenceRefs: [], audienceRelevance: "board", density: "sparse" }, scene: [
        { id: "title", type: "text", semanticRole: "title", geometry: { x: 100, y: 80, width: 1000, height: 120 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Approve", fontSizePt: 40 }] }] },
        { id: "shape", type: "shape", semanticRole: "visual", geometry: { x: 100, y: 300, width: 400, height: 220 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#335CFF" }
      ], status: "ready", qaIssueIds: [], dependencyIds: [] },
      { id: "s2", order: 1, title: "Evidence", archetype: "freeform", semantic: { purpose: "prove", takeaway: "It works", questionAnswered: "proof?", narrativeRole: "evidence", claimIds: [], evidenceRefs: [], audienceRelevance: "board", density: "balanced" }, scene: [], status: "ready", qaIssueIds: [], dependencyIds: [] }
    ]
  };
}

test("independent changes to semantic field and different scene element merge automatically", () => {
  const base = fixture();
  const ours = structuredClone(base);
  const theirs = structuredClone(base);
  ours.slides[0].semantic.takeaway = "Approve with conditions";
  const theirsShape = theirs.slides[0].scene.find(element => element.id === "shape") as any;
  theirsShape.fill = "#14B8A6";

  const result = mergeDecks(base, ours, theirs);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.deck.slides[0].semantic.takeaway, "Approve with conditions");
  assert.equal((result.deck.slides[0].scene.find(element => element.id === "shape") as any).fill, "#14B8A6");
  assert(result.applied.some(entry => entry.scope === "element" && entry.elementId === "shape"));
});

test("different changes to the same element create explicit conflict and keep ours until resolved", () => {
  const base = fixture();
  const ours = structuredClone(base);
  const theirs = structuredClone(base);
  (ours.slides[0].scene.find(element => element.id === "shape") as any).fill = "#FF0000";
  (theirs.slides[0].scene.find(element => element.id === "shape") as any).fill = "#00FF00";
  const result = mergeDecks(base, ours, theirs);
  const conflict = result.conflicts.find(item => item.scope === "element" && item.elementId === "shape");
  assert(conflict);
  assert.equal((result.deck.slides[0].scene.find(element => element.id === "shape") as any).fill, "#FF0000");
});

test("one branch can add a slide while the other branch changes another slide", () => {
  const base = fixture();
  const ours = structuredClone(base);
  const theirs = structuredClone(base);
  ours.slides[0].title = "Main decision";
  theirs.slides.push({ id: "s3", order: 2, title: "Appendix", archetype: "freeform", semantic: { purpose: "appendix", takeaway: "", questionAnswered: "", narrativeRole: "appendix", claimIds: [], evidenceRefs: [], audienceRelevance: "reader", density: "dense" }, scene: [], status: "draft", qaIssueIds: [], dependencyIds: [] });
  const result = mergeDecks(base, ours, theirs);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.deck.slides.find(slide => slide.id === "s1")?.title, "Main decision");
  assert(result.deck.slides.some(slide => slide.id === "s3"));
  assert(result.applied.some(entry => entry.scope === "slide" && entry.slideId === "s3"));
});

test("removal versus modification is a conflict rather than silent data loss", () => {
  const base = fixture();
  const ours = structuredClone(base);
  const theirs = structuredClone(base);
  ours.slides[0].scene = ours.slides[0].scene.filter(element => element.id !== "shape");
  (theirs.slides[0].scene.find(element => element.id === "shape") as any).geometry.x = 240;
  const result = mergeDecks(base, ours, theirs);
  assert(result.conflicts.some(item => item.scope === "element" && item.elementId === "shape" && item.message.includes("removed")));
  assert.equal(result.deck.slides[0].scene.some(element => element.id === "shape"), false, "ours is preserved until conflict resolution");
});

test("same change in both branches is accepted without conflict", () => {
  const base = fixture();
  const ours = structuredClone(base);
  const theirs = structuredClone(base);
  ours.slides[0].semantic.audienceRelevance = "CFO";
  theirs.slides[0].semantic.audienceRelevance = "CFO";
  const result = mergeDecks(base, ours, theirs);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.deck.slides[0].semantic.audienceRelevance, "CFO");
});

test("different slide moves on both branches produce order conflict", () => {
  const base = fixture();
  const ours = structuredClone(base);
  const theirs = structuredClone(base);
  ours.slides[0].order = 1; ours.slides[1].order = 0;
  theirs.slides[0].order = 2;
  const result = mergeDecks(base, ours, theirs);
  assert(result.conflicts.some(item => item.scope === "order" && item.slideId === "s1"));
  assert.deepEqual(result.deck.slides.map(slide => slide.order), [0, 1]);
});
