import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { compileDeckWithIdentity } from "../packages/pptx-identity/src/index.js";
import { readZipMap } from "../packages/source-ingest/src/zip.js";
import { parseSvgPathData, vectorPathToSvg } from "../packages/vector-path/src/index.js";

function fixture(): DeckDocument {
  const now = new Date().toISOString();
  const pathData = parseSvgPathData("M 0 0 C 0 80 100 80 100 0 L 100 100 L 0 100 Z");
  return {
    schemaVersion: "0.1",
    id: "gradient-vector-deck",
    title: "Gradient vector",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "main", createdAt: now, updatedAt: now,
    slides: [{
      id: "s1", order: 0, title: "Vector", archetype: "freeform",
      semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "balanced" },
      status: "draft", qaIssueIds: [], dependencyIds: [],
      scene: [{
        id: "gradient_vector",
        name: "Gradient Vector",
        type: "shape",
        shape: "custom",
        semanticRole: "visual",
        geometry: { x: 220, y: 180, width: 600, height: 360 },
        zIndex: 1,
        origin: "user",
        exportStrategy: "vector",
        dependencies: [],
        pathData,
        svgPath: vectorPathToSvg(pathData),
        fillPaint: {
          kind: "linearGradient",
          angleDeg: 90,
          stops: [
            { position: 0, color: "#102030", opacity: 1 },
            { position: 0.4, color: "#335CFF", opacity: 0.85 },
            { position: 1, color: "#C7FF5E", opacity: 0.6 },
          ],
        },
        stroke: { color: "#001122", widthDU: 3 },
      }],
    }],
  };
}

test("PowerPoint vector SVG media embeds canonical gradient paint and stable identity", async () => {
  const deck = fixture();
  const output = "/tmp/pitch-vector-gradient.pptx";
  await rm(output, { force: true });
  const compiled = await compileDeckWithIdentity(deck, output, {});
  assert(compiled.elementResults.some((result) => result.elementId === "gradient_vector" && result.strategy === "vector"));
  const entries = readZipMap(await readFile(output));
  const mediaEntry = [...entries.entries()].find(([name]) => /^ppt\/media\/image\d+\.svg$/.test(name));
  assert(mediaEntry, "Expected vector SVG media");
  const svg = mediaEntry![1].toString("utf8");
  assert.match(svg, /<linearGradient id="pitchGradient"/);
  assert.match(svg, /stop-color="#102030"/);
  assert.match(svg, /stop-color="#335CFF"/);
  assert.match(svg, /stop-color="#C7FF5E"/);
  assert.match(svg, /stop-opacity="0.6"/);
  assert.match(svg, /fill="url\(#pitchGradient\)"/);
  const slide = entries.get("ppt/slides/slide1.xml")?.toString("utf8") ?? "";
  assert.match(slide, /descr="pitch:id:gradient_vector"/);
  await rm(output, { force: true });
});
