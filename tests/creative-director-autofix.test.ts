import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { buildCreativeSafeFixPlan } from "../packages/creative-director/src/autofix.js";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { executeCreativeSafeFixes } from "../apps/creative-director/src/autofix-runtime.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-director-autofix-"));
  const store = new ArtifactStore(root);
  await store.init("Director safe fixes", "director_safe_project");
  const deck: DeckDocument = {
    schemaVersion: "0.1", id: "deck_safe", title: "Safe fixes",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{
      id: "s1", order: 0, title: "Safe", archetype: "freeform",
      semantic: { purpose: "test", takeaway: "Keep meaning", questionAnswered: "What?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
      scene: [
        { id: "shape", type: "shape", shape: "rect", fill: "#445566", semanticRole: "decoration", geometry: { x: 100, y: 100, width: 400, height: 240 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
        { id: "text", type: "text", paragraphs: [{ runs: [{ text: "Title", fontFamily: "Inter", fontSizePt: 31.7, color: "#FFFFFF" }] }], semanticRole: "title", geometry: { x: 120, y: 400, width: 900, height: 120 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [] },
      ], status: "draft", qaIssueIds: [], dependencyIds: [],
    }],
  };
  (deck as any).theme = { schemaVersion: "0.1", id: "theme", name: "Theme", colors: { panel: "#445566", onDark: "#FFFFFF" }, fonts: { sans: "Inter" }, typeScalePt: { h1: 32 }, spacingDU: {} };
  await store.write({ id: "deck", kind: "deck", payload: deck, producer: { type: "deterministic" } });
  return { root, service: new PitchWorkspaceService(root), async close() { await rm(root, { recursive: true, force: true }); } };
}

test("safe-fix planner accepts exact matches but rejects approximate type-scale inference", async () => {
  const h = await setup();
  try {
    const state = await h.service.state();
    const plan = buildCreativeSafeFixPlan(state.deck);
    assert(plan.suggestions.some((suggestion) => suggestion.elementId === "shape" && suggestion.target === "fill" && suggestion.token === "panel"));
    assert(plan.suggestions.some((suggestion) => suggestion.elementId === "text" && suggestion.target === "fontFamily" && suggestion.token === "sans"));
    assert(plan.suggestions.some((suggestion) => suggestion.elementId === "text" && suggestion.target === "textColor" && suggestion.token === "onDark"));
    assert.equal(plan.suggestions.some((suggestion) => suggestion.elementId === "text" && suggestion.target === "fontSizePt"), false, "31.7pt is near h1 but not an exact safe-fix match");
  } finally { await h.close(); }
});

test("all exact safe fixes commit as one visually-neutral deck version and one undo point", async () => {
  const h = await setup();
  try {
    const before = await h.service.state();
    const beforeVersion = (Object.values(before.manifest.branches[before.manifest.activeBranchId].heads).find((head: any) => head.kind === "deck") as any).version;
    const result = await executeCreativeSafeFixes(h.service, before.deckHash);
    const after = await h.service.state();
    const afterVersion = (Object.values(after.manifest.branches[after.manifest.activeBranchId].heads).find((head: any) => head.kind === "deck") as any).version;
    assert.equal(afterVersion, beforeVersion + 1, "safe fixes should write exactly one deck version");
    const shape: any = after.deck.slides[0].scene.find((element: any) => element.id === "shape");
    const text: any = after.deck.slides[0].scene.find((element: any) => element.id === "text");
    assert.equal(shape.fill, "#445566");
    assert.equal(shape.tokenBindings.fill, "panel");
    assert.equal(text.paragraphs[0].runs[0].fontFamily, "Inter");
    assert.equal(text.paragraphs[0].runs[0].color, "#FFFFFF");
    assert.equal(text.tokenBindings.fontFamily, "sans");
    assert.equal(text.tokenBindings.textColor, "onDark");
    assert.equal(text.tokenBindings?.fontSizePt, undefined);
    assert.equal(result.history.canUndo, true);

    await h.service.undo();
    const restored = await h.service.state();
    assert.equal((restored.deck.slides[0].scene.find((element: any) => element.id === "shape") as any).tokenBindings, undefined);
    assert.equal((restored.deck.slides[0].scene.find((element: any) => element.id === "shape") as any).fill, "#445566");
  } finally { await h.close(); }
});
