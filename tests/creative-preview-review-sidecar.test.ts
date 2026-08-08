import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { ReviewWorkspaceRuntime } from "../apps/review/src/runtime.js";
import { acceptCreativePreview, reviewCreativePreview } from "../apps/creative-director/src/branch-review.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-preview-review-sidecar-"));
  const store = new ArtifactStore(root); await store.init("Preview review sidecar", "preview_review_sidecar");
  const deck: DeckDocument = { schemaVersion: "0.1", id: "deck_sidecar", title: "Sidecar", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" }, briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z", slides: [{ id: "s1", order: 0, title: "Sidecar", archetype: "freeform", semantic: { purpose: "test", takeaway: "Keep", questionAnswered: "What?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [], status: "draft", qaIssueIds: [], dependencyIds: [] }] };
  await store.write({ id: "deck", kind: "deck", payload: deck, producer: { type: "deterministic" } });
  return { root, service: new PitchWorkspaceService(root), review: new ReviewWorkspaceRuntime(root), async close() { await rm(root, { recursive: true, force: true }); } };
}

const user = { kind: "user" as const, id: "reviewer", displayName: "Reviewer" };

test("Creative preview review sidecar accepts into target with its own undo history", async () => {
  const h = await setup();
  try {
    const original = await h.service.state(); const targetBranchId = original.manifest.activeBranchId;
    const forked = await h.service.fork("Review Preview"); const previewBranchId = forked.manifest.activeBranchId;
    const previewReview = await h.review.state();
    await h.review.command({ command: "addThread", threadId: "preview_thread", anchor: { scope: "slide", slideId: "s1" }, type: "comment", priority: "normal", body: "Preview-only review note", author: user, expectedDeckHash: previewReview.deckHash });

    const beforeAccept = await reviewCreativePreview(h.service, previewBranchId);
    assert.equal(beforeAccept.changedArtifactKinds.includes("review"), true);
    assert.equal(beforeAccept.mergeable, true, beforeAccept.blockers.join("; "));
    await acceptCreativePreview(h.service, { previewBranchId, expectedTargetDeckHash: beforeAccept.targetDeckHash, expectedPreviewDeckHash: beforeAccept.previewDeckHash });
    assert.equal((await h.service.state()).manifest.activeBranchId, targetBranchId);
    let targetReview = await h.review.state();
    assert.equal(targetReview.threads.some((thread) => thread.id === "preview_thread"), true);
    assert.equal(targetReview.history.canUndo, true);

    await h.review.undo();
    targetReview = await h.review.state();
    assert.equal(targetReview.threads.length, 0, "review-sidecar accept should be independently undoable from deck state");
  } finally { await h.close(); }
});
