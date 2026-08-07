import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { proposeAndApplyAgentEdit, validateAgentEditProposal, type CodexEditReasoner } from "../packages/agent-edit/src/index.js";

const deck: DeckDocument = {
  schemaVersion: "0.1", id: "d", title: "D", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "ds", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T00:00:00Z",
  slides: [
    { id: "s1", order: 0, title: "One", archetype: "thesis", semantic: { purpose: "p", takeaway: "t", questionAnswered: "q", narrativeRole: "claim", claimIds: [], evidenceRefs: [], audienceRelevance: "a", density: "sparse" }, status: "ready", qaIssueIds: [], dependencyIds: [], scene: [
      { id: "a", type: "text", semanticRole: "title", geometry: { x: 100, y: 100, width: 800, height: 100 }, zIndex: 1, origin: "agent", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Selected" }] }] },
      { id: "b", type: "text", semanticRole: "body", geometry: { x: 100, y: 300, width: 800, height: 100 }, zIndex: 2, origin: "agent", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Neighbor" }] }] }
    ] },
    { id: "s2", order: 1, title: "Two", archetype: "closing", semantic: { purpose: "p2", takeaway: "t2", questionAnswered: "q2", narrativeRole: "close", claimIds: [], evidenceRefs: [], audienceRelevance: "a", density: "sparse" }, status: "ready", qaIssueIds: [], dependencyIds: [], scene: [] }
  ]
};

test("element-scoped Codex edit cannot mutate a neighboring element", () => {
  assert.throws(() => validateAgentEditProposal(deck, { scope: "element", slideIds: ["s1"], elementIds: ["a"] }, { summary: "oops", operations: [{ op: "updateGeometry", slideId: "s1", elementId: "b", geometry: { x: 200 } }] }), /escaped selected element scope/);
});

test("valid element-scoped Codex edit mutates only selected object", async () => {
  const reasoner: CodexEditReasoner = { async runStructured() { return { summary: "move title", operations: [{ op: "updateGeometry", slideId: "s1", elementId: "a", geometry: { x: 180 } }] } as any; } };
  const result = await proposeAndApplyAgentEdit(deck, { scope: "element", slideIds: ["s1"], elementIds: ["a"] }, "move it right", reasoner);
  assert.equal(result.validated.autoApplicable, true);
  assert.equal(result.applied?.deck.slides[0].scene[0].geometry.x, 180);
  assert.equal(result.applied?.deck.slides[0].scene[1], deck.slides[0].scene[1]);
  assert.equal(result.applied?.deck.slides[1], deck.slides[1]);
});

test("agent can request scope expansion without silently applying it", () => {
  const result = validateAgentEditProposal(deck, { scope: "element", slideIds: ["s1"], elementIds: ["a"] }, { summary: "needs slide", operations: [], requiresScopeExpansion: { reason: "Changing the claim requires the slide takeaway too", requestedScope: "slide", slideIds: ["s1"] } });
  assert.equal(result.autoApplicable, false);
  assert.match(result.scopeExpansionReason!, /claim/);
});
