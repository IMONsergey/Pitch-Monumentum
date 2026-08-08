import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { CreativeDirectorRuntime } from "../apps/creative-director/src/runtime.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-creative-director-"));
  const store = new ArtifactStore(root);
  await store.init("Creative Director test", "creative_project");
  const deck: DeckDocument = {
    schemaVersion: "0.1", id: "deck_creative", title: "Creative",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{
      id: "s1", order: 0, title: "Creative slide", archetype: "freeform",
      semantic: { purpose: "test", takeaway: "Keep the message", questionAnswered: "What?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
      scene: [
        { id: "shape1", type: "shape", shape: "rect", fill: "#112233", tokenBindings: { fill: "accent" }, semanticRole: "decoration", geometry: { x: 80, y: 80, width: 500, height: 300 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] } as any,
        { id: "img1", type: "image", assetId: "asset_missing", fit: "cover", semanticRole: "visual", geometry: { x: 700, y: 180, width: 600, height: 420 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [] },
      ],
      status: "draft", qaIssueIds: [], dependencyIds: [],
    }],
  };
  (deck as any).theme = { schemaVersion: "0.1", id: "theme_1", name: "Theme", colors: { accent: "#112233" }, fonts: {}, typeScalePt: {}, spacingDU: {} };
  await store.write({ id: "deck", kind: "deck", payload: deck, producer: { type: "deterministic" } });
  return { root, runtime: new CreativeDirectorRuntime(root), async close() { await rm(root, { recursive: true, force: true }); } };
}

test("local Creative Director media action writes through ordinary current-branch history", async () => {
  const h = await setup();
  try {
    const prepared = await h.runtime.prepare({ id: "media_req", instruction: "Fit the selected image inside its frame", intent: ["media"], scope: { kind: "selection", slideIds: ["s1"], elementIds: ["img1"] } });
    assert.equal(prepared.plan.blocked, false, prepared.plan.blockers.join("; "));
    const result = await h.runtime.execute(prepared.plan, {
      schemaVersion: "0.1", requestId: "media_req", deckId: "deck_creative", mode: "currentBranch",
      actions: [{ id: "media_1", stepId: "edit_media", tool: "pitch_media_command", args: { command: "setImageFit", slideId: "s1", elementId: "img1", fit: "contain" } }],
    });
    assert.equal(result.executed, true, result.error);
    assert.equal(result.error, undefined);
    const state = await h.runtime.service.state();
    assert.equal((state.deck.slides[0].scene.find((element: any) => element.id === "img1") as any).fit, "contain");
    assert.equal(state.history.canUndo, true);
    assert.equal(result.executionBranchId, result.originalBranchId);
  } finally { await h.close(); }
});

test("global Creative Director token update defaults to an isolated preview branch", async () => {
  const h = await setup();
  try {
    const prepared = await h.runtime.prepare({ id: "brand_req", instruction: "Change the global accent color", intent: ["brand"], scope: { kind: "deck" }, allowGlobalPropagation: true });
    assert.equal(prepared.plan.blocked, false, prepared.plan.blockers.join("; "));
    const result = await h.runtime.execute(prepared.plan, {
      schemaVersion: "0.1", requestId: "brand_req", deckId: "deck_creative",
      actions: [{ id: "brand_1", stepId: "edit_brand", tool: "pitch_design_command", args: { command: "setToken", category: "colors", token: "accent", value: "#FF3366" } }],
    });
    assert.equal(result.executed, true, result.error);
    assert(result.previewBranchId);
    assert.notEqual(result.executionBranchId, result.originalBranchId);
    assert.equal(result.activeBranchId, result.executionBranchId);
    let state = await h.runtime.service.state();
    assert.equal((state.deck as any).theme.colors.accent, "#FF3366");
    assert.equal((state.deck.slides[0].scene.find((element: any) => element.id === "shape1") as any).fill, "#FF3366");

    await h.runtime.service.checkout(result.originalBranchId);
    state = await h.runtime.service.state();
    assert.equal((state.deck as any).theme.colors.accent, "#112233");
    assert.equal((state.deck.slides[0].scene.find((element: any) => element.id === "shape1") as any).fill, "#112233");
  } finally { await h.close(); }
});

test("Creative Director preparation blocks unknown selection handles before execution", async () => {
  const h = await setup();
  try {
    const prepared = await h.runtime.prepare({ id: "bad_scope", instruction: "Polish this", intent: ["polish"], scope: { kind: "selection", slideIds: ["s1"], elementIds: ["does_not_exist"] } });
    assert.equal(prepared.plan.blocked, true);
    assert(prepared.plan.blockers.some((message) => message.includes("Unknown scoped element")));
  } finally { await h.close(); }
});
