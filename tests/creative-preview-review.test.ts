import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { acceptCreativePreview, reviewCreativePreview } from "../apps/creative-director/src/branch-review.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-preview-review-"));
  const store = new ArtifactStore(root);
  await store.init("Preview review", "preview_project");
  const deck: DeckDocument = {
    schemaVersion: "0.1", id: "deck_preview", title: "Preview",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{ id: "s1", order: 0, title: "Slide", archetype: "freeform", semantic: { purpose: "test", takeaway: "Keep it", questionAnswered: "What?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [{ id: "shape", type: "shape", shape: "rect", fill: "#112233", semanticRole: "visual", geometry: { x: 100, y: 100, width: 400, height: 260 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] }], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
  await store.write({ id: "deck", kind: "deck", payload: deck, producer: { type: "deterministic" } });
  return { root, service: new PitchWorkspaceService(root), async close() { await rm(root, { recursive: true, force: true }); } };
}

test("preview fork records base heads and can be accepted into unchanged parent as one undoable deck version", async () => {
  const h = await setup();
  try {
    const original = await h.service.state();
    const targetBranchId = original.manifest.activeBranchId;
    const forked = await h.service.fork("Creative Preview");
    const previewBranchId = forked.manifest.activeBranchId;
    const manifestAfterFork = await h.service.store.readManifest();
    assert(manifestAfterFork.branches[previewBranchId].baseHeads);
    assert.equal(manifestAfterFork.branches[previewBranchId].parentBranchId, targetBranchId);

    const previewBefore = await h.service.state();
    await h.service.editorCommand({ command: "nudge", slideId: "s1", selectedIds: ["shape"], dx: 80, dy: 0, expectedDeckHash: previewBefore.deckHash });
    const review = await reviewCreativePreview(h.service, previewBranchId);
    assert.equal(review.baseAvailable, true);
    assert.equal(review.targetUnchangedSinceFork, true);
    assert.equal(review.mergeable, true, review.blockers.join("; "));
    assert(review.deckDiff.slideDiffs.some((slide) => slide.elementDiffs.some((diff) => diff.elementId === "shape" && diff.kind === "geometry")));

    const accepted = await acceptCreativePreview(h.service, { previewBranchId, expectedTargetDeckHash: review.targetDeckHash, expectedPreviewDeckHash: review.previewDeckHash });
    assert.equal(accepted.acceptedIntoBranchId, targetBranchId);
    assert.equal(accepted.state.manifest.activeBranchId, targetBranchId);
    const acceptedShape: any = accepted.state.deck.slides[0].scene.find((element: any) => element.id === "shape");
    assert.equal(acceptedShape.geometry.x, 180);
    assert.equal(accepted.state.history.canUndo, true);

    await h.service.undo();
    const restored = await h.service.state();
    assert.equal((restored.deck.slides[0].scene.find((element: any) => element.id === "shape") as any).geometry.x, 100);
  } finally { await h.close(); }
});

test("preview auto-accept is blocked when the target branch changed after fork", async () => {
  const h = await setup();
  try {
    const original = await h.service.state();
    const targetBranchId = original.manifest.activeBranchId;
    const forked = await h.service.fork("Stale Preview");
    const previewBranchId = forked.manifest.activeBranchId;
    let previewState = await h.service.state();
    await h.service.editorCommand({ command: "nudge", slideId: "s1", selectedIds: ["shape"], dx: 80, dy: 0, expectedDeckHash: previewState.deckHash });

    await h.service.checkout(targetBranchId);
    const targetState = await h.service.state();
    await h.service.editorCommand({ command: "nudge", slideId: "s1", selectedIds: ["shape"], dx: 0, dy: 40, expectedDeckHash: targetState.deckHash });

    const review = await reviewCreativePreview(h.service, previewBranchId);
    assert.equal(review.targetUnchangedSinceFork, false);
    assert.equal(review.mergeable, false);
    assert(review.blockers.some((message) => message.includes("Target branch changed")));
  } finally { await h.close(); }
});

test("preview with component artifact changes refuses partial one-click merge", async () => {
  const h = await setup();
  try {
    const forked = await h.service.fork("Component Preview");
    const previewBranchId = forked.manifest.activeBranchId;
    await h.service.store.write({ id: "component_preview", kind: "component", payload: { id: "component_preview", experimental: true }, producer: { type: "codex" } });
    const review = await reviewCreativePreview(h.service, previewBranchId);
    assert.equal(review.changedArtifactKinds.includes("component"), true);
    assert.equal(review.mergeable, false);
    assert(review.blockers.some((message) => message.includes("component")));
  } finally { await h.close(); }
});
