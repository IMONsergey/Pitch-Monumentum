import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { executeEditorCommand } from "../packages/editor-commands/src/service.js";
import { applyDeckMutation, createMutation, deckHash } from "../packages/mutations/src/index.js";
import { executePitchSetAppearanceTool, pitchSetAppearanceToolDefinition } from "../packages/codex-editor-tools/src/index.js";
import { exportProductionPptx } from "../packages/export-pipeline/src/index.js";
import { validatePptxAppearance } from "../packages/pptx-appearance-qa/src/index.js";
import { readZipMap } from "../packages/source-ingest/src/zip.js";

function fixture(): DeckDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: "0.1",
    id: "appearance_deck",
    title: "Appearance",
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
      title: "Appearance",
      archetype: "freeform",
      semantic: {
        purpose: "test appearance",
        takeaway: "test",
        questionAnswered: "test",
        narrativeRole: "test",
        claimIds: [],
        evidenceRefs: [],
        audienceRelevance: "test",
        density: "sparse",
      },
      scene: [{
        id: "shape_1",
        type: "shape",
        semanticRole: "visual",
        geometry: { x: 220, y: 180, width: 900, height: 480 },
        zIndex: 1,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        shape: "rect",
        stroke: { color: "#112233", widthDU: 2, dash: "dash" },
      }],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

test("editor appearance command commits canonical gradient and shadow", () => {
  const deck = fixture();
  const command = executeEditorCommand(deck, {
    command: "setAppearance",
    slideId: "slide_1",
    elementId: "shape_1",
    appearance: {
      fillPaint: {
        kind: "linearGradient",
        angleDeg: 135,
        stops: [
          { position: 0, color: "#0D0E11", opacity: 0.9 },
          { position: 1, color: "#C7FF5E", opacity: 1 },
        ],
      },
      effects: [{ kind: "dropShadow", color: "#000000", opacity: 0.22, blurDU: 24, offsetXDU: 8, offsetYDU: 12 }],
    },
  });
  const applied = applyDeckMutation(deck, createMutation(command.reason, command.operations, "user", deckHash(deck)));
  const shape = applied.deck.slides[0].scene[0];
  assert.equal(shape.type, "shape");
  if (shape.type !== "shape") throw new Error("Expected shape");
  assert.equal(shape.fillPaint?.kind, "linearGradient");
  assert.equal(shape.effects?.[0]?.kind, "dropShadow");
  assert(applied.impact.staleArtifacts.includes("qa:visual"));
  assert(applied.impact.staleArtifacts.includes("export"));
});

test("appearance mutation rejects invalid gradient stop ordering", () => {
  const deck = fixture();
  assert.throws(() => applyDeckMutation(deck, createMutation("bad gradient", [{
    op: "updateElementAppearance",
    slideId: "slide_1",
    elementId: "shape_1",
    appearance: {
      fillPaint: {
        kind: "linearGradient",
        angleDeg: 0,
        stops: [
          { position: 1, color: "#111111" },
          { position: 0, color: "#FFFFFF" },
        ],
      },
    },
  }])), /sorted by position/);
});

test("strict Codex appearance tool changes only the selected element", () => {
  const deck = fixture();
  assert.equal(pitchSetAppearanceToolDefinition.strict, true);
  assert.equal(pitchSetAppearanceToolDefinition.parameters.additionalProperties, false);
  assert((pitchSetAppearanceToolDefinition.parameters.required as readonly string[]).includes("shadowOffsetYDU"));

  const result = executePitchSetAppearanceTool(deck, {
    name: "pitch_set_appearance",
    expectedDeckHash: deckHash(deck),
    arguments: {
      slideId: "slide_1",
      elementId: "shape_1",
      fillKind: "solid",
      solidColor: "#3366FF",
      solidOpacity: 0.8,
      gradientAngleDeg: null,
      gradientStartColor: null,
      gradientStartOpacity: null,
      gradientEndColor: null,
      gradientEndOpacity: null,
      shadowEnabled: true,
      shadowColor: "#000000",
      shadowOpacity: 0.25,
      shadowBlurDU: 18,
      shadowOffsetXDU: 4,
      shadowOffsetYDU: 8,
    },
  });
  const shape = result.applied.deck.slides[0].scene[0];
  assert.equal(shape.type, "shape");
  if (shape.type !== "shape") throw new Error("Expected shape");
  assert.deepEqual(shape.fillPaint, { kind: "solid", color: "#3366FF", opacity: 0.8 });
  assert.equal(shape.effects?.[0]?.kind, "dropShadow");
  assert.equal(result.tool, "pitch_set_appearance");
  assert.notEqual(result.beforeHash, result.afterHash);
});

test("production PPTX keeps gradient and shadow as native DrawingML and passes appearance QA", async () => {
  const deck = fixture();
  const command = executeEditorCommand(deck, {
    command: "setAppearance",
    slideId: "slide_1",
    elementId: "shape_1",
    appearance: {
      fillPaint: {
        kind: "linearGradient",
        angleDeg: 135,
        stops: [
          { position: 0, color: "#0D0E11", opacity: 0.75 },
          { position: 1, color: "#C7FF5E", opacity: 1 },
        ],
      },
      effects: [{ kind: "dropShadow", color: "#000000", opacity: 0.24, blurDU: 20, offsetXDU: 6, offsetYDU: 10 }],
    },
  });
  const changed = applyDeckMutation(deck, createMutation(command.reason, command.operations)).deck;
  const output = "/tmp/pitch-appearance-native.pptx";
  await rm(output, { force: true });
  const manifest = await exportProductionPptx(changed, output);
  assert.equal(manifest.ready, true, JSON.stringify(manifest.roundTripIssues));
  assert.equal(manifest.editability.native, 1);

  const entries = readZipMap(await readFile(output));
  const slideXml = entries.get("ppt/slides/slide1.xml")?.toString("utf8") ?? "";
  assert.match(slideXml, /<a:gradFill/);
  assert.match(slideXml, /<a:outerShdw/);
  assert.match(slideXml, /<a:gs pos="0">/);
  assert.match(slideXml, /<a:gs pos="100000">/);

  const issues = await validatePptxAppearance(changed, output);
  assert.equal(issues.length, 0, JSON.stringify(issues));
});
