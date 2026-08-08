import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { emptyReviewDocument, executeReviewCommand } from "../packages/review-engine/src/index.js";
import { reviewDeliveryGate } from "../packages/review-engine/src/delivery.js";
import { ReviewWorkspaceRuntime } from "../apps/review/src/runtime.js";

function deck(): DeckDocument {
  return { schemaVersion: "0.1", id: "deck_governance", title: "Governance", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" }, briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z", slides: [{ id: "s1", order: 0, title: "Governance", archetype: "freeform", semantic: { purpose: "test", takeaway: "Review", questionAnswered: "What?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [], status: "draft", qaIssueIds: [], dependencyIds: [] }] };
}
const user = { kind: "user" as const, id: "reviewer", displayName: "Reviewer" };
const codex = { kind: "codex" as const, id: "codex", displayName: "Codex" };

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-review-governance-"));
  const store = new ArtifactStore(root); await store.init("Governance", "governance_project"); await store.write({ id: "deck", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
  return { root, review: new ReviewWorkspaceRuntime(root), async close() { await rm(root, { recursive: true, force: true }); } };
}

test("Codex can reply but cannot resolve/reopen/approve/revoke human review authority", async () => {
  const h = await setup();
  try {
    let state = await h.review.state();
    await h.review.command({ command: "addThread", threadId: "thread", anchor: { scope: "slide", slideId: "s1" }, type: "changeRequest", priority: "blocking", body: "Human review", author: user, expectedDeckHash: state.deckHash });
    state = await h.review.state();
    await h.review.command({ command: "reply", threadId: "thread", body: "Codex reply", author: codex, expectedDeckHash: state.deckHash, expectedReviewHash: state.reviewHash });
    state = await h.review.state();
    await assert.rejects(() => h.review.command({ command: "resolve", threadId: "thread", author: codex, expectedDeckHash: state.deckHash, expectedReviewHash: state.reviewHash }), /requires a human review author/);
    await assert.rejects(() => h.review.command({ command: "approveDeck", author: codex, expectedDeckHash: state.deckHash, expectedReviewHash: state.reviewHash }), /requires a human review author/);
    await h.review.command({ command: "resolve", threadId: "thread", author: user, expectedDeckHash: state.deckHash, expectedReviewHash: state.reviewHash });
    state = await h.review.state();
    await h.review.command({ command: "approveDeck", author: user, expectedDeckHash: state.deckHash, expectedReviewHash: state.reviewHash });
    state = await h.review.state();
    const approvalId = state.approvals[0].id;
    await assert.rejects(() => h.review.command({ command: "revokeApproval", approvalId, author: codex } as any), /requires a human review author/);
  } finally { await h.close(); }
});

test("delivery gate supports explicit approval policy and stale commitment blocking", () => {
  const d = deck(); let doc = emptyReviewDocument(d);
  let gate = reviewDeliveryGate(d, doc, { requireDeckApproval: true, requireSlideApprovalIds: ["s1"] });
  assert.equal(gate.ready, false);
  assert(gate.issues.some((issue) => issue.code === "deck-approval-missing"));
  assert(gate.issues.some((issue) => issue.code === "slide-approval-missing"));
  doc = executeReviewCommand(d, doc, { command: "approveSlide", slideId: "s1", author: user }).document;
  doc = executeReviewCommand(d, doc, { command: "approveDeck", author: user }).document;
  gate = reviewDeliveryGate(d, doc, { requireDeckApproval: true, requireSlideApprovalIds: ["s1"] });
  assert.equal(gate.ready, true);
  const changed = structuredClone(d); changed.slides[0].title = "Changed";
  gate = reviewDeliveryGate(changed, doc);
  assert.equal(gate.ready, false);
  assert(gate.issues.some((issue) => issue.code === "deck-approval-stale"));
  assert(gate.issues.some((issue) => issue.code === "slide-approval-stale"));
});
