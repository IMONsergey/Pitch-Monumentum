import test from "node:test";
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { compileRichDeckToPptx } from "../packages/pptx-rich/src/index.js";
import { inspectPptx } from "../packages/pptx-roundtrip/src/index.js";

const out = "/tmp/pitchos-rich.pptx";
const png = "/tmp/pitchos-dot.png";
const onePx = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=";
const deck: DeckDocument = {
  schemaVersion: "0.1", id: "rich", title: "Rich", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
  briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T00:00:00Z",
  slides: [{ id: "s1", order: 0, title: "Rich", archetype: "evidence", semantic: { purpose: "show", takeaway: "native media", questionAnswered: "works?", narrativeRole: "evidence", claimIds: [], evidenceRefs: [], audienceRelevance: "board", density: "balanced" }, status: "ready", qaIssueIds: [], dependencyIds: [], scene: [
    { id: "title", type: "text", semanticRole: "title", geometry: { x: 120, y: 100, width: 1000, height: 100 }, zIndex: 1, origin: "deterministic", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Native image + table", fontSizePt: 36 }] }] },
    { id: "img", type: "image", semanticRole: "visual", geometry: { x: 120, y: 300, width: 600, height: 400 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], assetId: "asset", fit: "cover", crop: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 } },
    { id: "table", type: "table", semanticRole: "table", geometry: { x: 850, y: 300, width: 850, height: 420 }, zIndex: 3, origin: "deterministic", exportStrategy: "native", dependencies: [], rows: [[{ text: "Metric" }, { text: "Value" }], [{ text: "CAC" }, { text: "-24%" }]], columnWidths: [0.6, 0.4] }
  ] }]
};

test("rich compiler injects an editable image and a native PowerPoint table", async () => {
  await rm(out, { force: true }); await writeFile(png, Buffer.from(onePx, "base64"));
  const result = await compileRichDeckToPptx(deck, out, { assets: { asset: { path: png, mimeType: "image/png" } } });
  assert.equal(result.richElementResults.length, 2);
  const inspected = await inspectPptx(out);
  assert.equal(inspected.slides[0].pictureCount, 1);
  assert.equal(inspected.slides[0].graphicFrameCount, 1);
  assert.ok(inspected.slides[0].text.includes("CAC"));
  assert.ok(inspected.slides[0].text.includes("-24%"));
});
