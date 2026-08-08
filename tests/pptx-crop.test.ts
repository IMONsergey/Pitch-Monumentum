import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { compileDeckWithRichNativeElements } from "../packages/pptx-rich/src/index.js";
import { readZipMap } from "../packages/source-ingest/src/zip.js";

const png = "/tmp/pitch-crop-original.png";
const out = "/tmp/pitch-crop.pptx";
const ONE_PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=", "base64");

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "crop",
    title: "Crop",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1", order: 0, title: "Crop", archetype: "freeform",
      semantic: { purpose: "test", takeaway: "", questionAnswered: "", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "", density: "sparse" },
      scene: [{
        id: "photo", type: "image", semanticRole: "visual", geometry: { x: 200, y: 160, width: 800, height: 500 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], assetId: "photo_asset", fit: "cover",
        crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.25 },
      }],
      status: "draft", qaIssueIds: [], dependencyIds: [],
    }],
  };
}

test("PowerPoint source rectangle uses normalized Pitch crop fractions without touching original asset bytes", async () => {
  await rm(out, { force: true });
  await writeFile(png, ONE_PX);
  const result = await compileDeckWithRichNativeElements(fixture(), out, { assets: { photo_asset: { path: png, mimeType: "image/png" } } });
  assert.equal(result.elementResults.find(item => item.elementId === "photo")?.strategy, "native");
  assert.deepEqual(await readFile(png), ONE_PX, "export must not rewrite the original file");
  const zip = readZipMap(await readFile(out));
  const slide = zip.get("ppt/slides/slide1.xml")!.toString("utf8");
  assert.match(slide, /<a:srcRect\s+l="10000"\s+t="20000"\s+r="30000"\s+b="25000"\s*\/>/);
});
