import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { emptyReviewDocument, executeReviewCommand } from "../packages/review-engine/src/index.js";
import { createSlideLibraryItem, instantiateSlideLibraryItem } from "../packages/slide-library/src/index.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "library_deck", title: "Library", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: ["claim_1"], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Approved decision", archetype: "decision", semantic: { purpose: "decide", takeaway: "Approve investment", questionAnswered: "What now?", narrativeRole: "decision", claimIds: ["claim_1"], evidenceRefs: ["ev_1"], audienceRelevance: "board", density: "sparse" }, scene: [
      { id: "frame", type: "frame", childIds: ["title", "hero"], fill: "#FFFFFF", semanticRole: "other", geometry: { x: 100, y: 100, width: 1500, height: 800 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], tags: ["component:instance_a", "component-def:component_a", "slide-master:master_a", "slide-master-instance:master_instance_a"] },
      { id: "title", type: "text", groupId: "frame", paragraphs: [{ runs: [{ text: "Approve investment", fontFamily: "Inter", fontSizePt: 42 }] }], semanticRole: "title", geometry: { x: 180, y: 180, width: 900, height: 120 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [{ kind: "claim", id: "claim_1" }], tags: ["slide-master:master_a", "slide-master-source:title", "slide-placeholder:title"] },
      { id: "hero", type: "image", groupId: "frame", assetId: "asset_hero", fit: "cover", semanticRole: "visual", geometry: { x: 180, y: 360, width: 900, height: 450 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset_hero" }], tags: ["component:instance_a", "component-source:hero"] },
    ], status: "ready", qaIssueIds: [], dependencyIds: ["claim_1", "ev_1"] }],
  };
}

function approvedReview(deck: DeckDocument) {
  const empty = emptyReviewDocument(deck);
  return executeReviewCommand(deck, empty, { command: "approveSlide", slideId: "s1", author: { kind: "user", id: "director", displayName: "Creative Director" }, note: "Approved for reuse" }).document;
}

test("library publication requires current approval by default", () => {
  const source = deck();
  assert.throws(() => createSlideLibraryItem(source, emptyReviewDocument(source), "s1"), /must have a current human approval/);
  const item = createSlideLibraryItem(source, approvedReview(source), "s1", { tags: ["Board", "Decision"] });
  assert.equal(item.source.slideId, "s1");
  assert.equal(item.source.approvedBy?.displayName, "Creative Director");
  assert.equal(item.source.activeBranchId, "branch_main");
  assert.deepEqual(item.assetIds, ["asset_hero"]);
  assert.deepEqual(item.fontFamilies, ["Inter"]);
  assert.deepEqual(item.claimIds, ["claim_1"]);
  assert.deepEqual(item.evidenceRefs, ["ev_1"]);
  assert(item.componentIds.includes("component_a"));
  assert(item.masterIds.includes("master_a"));
});

test("stale slide approval stops later publication", () => {
  const source = deck();
  const review = approvedReview(source);
  const changed = structuredClone(source);
  (changed.slides[0].scene.find((element) => element.id === "title") as any).paragraphs[0].runs[0].text = "Changed after approval";
  assert.throws(() => createSlideLibraryItem(changed, review, "s1"), /must have a current human approval/);
});

test("detached reuse remaps every identity and removes master/component links without losing content/assets", () => {
  const source = deck();
  const item = createSlideLibraryItem(source, approvedReview(source), "s1");
  const result = instantiateSlideLibraryItem(source, item, { toIndex: 0 });
  assert.notEqual(result.slideId, "s1");
  assert.equal(result.deck.slides[0].id, result.slideId);
  assert.equal(result.deck.slides[1].id, "s1");
  assert.deepEqual(result.deck.slides.map((slide) => slide.order), [0, 1]);
  const inserted = result.deck.slides[0];
  assert.equal(inserted.status, "draft");
  assert.equal(inserted.scene.some((element) => element.id === "frame" || element.id === "title" || element.id === "hero"), false);
  const remappedFrame = inserted.scene.find((element) => element.id === result.elementIdMap.frame) as any;
  const remappedTitle = inserted.scene.find((element) => element.id === result.elementIdMap.title) as any;
  const remappedHero = inserted.scene.find((element) => element.id === result.elementIdMap.hero) as any;
  assert.deepEqual(remappedFrame.childIds, [result.elementIdMap.title, result.elementIdMap.hero]);
  assert.equal(remappedTitle.groupId, result.elementIdMap.frame);
  assert.equal(remappedHero.groupId, result.elementIdMap.frame);
  assert.equal(remappedTitle.paragraphs[0].runs[0].text, "Approve investment");
  assert.equal(remappedHero.assetId, "asset_hero");
  assert(inserted.scene.every((element) => !(element.tags ?? []).some((tag) => tag.startsWith("component:") || tag.startsWith("component-def:") || tag.startsWith("component-source:") || tag.startsWith("slide-master:") || tag.startsWith("slide-placeholder:"))));
  assert(result.detachedSystemTags > 0);
});

test("preserveSystems is explicit and still remaps hierarchy identities", () => {
  const source = deck();
  const item = createSlideLibraryItem(source, approvedReview(source), "s1");
  const result = instantiateSlideLibraryItem(source, item, { reuseMode: "preserveSystems" });
  const inserted = result.deck.slides.find((slide) => slide.id === result.slideId)!;
  assert(inserted.scene.some((element) => (element.tags ?? []).includes("slide-master:master_a")));
  assert(inserted.scene.some((element) => (element.tags ?? []).includes("component:instance_a")));
  assert.equal(result.detachedSystemTags, 0);
  const frame = inserted.scene.find((element) => element.id === result.elementIdMap.frame) as any;
  assert.deepEqual(frame.childIds, [result.elementIdMap.title, result.elementIdMap.hero]);
});
