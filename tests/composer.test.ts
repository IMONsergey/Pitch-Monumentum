import test from "node:test";
import assert from "node:assert/strict";
import type { Claim, DesignSystem } from "../packages/deck-model/src/index.js";
import type { Storyboard } from "../packages/pipeline/src/index.js";
import { composeStoryboardToDeck } from "../packages/composer/src/index.js";
import { runDeterministicQA } from "../packages/qa/src/index.js";
import { compileDeckToPptx } from "../packages/pptx/src/index.js";
import { rm, stat } from "node:fs/promises";

const design: DesignSystem = {
  id: "design", name: "Decision Minimal",
  tokens: { colors: { canvas: "#F6F5F0", surface: "#FFFFFF", primaryText: "#111111", secondaryText: "#60646C", accent: "#2F5CF4", border: "#D9DCE1" }, fonts: { display: "Aptos Display", body: "Aptos" }, typeScalePt: { h1: 36, display: 48, metric: 92, bodyLarge: 22, body: 24 }, spacingDU: {} },
  grid: { marginXDU: 144, marginYDU: 96, columns: 12, gutterDU: 24 }, chartRules: [], imageRules: [], iconRules: [], forbiddenTreatments: [], recipeIds: []
};
const claims: Claim[] = [{ id: "claim_1", statement: "CAC fell by 24%.", dataClass: "source", evidenceRefs: ["evidence_1"], confidence: 1, verificationStatus: "verified" }];
const storyboard: Storyboard = { id: "storyboard", deckTitle: "Phase two decision", rationale: "Proof then ask", slides: [
  { id: "slide_1", order: 0, title: "Phase one changed the economics", archetype: "heroMetric", semantic: { purpose: "Prove improvement", takeaway: "CAC fell by 24%", questionAnswered: "Did it work?", narrativeRole: "evidence", claimIds: ["claim_1"], evidenceRefs: ["evidence_1"], audienceRelevance: "Economics", density: "sparse" }, visualIntent: "Hero metric", layoutHints: [], requiredAssetRoles: [], qaRisks: [] },
  { id: "slide_2", order: 1, title: "The decision", archetype: "decision", semantic: { purpose: "Get approval", takeaway: "Approve phase two", questionAnswered: "What now?", narrativeRole: "decision", claimIds: [], evidenceRefs: [], audienceRelevance: "Board action", density: "sparse" }, visualIntent: "Decision", layoutHints: [], requiredAssetRoles: [], qaRisks: [] },
] };

test("deterministic composer produces native editable scene objects with stable ids", () => {
  const deck = composeStoryboardToDeck({ storyboard, designSystem: design, briefId: "brief", narrativeId: "narrative", sourceIds: ["source"], claims, branchId: "branch_main", now: "2026-08-07T00:00:00Z" });
  assert.equal(deck.slides.length, 2);
  assert.ok(deck.slides[0].scene.some(element => element.id === "slide_1:metric" && element.type === "text"));
  assert.ok(deck.slides.every(slide => slide.scene.every(element => element.exportStrategy === "native")));
  assert.equal(deck.slides[0].dependencyIds.includes("claim_1"), true);
  assert.equal(runDeterministicQA(deck).some(issue => issue.severity === "critical"), false);
});

test("storyboard can compile through scene graph into a real native PPTX", async () => {
  const out = "/tmp/pitchos-composed.pptx"; await rm(out, { force: true });
  const deck = composeStoryboardToDeck({ storyboard, designSystem: design, briefId: "brief", narrativeId: "narrative", sourceIds: ["source"], claims, branchId: "branch_main", now: "2026-08-07T00:00:00Z" });
  const result = await compileDeckToPptx(deck, out);
  assert.equal(result.slideCount, 2);
  assert.equal(result.elementResults.some(item => item.strategy === "unsupported"), false);
  assert.ok((await stat(out)).size > 2000);
});
