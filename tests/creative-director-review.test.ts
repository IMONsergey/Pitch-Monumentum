import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { buildCreativeDirectorPlan, reviewCreativeQuality } from "../packages/creative-director/src/index.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck_review", title: "Review",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{ id: "s1", order: 0, title: "Evidence", archetype: "evidence", semantic: { purpose: "test", takeaway: "Evidence matters", questionAnswered: "Why?", narrativeRole: "evidence", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

test("evidence QA contributes its own weighted production lane and plan acceptance gate", () => {
  const input: any = {
    deck: deck(),
    deterministicQA: [{ id: "e1", category: "evidence", severity: "critical", scope: { deckId: "deck_review", slideId: "s1" }, message: "Claim has no verified evidence", autoFixSafe: false, status: "open" }],
    brandQA: [], brandCoverage: { eligibleBindings: 0, boundBindings: 0, coverage: 1, byTarget: {} },
    assets: { total: 0, missingBytes: 0, unused: 0 }, motion: { slidesWithMotion: 0, staleReferences: 0 },
  };
  const review = reviewCreativeQuality(input);
  const evidence = review.lanes.find((lane) => lane.lane === "evidence");
  assert(evidence);
  assert.equal(evidence.blockers, 1);
  assert(evidence.score < 100);
  assert.equal(review.ready, false);

  const plan = buildCreativeDirectorPlan({ id: "req", instruction: "Polish this without changing facts", intent: ["polish"], scope: { kind: "slide", slideIds: ["s1"] } }, input);
  assert(plan.acceptanceCriteria.includes("No new critical evidence QA issues"));
});
