import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { SystemHealthRuntime } from "../apps/system-health/src/runtime.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "health_deck", title: "Health",
    canvas: { widthDU: 1200, heightDU: 750, duPerInch: 120, aspectRatio: "custom" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Health", archetype: "freeform", semantic: { purpose: "test", takeaway: "Healthy", questionAnswered: "?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [
      { id: "title", type: "text", paragraphs: [{ runs: [{ text: "Health", fontSizePt: 36, color: "#111111" }] }], semanticRole: "title", geometry: { x: 100, y: 100, width: 600, height: 100 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-system-health-"));
  const store = new ArtifactStore(root);
  await store.init("Health", "health_project");
  await store.write({ id: "deck", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
  const health = new SystemHealthRuntime(root);
  return { root, health, async close() { await rm(root, { recursive: true, force: true }); } };
}

function check(snapshot: Awaited<ReturnType<SystemHealthRuntime["snapshot"]>>, id: string) {
  const value = snapshot.checks.find((item) => item.id === id);
  assert(value, `missing System Health check ${id}`);
  return value;
}

test("System Health reports full project runtime lanes and product environment", async () => {
  const h = await setup();
  try {
    const snapshot = await h.health.snapshot();
    assert.equal(snapshot.schemaVersion, "0.1");
    assert.equal(snapshot.productVersion, "0.3.0-preview.1");
    assert.equal(snapshot.projectId, "health_project");
    assert.equal(snapshot.activeBranchId, "branch_main");
    assert.equal(check(snapshot, "project").status, "ok");
    assert.equal(check(snapshot, "assets").status, "ok");
    assert.equal(check(snapshot, "versions").status, "ok");
    assert(check(snapshot, "delivery").details?.readyFormats !== undefined);
    assert.equal(typeof snapshot.environment.arch, "string");
    assert.equal(typeof snapshot.environment.node, "string");
    assert(snapshot.summary.ok > 0);
  } finally { await h.close(); }
});

test("blocking review is visible in System Health and closes delivery readiness", async () => {
  const h = await setup();
  try {
    const review = await h.health.review.state();
    await h.health.review.command({
      command: "addThread",
      threadId: "health_blocker",
      anchor: { scope: "slide", slideId: "s1" },
      type: "changeRequest",
      priority: "blocking",
      body: "Resolve before delivery",
      author: { kind: "user", id: "reviewer", displayName: "Reviewer" },
      expectedDeckHash: review.deckHash,
      expectedReviewHash: review.reviewHash,
    });
    const snapshot = await h.health.snapshot();
    const reviewCheck = check(snapshot, "review");
    assert.equal(reviewCheck.status, "warning");
    assert.match(reviewCheck.message, /1 blocking review thread/);
    assert.equal(snapshot.summary.deliveryReady, false);
    assert.equal((check(snapshot, "delivery").details?.readyFormats as string[]).length, 0);
  } finally { await h.close(); }
});
