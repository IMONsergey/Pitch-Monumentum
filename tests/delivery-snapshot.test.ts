import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { DeliveryRuntime } from "../apps/delivery/src/runtime.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "delivery_snapshot", title: "Snapshot",
    canvas: { widthDU: 1200, heightDU: 750, duPerInch: 120, aspectRatio: "custom" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Snapshot", archetype: "freeform", semantic: { purpose: "test", takeaway: "Stable", questionAnswered: "?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [
      { id: "box", type: "shape", shape: "rect", fill: "#224466", semanticRole: "visual", geometry: { x: 100, y: 100, width: 300, height: 200 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-delivery-snapshot-"));
  const store = new ArtifactStore(root);
  await store.init("Snapshot", "delivery_snapshot_project");
  await store.write({ id: "deck", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
  return { root, delivery: new DeliveryRuntime(root, { platform: "linux" }), async close() { await rm(root, { recursive: true, force: true }); } };
}

async function missing(path: string): Promise<boolean> {
  try { await access(path); return false; } catch { return true; }
}

test("review changes during Web delivery invalidate the snapshot before artifact commit", async () => {
  const h = await setup();
  try {
    const delivery = h.delivery as any;
    const originalBridgeAssets = delivery.bridgeAssets.bind(delivery);
    delivery.bridgeAssets = async (inputDeck: DeckDocument) => {
      const assets = await originalBridgeAssets(inputDeck);
      const review = await h.delivery.review.state();
      await h.delivery.review.command({
        command: "addThread",
        threadId: "mid_export_review",
        anchor: { scope: "slide", slideId: "s1" },
        type: "comment",
        priority: "normal",
        body: "Changed while export was running",
        author: { kind: "user", id: "reviewer", displayName: "Reviewer" },
        expectedDeckHash: review.deckHash,
        expectedReviewHash: review.reviewHash,
      });
      return assets;
    };

    await assert.rejects(() => h.delivery.exportWeb(), /Delivery snapshot is stale:.*review document changed/);
    assert.equal(await missing(join(h.root, ".project", "exports", "delivery_snapshot-standalone.html")), true);
  } finally { await h.close(); }
});

test("multi-format bundle never mixes deck versions and removes earlier partial artifacts", async () => {
  const h = await setup();
  try {
    const delivery = h.delivery as any;
    const originalGenerateFigma = delivery.generateFigma.bind(delivery);
    delivery.generateFigma = async (preflight: any) => {
      const artifact = await originalGenerateFigma(preflight);
      const state = await h.delivery.service.state();
      await h.delivery.service.editorCommand({ command: "nudge", slideId: "s1", selectedIds: ["box"], dx: 25, dy: 0, expectedDeckHash: state.deckHash });
      return artifact;
    };

    await assert.rejects(() => h.delivery.exportBundle(["figma", "web"]), /Delivery snapshot is stale/);
    assert.equal(await missing(join(h.root, ".project", "exports", "delivery_snapshot-figma-bridge.json")), true, "partial Figma output must be removed when bundle snapshot becomes stale");
    assert.equal(await missing(join(h.root, ".project", "exports", "delivery_snapshot-delivery-manifest.json")), true, "mixed-version bundle must never publish a manifest");
  } finally { await h.close(); }
});
