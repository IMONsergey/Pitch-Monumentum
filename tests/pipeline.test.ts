import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { Claim, NarrativeGraph, PresentationBrief } from "../packages/deck-model/src/index.js";
import { runSemanticPipeline, validateClaims, type CodexPitchReasoner, type PitchReasoningTask, type SemanticPipelineInput, type Storyboard } from "../packages/pipeline/src/index.js";

const dir = "/tmp/pitchos-semantic-pipeline-test";
const evidenceId = "evidence_01";
const input: SemanticPipelineInput = {
  projectId: "p1",
  userRequest: "Convince the board to approve phase two.",
  language: "en",
  sources: [{ id: "source_1", kind: "markdown", title: "Q2", uri: "q2.md", checksum: "x", importedAt: "2026-08-07T00:00:00Z" }],
  blocks: [{ id: "block_1", sourceId: "source_1", kind: "paragraph", anchor: { id: "anchor_1", sourceId: "source_1", locator: { lineStart: 1, lineEnd: 1 }, excerpt: "CAC fell by 24%.", checksum: "a" }, text: "CAC fell by 24%." }],
  evidenceCandidates: [{ id: evidenceId, kind: "number", anchorIds: ["anchor_1"], value: "24%", normalizedText: "CAC fell by 24%.", blockId: "block_1", rawMatch: "24%" }],
};

class FakeReasoner implements CodexPitchReasoner {
  async runStructured<T>(task: PitchReasoningTask): Promise<T> {
    if (task.kind === "claim-review") return [{ id: "claim_1", statement: "CAC fell by 24%.", dataClass: "source", evidenceRefs: [evidenceId], confidence: 0.99, verificationStatus: "verified" }] as T;
    if (task.kind === "strategist") return { id: "brief_1", language: "en", audience: "Board", communicationIntent: "Obtain approval for phase two", audienceOutcome: "Approve phase two", coreMessage: "Phase one improved acquisition economics", decisionOrAsk: "Approve phase two", deliveryContext: "Presenter-led board meeting", sourceDivergence: "balanced", readingMode: "balanced", pageBudget: { min: 2, target: 2, max: 3 }, mustInclude: [], mustNotChange: [], brandConstraints: [], assumptions: [] } satisfies PresentationBrief as T;
    if (task.kind === "story-architect") return { id: "narrative_1", nodes: [{ id: "n1", kind: "claim", label: "Phase one improved economics", claimId: "claim_1" }, { id: "n2", kind: "decision", label: "Approve phase two" }], edges: [{ id: "edge_1", from: "n1", to: "n2", kind: "supports" }], sectionOrder: [], rationale: "Proof before ask" } satisfies NarrativeGraph as T;
    if (task.kind === "storyboard") return { id: "storyboard_1", deckTitle: "Phase two decision", rationale: "Lead with proof and close with decision", slides: [
      { id: "slide_1", order: 0, title: "Phase one changed the economics", archetype: "heroMetric", semantic: { purpose: "Prove improvement", takeaway: "CAC fell by 24%", questionAnswered: "Did phase one work?", narrativeRole: "evidence", claimIds: ["claim_1"], evidenceRefs: [evidenceId], audienceRelevance: "Economic proof", density: "sparse" }, visualIntent: "Hero metric", layoutHints: ["large metric"], requiredAssetRoles: [], qaRisks: ["baseline context"] },
      { id: "slide_2", order: 1, title: "Approve phase two", archetype: "decision", semantic: { purpose: "Obtain decision", takeaway: "Approve phase two", questionAnswered: "What should we do?", narrativeRole: "decision", claimIds: [], evidenceRefs: [], audienceRelevance: "Board action", density: "sparse" }, visualIntent: "Decision card", layoutHints: ["one ask"], requiredAssetRoles: [], qaRisks: [] },
    ] } satisfies Storyboard as T;
    throw new Error(`Unexpected task ${task.kind}`);
  }
}

test("semantic pipeline writes claims → brief → narrative → storyboard with artifact provenance", async () => {
  await rm(dir, { recursive: true, force: true });
  const store = new ArtifactStore(dir);
  await store.init("semantic", "p1");
  const result = await runSemanticPipeline(store, input, new FakeReasoner());
  assert.equal(result.claims.payload[0].evidenceRefs[0], evidenceId);
  assert.equal(result.storyboard.payload.slides.length, 2);
  assert.deepEqual(result.brief.inputs.map((ref) => ref.id), ["claims_current"]);
  assert.deepEqual(result.narrative.inputs.map((ref) => ref.id), ["claims_current", "brief_current"]);
  assert.deepEqual(result.storyboard.inputs.map((ref) => ref.id), ["claims_current", "brief_current", "narrative_current"]);
  assert.equal((await store.read<Storyboard>("storyboard_current")).payload.deckTitle, "Phase two decision");
});

test("claim validation rejects fabricated evidence ids", () => {
  const claims: Claim[] = [{ id: "claim_bad", statement: "CAC fell", dataClass: "source", evidenceRefs: ["invented"], confidence: 1, verificationStatus: "verified" }];
  assert.throws(() => validateClaims(claims, input.evidenceCandidates), /unknown evidence invented/);
});
