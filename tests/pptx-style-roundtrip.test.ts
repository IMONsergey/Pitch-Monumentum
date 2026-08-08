import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { compileDeckToPptx } from "../packages/pptx/src/index.js";
import { inspectPptx, validatePptxRoundTrip } from "../packages/pptx-roundtrip/src/index.js";
import { powerPointStyleFidelityIssues } from "../packages/export-pipeline/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "style-roundtrip",
    title: "Visual style round trip",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b",
    narrativeId: "n",
    designSystemId: "d",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z",
    updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1",
      order: 0,
      title: "Style",
      archetype: "freeform",
      semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
      scene: [
        {
          id: "shape",
          type: "shape",
          semanticRole: "visual",
          geometry: { x: 120, y: 120, width: 600, height: 320 },
          zIndex: 1,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          shape: "roundRect",
          fill: "#CC2233",
          stroke: { color: "#112233", widthDU: 3, dash: "dash" },
          radiusDU: 24,
        },
        {
          id: "line",
          type: "line",
          semanticRole: "visual",
          geometry: { x: 180, y: 620, width: 900, height: 120 },
          zIndex: 2,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          start: [0, 0],
          end: [900, 120],
          stroke: { color: "#00AA66", widthDU: 5, dash: "dot" },
          startMarker: "dot",
          endMarker: "arrow",
        },
      ],
    }],
  };
}

test("native PowerPoint shapes and lines preserve supported visual styles", async () => {
  const out = "/tmp/pitch-style-roundtrip.pptx";
  await rm(out, { force: true });
  const deck = fixture();
  await compileDeckToPptx(deck, out);

  const inspection = await inspectPptx(out);
  assert.equal(inspection.slides[0].shapeStyles.length, 1);
  assert.deepEqual(inspection.slides[0].shapeStyles[0], {
    preset: "roundRect",
    fill: "#CC2233",
    strokeColor: "#112233",
    strokeWidthDU: 3,
    dash: "dash",
  });
  assert.equal(inspection.slides[0].lineStyles.length, 1);
  assert.deepEqual(inspection.slides[0].lineStyles[0], {
    strokeColor: "#00AA66",
    strokeWidthDU: 5,
    dash: "dot",
    startMarker: "dot",
    endMarker: "arrow",
  });

  const roundTrip = await validatePptxRoundTrip(deck, out);
  assert.equal(roundTrip.issues.filter((issue) => issue.kind === "shapeStyle" || issue.kind === "lineStyle").length, 0, JSON.stringify(roundTrip.issues));
});

test("PowerPoint preflight reports non-blocking corner-radius fidelity limits", () => {
  const deck = fixture();
  deck.slides[0].scene.push({
    id: "rounded-image",
    type: "image",
    semanticRole: "visual",
    geometry: { x: 1200, y: 120, width: 420, height: 320 },
    zIndex: 3,
    origin: "user",
    exportStrategy: "native",
    dependencies: [{ kind: "asset", id: "asset" }],
    assetId: "asset",
    fit: "cover",
    cornerRadiusDU: 32,
  });
  const issues = powerPointStyleFidelityIssues(deck);
  assert(issues.some((issue) => issue.elementId === "shape" && issue.code === "pptx:corner-radius-approximate" && issue.severity === "minor"));
  assert(issues.some((issue) => issue.elementId === "rounded-image" && issue.code === "pptx:image-corner-radius-not-preserved" && issue.severity === "major"));
  assert.equal(issues.some((issue) => issue.severity === "critical"), false);
});
