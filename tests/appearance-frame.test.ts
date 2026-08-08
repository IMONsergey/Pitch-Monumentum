import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { exportProductionPptx, productionPreflight } from "../packages/export-pipeline/src/index.js";
import { validatePptxAppearance } from "../packages/pptx-appearance-qa/src/index.js";
import { readZipMap } from "../packages/source-ingest/src/zip.js";

function deck(): DeckDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: "0.1",
    id: "appearance_frame_deck",
    title: "Appearance frame",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief",
    narrativeId: "narrative",
    designSystemId: "design",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: now,
    updatedAt: now,
    slides: [{
      id: "slide_1",
      order: 0,
      title: "Frame",
      archetype: "freeform",
      semantic: {
        purpose: "test",
        takeaway: "test",
        questionAnswered: "test",
        narrativeRole: "test",
        claimIds: [],
        evidenceRefs: [],
        audienceRelevance: "test",
        density: "sparse",
      },
      scene: [{
        id: "frame_gradient",
        type: "frame",
        name: "Gradient frame",
        semanticRole: "visual",
        geometry: { x: 260, y: 180, width: 1000, height: 560 },
        zIndex: 1,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        childIds: [],
        fillPaint: {
          kind: "linearGradient",
          angleDeg: 45,
          stops: [
            { position: 0, color: "#102030", opacity: 1 },
            { position: 1, color: "#80FFAA", opacity: 0.85 },
          ],
        },
        effects: [{ kind: "dropShadow", color: "#000000", opacity: 0.18, blurDU: 28, offsetXDU: 7, offsetYDU: 14 }],
      }],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

test("appearance-only frame is promoted to a native editable PowerPoint shape", async () => {
  const input = deck();
  assert.equal(productionPreflight(input).some((issue) => issue.code === "pptx:appearance-only-frame-not-emitted"), false);

  const output = "/tmp/pitch-appearance-frame.pptx";
  await rm(output, { force: true });
  const manifest = await exportProductionPptx(input, output);
  assert.equal(manifest.ready, true, JSON.stringify(manifest.roundTripIssues));
  assert.equal(manifest.unsupportedElementIds.length, 0);
  assert.equal(manifest.editability.native, 1);

  const entries = readZipMap(await readFile(output));
  const slideXml = entries.get("ppt/slides/slide1.xml")?.toString("utf8") ?? "";
  assert.match(slideXml, /name="Gradient frame"/);
  assert.match(slideXml, /<a:gradFill/);
  assert.match(slideXml, /<a:outerShdw/);

  const issues = await validatePptxAppearance(input, output);
  assert.equal(issues.length, 0, JSON.stringify(issues));
});
