import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { compileDeckToPptx } from "../packages/pptx/src/index.js";
import { inspectPptx, validatePptxRoundTrip } from "../packages/pptx-roundtrip/src/index.js";

const output = "/tmp/pitchos-roundtrip.pptx";
const deck: DeckDocument = {
  schemaVersion: "0.1", id: "deck_rt", title: "Round trip", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T00:00:00Z",
  slides: [{ id: "s1", order: 0, title: "Proof", archetype: "thesis", semantic: { purpose: "prove", takeaway: "CAC fell 24%", questionAnswered: "did it work?", narrativeRole: "evidence", claimIds: [], evidenceRefs: [], audienceRelevance: "board", density: "sparse" }, status: "ready", qaIssueIds: [], dependencyIds: [], scene: [
    { id: "title", type: "text", semanticRole: "title", geometry: { x: 140, y: 120, width: 1300, height: 140 }, zIndex: 1, origin: "deterministic", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "CAC fell 24%", fontSizePt: 40, bold: true, color: "#111111" }] }] },
    { id: "bar", type: "shape", semanticRole: "visual", geometry: { x: 140, y: 420, width: 900, height: 120 }, zIndex: 2, origin: "deterministic", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#C7FF5E" }
  ] }]
};

test("exported PPTX can be re-inspected and preserves required native text", async () => {
  await rm(output, { force: true });
  await compileDeckToPptx(deck, output);
  const inspection = await inspectPptx(output);
  assert.equal(inspection.hasPresentation, true);
  assert.equal(inspection.hasContentTypes, true);
  assert.equal(inspection.slides.length, 1);
  assert.ok(inspection.slides[0].text.includes("CAC fell 24%"));
  const result = await validatePptxRoundTrip(deck, output);
  assert.equal(result.issues.some((issue) => issue.severity === "critical"), false);
});
