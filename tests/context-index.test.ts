import test from "node:test";
import assert from "node:assert/strict";
import type { Claim, DeckDocument, EvidenceItem, SourceAnchor, SourceDocument } from "../packages/deck-model/src/index.js";
import { buildContextIndex, markSourceChecksumChanged, traceElementEvidence } from "../packages/context-index/src/index.js";

const source: SourceDocument = { id: "src", kind: "xlsx", title: "Metrics", uri: "metrics.xlsx", checksum: "old", importedAt: "2026-08-07T00:00:00Z" };
const anchor: SourceAnchor = { id: "a1", sourceId: "src", locator: { sheet: "CAC", range: "B4" }, excerpt: "76", checksum: "old-anchor" };
const evidence: EvidenceItem = { id: "e1", kind: "number", anchorIds: ["a1"], value: 76, normalizedText: "CAC = 76" };
const claim: Claim = { id: "c1", statement: "CAC fell to 76", dataClass: "source", evidenceRefs: ["e1"], confidence: 1, verificationStatus: "verified" };
const deck: DeckDocument = {
  schemaVersion: "0.1", id: "d", title: "D", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "ds", sourceIds: ["src"], claimIds: ["c1"], activeBranchId: "branch_main", createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T00:00:00Z",
  slides: [
    { id: "s1", order: 0, title: "CAC", archetype: "heroMetric", semantic: { purpose: "prove", takeaway: "CAC fell to 76", questionAnswered: "did it improve?", narrativeRole: "evidence", claimIds: ["c1"], evidenceRefs: ["e1"], audienceRelevance: "board", density: "sparse" }, status: "ready", qaIssueIds: [], dependencyIds: ["c1", "e1"], scene: [{ id: "metric", type: "text", semanticRole: "metric", geometry: { x: 100, y: 200, width: 800, height: 200 }, zIndex: 1, origin: "agent", exportStrategy: "native", dependencies: [{ kind: "claim", id: "c1" }, { kind: "evidence", id: "e1" }], paragraphs: [{ runs: [{ text: "76" }] }] }] },
    { id: "s2", order: 1, title: "Ask", archetype: "decision", semantic: { purpose: "ask", takeaway: "Approve", questionAnswered: "what now?", narrativeRole: "decision", claimIds: [], evidenceRefs: [], audienceRelevance: "board", density: "sparse" }, status: "ready", qaIssueIds: [], dependencyIds: [], scene: [] }
  ]
};

test("context index traces an element back to an exact source anchor", () => {
  const index = buildContextIndex({ sources: [source], anchors: [anchor], evidence: [evidence], claims: [claim], deck });
  const trace = traceElementEvidence(index, "s1", "metric");
  assert.equal(trace.claims[0].claim?.id, "c1");
  assert.equal(trace.claims[0].evidence[0].anchors[0].anchor.locator.range, "B4");
  assert.equal(trace.claims[0].evidence[0].anchors[0].source?.title, "Metrics");
});

test("source checksum change marks only true downstream dependents stale", () => {
  const index = buildContextIndex({ sources: [source], anchors: [anchor], evidence: [evidence], claims: [claim], deck });
  const result = markSourceChecksumChanged(index, "src", "new");
  assert.deepEqual(result.impact.slideIds, ["s1"]);
  assert.deepEqual(result.impact.elementIds, ["metric"]);
  assert.equal(result.index.health.claims.c1, "stale");
  assert.equal(result.index.claims.c1.verificationStatus, "stale");
  assert.equal(result.impact.slideIds.includes("s2"), false);
});
