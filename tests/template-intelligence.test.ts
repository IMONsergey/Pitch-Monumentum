import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import type { DeckDocument, SlideDocument } from "../packages/deck-model/src/index.js";
import { compileDeckToPptx } from "../packages/pptx/src/index.js";
import { analyzePptxTemplate, analyzePptxTemplateBytes } from "../packages/template-intelligence/src/index.js";

const out = "/tmp/pitch-template-intelligence.pptx";

function slide(id: string, order: number, title: string, body: string): SlideDocument {
  return {
    id,
    order,
    title,
    archetype: "thesis",
    semantic: { purpose: "test", takeaway: title, questionAnswered: "", narrativeRole: "thesis", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "balanced" },
    scene: [
      { id: `${id}_title`, type: "text", semanticRole: "title", geometry: { x: 144, y: 110, width: 1500, height: 130 }, zIndex: 1, origin: "deterministic", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: title, fontFamily: "Inter", fontSizePt: 42, bold: true, color: "#111111" }] }] },
      { id: `${id}_body`, type: "text", semanticRole: "body", geometry: { x: 144, y: 310, width: 1000, height: 300 }, zIndex: 2, origin: "deterministic", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: body, fontFamily: "Inter", fontSizePt: 22, color: "#475467" }], align: "left" }] },
      { id: `${id}_accent`, type: "shape", semanticRole: "decoration", geometry: { x: 1280, y: 300, width: 430, height: 430 }, zIndex: 0, origin: "deterministic", exportStrategy: "native", dependencies: [], shape: "roundRect", fill: "#335CFF", radiusDU: 36 },
    ],
    status: "ready",
    qaIssueIds: [],
    dependencyIds: [],
  };
}

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "template_fixture",
    title: "Corporate template fixture",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief",
    narrativeId: "narrative",
    designSystemId: "design",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z",
    updatedAt: "2026-08-08T00:00:00Z",
    slides: [
      slide("s1", 0, "First decision", "Same geometry, different content."),
      slide("s2", 1, "Second decision", "Repeated layout should be recognized."),
    ],
  };
}

test("template intelligence recovers widescreen canvas, type scale, colors and repeated layout signatures", async () => {
  await rm(out, { force: true });
  await compileDeckToPptx(fixture(), out);
  const result = await analyzePptxTemplate(out);
  assert.equal(Math.round(result.canvas.widthDU), 1920);
  assert.equal(Math.round(result.canvas.heightDU), 1080);
  assert(Math.abs(result.canvas.aspectRatio - 16 / 9) < 0.001);
  assert(result.styleStats.fontSizesPt.some(item => item.value === 42));
  assert(result.styleStats.fontSizesPt.some(item => item.value === 22));
  assert(result.styleStats.colors.some(item => item.value === "#335CFF"));
  assert(result.layouts.length >= 1);
  assert.equal(result.layouts[0].count, 2);
  assert.deepEqual(result.layouts[0].slideNumbers, [1, 2]);
  assert.equal(result.layouts[0].objectCount, 3);
  assert(result.recommendations.dominantLayoutSignatures.includes(result.layouts[0].signature));
});

test("template analysis is deterministic for identical source bytes", async () => {
  const bytes = await readFile(out);
  const first = analyzePptxTemplateBytes(bytes);
  const second = analyzePptxTemplateBytes(bytes);
  assert.equal(first.sourceHash, second.sourceHash);
  assert.deepEqual(first.layouts, second.layouts);
  assert.deepEqual(first.recommendations, second.recommendations);
});
