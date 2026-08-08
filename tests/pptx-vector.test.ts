import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { compileDeckWithVectors } from "../packages/pptx-vector/src/index.js";
import { readZipMap } from "../packages/source-ingest/src/zip.js";

const out = "/tmp/pitch-custom-vector.pptx";

function fixture(svgPath = "M 0 80 C 80 0 160 160 240 80 L 320 140 Z"): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "vector_deck",
    title: "Vector",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief",
    narrativeId: "narrative",
    designSystemId: "design",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z",
    updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1",
      order: 0,
      title: "Vector",
      archetype: "freeform",
      semantic: { purpose: "test vector export", takeaway: "path survives", questionAnswered: "does it stay vector?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
      scene: [
        { id: "back", type: "shape", semanticRole: "decoration", geometry: { x: 60, y: 60, width: 500, height: 260 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#F4F5F7" },
        { id: "path", type: "shape", name: "Freeform Path", semanticRole: "visual", geometry: { x: 120, y: 100, width: 320, height: 160, rotation: 12 }, zIndex: 2, origin: "user", exportStrategy: "vector", dependencies: [], shape: "custom", fill: "#335CFF", stroke: { color: "#111111", widthDU: 3, dash: "dash" }, svgPath },
        { id: "front", type: "text", semanticRole: "label", geometry: { x: 170, y: 130, width: 220, height: 60 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "ABOVE VECTOR", fontSizePt: 18, color: "#111111" }] }] },
      ],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

test("custom SVG shape replaces its marker in-place with vector SVG media", async () => {
  await rm(out, { force: true });
  const result = await compileDeckWithVectors(fixture(), out);
  const buffer = await readFile(out);
  const zip = readZipMap(buffer);
  const svgEntries = [...zip.keys()].filter((name) => /^ppt\/media\/image\d+\.svg$/.test(name));
  assert.equal(svgEntries.length, 1);
  const svg = zip.get(svgEntries[0])!.toString("utf8");
  assert.match(svg, /<svg\b/);
  assert.match(svg, /<path\b/);
  assert.match(svg, /C 80 0 160 160 240 80/);
  assert.match(svg, /stroke-dasharray=/);

  const slide = zip.get("ppt/slides/slide1.xml")!.toString("utf8");
  assert.match(slide, /<p:pic>/);
  assert.doesNotMatch(slide, /__pitch_custom_vector_/);
  assert.doesNotMatch(slide, /name="Freeform Path"[^>]*>.*?<a:prstGeom prst="rect"/s);
  const backIndex = slide.indexOf('name="back"');
  const vectorIndex = slide.indexOf('name="Freeform Path"');
  const frontIndex = slide.indexOf('name="front"');
  assert(backIndex >= 0 && vectorIndex >= 0 && frontIndex >= 0);
  assert(backIndex < vectorIndex && vectorIndex < frontIndex, "vector replacement must preserve spTree z-order");

  const rels = zip.get("ppt/slides/_rels/slide1.xml.rels")!.toString("utf8");
  assert.match(rels, /relationships\/image/);
  assert.match(rels, /\.\.\/media\/image\d+\.svg/);
  assert.match(zip.get("[Content_Types].xml")!.toString("utf8"), /Extension="svg" ContentType="image\/svg\+xml"/);

  const vectorResult = result.elementResults.find((entry) => entry.elementId === "path");
  assert.equal(vectorResult?.strategy, "vector");
  assert.match(vectorResult?.warnings[0] ?? "", /SVG media/);
  assert.equal(result.elementResults.find((entry) => entry.elementId === "back")?.strategy, "native");
  assert.equal(result.elementResults.find((entry) => entry.elementId === "front")?.strategy, "native");
});

test("custom shape without svgPath fails instead of exporting a fake rectangle", async () => {
  const deck = fixture("");
  await assert.rejects(() => compileDeckWithVectors(deck, "/tmp/pitch-invalid-vector.pptx"), /missing svgPath/);
});
