import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { VersionWorkspaceRuntime } from "../apps/versions/src/runtime.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-versions-"));
  const store = new ArtifactStore(root);
  await store.init("Versions", "versions_project");
  const deck: DeckDocument = {
    schemaVersion: "0.1", id: "deck_versions", title: "Versions",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" }, briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{ id: "s1", order: 0, title: "Versioned", archetype: "freeform", semantic: { purpose: "test", takeaway: "Preserve", questionAnswered: "What?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [{ id: "shape", type: "shape", shape: "rect", fill: "#334455", semanticRole: "visual", geometry: { x: 100, y: 100, width: 500, height: 300 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] }], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
  await store.write({ id: "deck", kind: "deck", payload: deck, producer: { type: "deterministic" } });
  return { root, runtime: new VersionWorkspaceRuntime(root), async close() { await rm(root, { recursive: true, force: true }); } };
}

test("checkpoint compare and restore preserve newer source branch work", async () => {
  const h = await setup();
  try {
    const baselineState = await h.runtime.service.state();
    const sourceBranchId = baselineState.manifest.activeBranchId;
    const checkpoint = await h.runtime.createCheckpoint("Approved baseline", "Before bolder composition");
    assert.equal(checkpoint.sourceBranchId, sourceBranchId);
    assert.equal(checkpoint.deckHash, baselineState.deckHash);

    await h.runtime.service.editorCommand({ command: "nudge", slideId: "s1", selectedIds: ["shape"], dx: 120, dy: 0, expectedDeckHash: baselineState.deckHash });
    const edited = await h.runtime.service.state();
    assert.equal((edited.deck.slides[0].scene[0] as any).geometry.x, 220);

    const comparison = await h.runtime.compareCheckpoint(checkpoint.id);
    assert.equal(comparison.deckDiff.changed, true);
    assert(comparison.deckDiff.slideDiffs.some((slide) => slide.elementDiffs.some((diff) => diff.elementId === "shape" && diff.kind === "geometry")));

    const restored = await h.runtime.restoreCheckpoint(checkpoint.id);
    assert.notEqual(restored.restoredBranchId, sourceBranchId);
    assert.equal(restored.state.manifest.activeBranchId, restored.restoredBranchId);
    assert.equal((restored.state.deck.slides[0].scene[0] as any).geometry.x, 100);
    assert.equal(restored.state.history.canUndo, false, "restored checkpoint branch starts history from the saved snapshot rather than fabricating older edits");

    const restoredBranch = restored.state.manifest.branches[restored.restoredBranchId];
    assert(restoredBranch.baseHeads, "restored snapshot branch should retain its snapshot base heads for compare/conflict review");
    assert.equal(restoredBranch.parentBranchId, sourceBranchId);

    await h.runtime.checkout(sourceBranchId);
    const sourceAgain = await h.runtime.service.state();
    assert.equal((sourceAgain.deck.slides[0].scene[0] as any).geometry.x, 220, "newer source work must remain untouched by restore");

    const branchComparison = await h.runtime.compareBranches(restored.restoredBranchId, sourceBranchId);
    assert.equal(branchComparison.deckDiff.changed, true);
    assert(branchComparison.deckDiff.summary.geometryChanges >= 1);
  } finally { await h.close(); }
});

test("checkpoint deletion removes only the checkpoint metadata", async () => {
  const h = await setup();
  try {
    const checkpoint = await h.runtime.createCheckpoint("Temporary");
    assert.equal((await h.runtime.state()).checkpoints.length, 1);
    await h.runtime.removeCheckpoint(checkpoint.id);
    assert.equal((await h.runtime.state()).checkpoints.length, 0);
    const state = await h.runtime.service.state();
    assert.equal(state.deck.slides.length, 1);
  } finally { await h.close(); }
});
