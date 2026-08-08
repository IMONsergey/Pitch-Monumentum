import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { ReviewWorkspaceRuntime } from "../apps/review/src/runtime.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-review-runtime-"));
  const store = new ArtifactStore(root);
  await store.init("Review runtime", "review_runtime_project");
  const deck: DeckDocument = {
    schemaVersion: "0.1", id: "deck_review_runtime", title: "Review runtime", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{ id: "s1", order: 0, title: "Review", archetype: "freeform", semantic: { purpose: "test", takeaway: "Keep", questionAnswered: "What?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [{ id: "shape", type: "shape", shape: "rect", fill: "#445566", semanticRole: "visual", geometry: { x: 100, y: 100, width: 500, height: 300 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] }], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
  await store.write({ id: "deck", kind: "deck", payload: deck, producer: { type: "deterministic" } });
  return { root, review: new ReviewWorkspaceRuntime(root), async close() { await rm(root, { recursive: true, force: true }); } };
}

const author = { kind: "user" as const, id: "sergey", displayName: "Sergey" };

test("review command writes independent review history and review undo does not undo deck geometry", async () => {
  const h = await setup();
  try {
    const before = await h.review.state();
    const added = await h.review.command({ command: "addThread", threadId: "thread_1", anchor: { scope: "element", slideId: "s1", elementId: "shape" }, body: "Review this shape", author, expectedDeckHash: before.deckHash });
    assert.equal(added.threads.length, 1);
    assert.equal(added.history.canUndo, true);
    const deckBeforeEdit = await h.review.service.state();
    await h.review.service.editorCommand({ command: "nudge", slideId: "s1", selectedIds: ["shape"], dx: 50, dy: 0, expectedDeckHash: deckBeforeEdit.deckHash });
    let state = await h.review.service.state();
    assert.equal((state.deck.slides[0].scene[0] as any).geometry.x, 150);
    const undoneReview = await h.review.undo();
    assert.equal(undoneReview.threads.length, 0);
    state = await h.review.service.state();
    assert.equal((state.deck.slides[0].scene[0] as any).geometry.x, 150, "review undo must not undo deck history");
    assert.equal(state.history.canUndo, true);
  } finally { await h.close(); }
});

test("fork inherits review context and subsequent review replies diverge by branch", async () => {
  const h = await setup();
  try {
    const initial = await h.review.state();
    await h.review.command({ command: "addThread", threadId: "thread_shared", anchor: { scope: "slide", slideId: "s1" }, body: "Shared before fork", author, expectedDeckHash: initial.deckHash });
    const main = await h.review.service.state();
    const mainBranchId = main.manifest.activeBranchId;
    const forked = await h.review.service.fork("Review experiment");
    const forkBranchId = forked.manifest.activeBranchId;
    let forkReview = await h.review.state();
    assert.equal(forkReview.threads[0].messages.length, 1);
    await h.review.command({ command: "reply", threadId: "thread_shared", body: "Only on fork", author, expectedDeckHash: forkReview.deckHash, expectedReviewHash: forkReview.reviewHash });
    forkReview = await h.review.state();
    assert.equal(forkReview.threads[0].messages.length, 2);

    await h.review.service.checkout(mainBranchId);
    const mainReview = await h.review.state();
    assert.equal(mainReview.threads[0].messages.length, 1);
    assert.notEqual(mainBranchId, forkBranchId);
  } finally { await h.close(); }
});

test("approval becomes stale after deck edit without mutating review artifact", async () => {
  const h = await setup();
  try {
    let state = await h.review.state();
    await h.review.command({ command: "approveSlide", slideId: "s1", author, expectedDeckHash: state.deckHash });
    state = await h.review.state();
    const reviewVersion = state.reviewVersion;
    assert.equal(state.approvals[0].state, "current");
    const deckState = await h.review.service.state();
    await h.review.service.editorCommand({ command: "nudge", slideId: "s1", selectedIds: ["shape"], dx: 3, dy: 0, expectedDeckHash: deckState.deckHash });
    const stale = await h.review.state();
    assert.equal(stale.approvals[0].state, "stale");
    assert.equal(stale.reviewVersion, reviewVersion, "stale state is derived from deck fingerprint, not by mutating approval history");
  } finally { await h.close(); }
});
