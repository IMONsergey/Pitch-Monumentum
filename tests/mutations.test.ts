import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { applyDeckMutation, createMutation, deckHash } from "../packages/mutations/src/index.js";

function fixture(): DeckDocument {
  const now = "2026-08-07T00:00:00Z";
  return {
    schemaVersion: "0.1",
    id: "deck",
    title: "Fixture",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief",
    narrativeId: "narrative",
    designSystemId: "design",
    sourceIds: ["source"],
    claimIds: ["claim"],
    activeBranchId: "branch_main",
    createdAt: now,
    updatedAt: now,
    slides: [
      {
        id: "s1", order: 0, title: "One", archetype: "thesis",
        semantic: { purpose: "p", takeaway: "t", questionAnswered: "q", narrativeRole: "claim", claimIds: ["claim"], evidenceRefs: ["e1"], audienceRelevance: "a", density: "sparse" },
        scene: [
          { id: "t1", type: "text", semanticRole: "title", geometry: { x: 100, y: 100, width: 800, height: 120 }, zIndex: 1, origin: "agent", exportStrategy: "native", dependencies: [{ kind: "claim", id: "claim" }], paragraphs: [{ runs: [{ text: "Before", fontSizePt: 40 }] }] },
          { id: "shape1", type: "shape", semanticRole: "visual", geometry: { x: 100, y: 400, width: 300, height: 200 }, zIndex: 2, origin: "agent", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#fff" },
        ],
        status: "ready", qaIssueIds: [], dependencyIds: ["claim"],
      },
      {
        id: "s2", order: 1, title: "Two", archetype: "closing",
        semantic: { purpose: "p2", takeaway: "t2", questionAnswered: "q2", narrativeRole: "close", claimIds: [], evidenceRefs: [], audienceRelevance: "a", density: "sparse" },
        scene: [{ id: "t2", type: "text", semanticRole: "title", geometry: { x: 100, y: 100, width: 800, height: 120 }, zIndex: 1, origin: "agent", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Untouched" }] }] }],
        status: "ready", qaIssueIds: [], dependencyIds: [],
      },
    ],
  };
}

test("local text mutation changes only the targeted slide/element scope", () => {
  const original = fixture();
  const untouchedSlide = original.slides[1];
  const untouchedShape = original.slides[0].scene[1];
  const mutation = createMutation("rewrite selected title", [{ op: "replaceText", slideId: "s1", elementId: "t1", paragraphs: [{ runs: [{ text: "After", fontSizePt: 40 }] }] }], "codex", deckHash(original));
  const result = applyDeckMutation(original, mutation);
  assert.equal((result.deck.slides[0].scene[0] as any).paragraphs[0].runs[0].text, "After");
  assert.equal((original.slides[0].scene[0] as any).paragraphs[0].runs[0].text, "Before");
  assert.equal(result.deck.slides[1], untouchedSlide);
  assert.equal(result.deck.slides[0].scene[1], untouchedShape);
  assert.deepEqual(result.impact.affectedSlideIds, ["s1"]);
  assert.deepEqual(result.impact.affectedElementIds, ["t1"]);
  assert.equal(result.impact.evidenceRisk, true);
  assert.ok(result.impact.staleArtifacts.includes("qa:evidence"));
  assert.ok(result.impact.staleArtifacts.includes("export"));
});

test("stale optimistic mutation is rejected", () => {
  const original = fixture();
  const mutation = createMutation("move selected box", [{ op: "updateGeometry", slideId: "s1", elementId: "shape1", geometry: { x: 200 } }], "user", "wrong-hash");
  assert.throws(() => applyDeckMutation(original, mutation), /Deck changed since mutation was authored/);
});

test("slide reorder preserves slide objects where order is already correct and marks narrative stale", () => {
  const original = fixture();
  const result = applyDeckMutation(original, createMutation("put close first", [{ op: "moveSlide", slideId: "s2", toIndex: 0 }]));
  assert.deepEqual(result.deck.slides.map((slide) => slide.id), ["s2", "s1"]);
  assert.deepEqual(result.deck.slides.map((slide) => slide.order), [0, 1]);
  assert.equal(result.impact.slideOrderChanged, true);
  assert.ok(result.impact.staleArtifacts.includes("storyboard"));
  assert.ok(result.impact.staleArtifacts.includes("qa:narrative"));
});
