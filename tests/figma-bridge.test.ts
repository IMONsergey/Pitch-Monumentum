import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { AssetRegistry } from "../packages/assets/src/index.js";
import { createFigmaBridgeBundle, writeFigmaBridgeBundle } from "../packages/figma-bridge/src/index.js";

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=",
  "base64",
);

function fixture(assetId: string): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "figma_deck",
    title: "Figma Bridge",
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
      title: "Native slide",
      archetype: "freeform",
      semantic: {
        purpose: "test",
        takeaway: "Native Figma objects",
        questionAnswered: "Does bridge preserve objects?",
        narrativeRole: "test",
        claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "balanced",
      },
      scene: [
        {
          id: "frame",
          type: "frame",
          semanticRole: "visual",
          geometry: { x: 100, y: 100, width: 800, height: 300 },
          zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [],
          childIds: ["text", "image"],
          layout: {
            direction: "horizontal", gapDU: 24,
            padding: { top: 24, right: 24, bottom: 24, left: 24 },
            justify: "start", align: "center", widthSizing: "fixed", heightSizing: "fixed",
          },
        },
        {
          id: "text", type: "text", semanticRole: "title",
          geometry: { x: 124, y: 124, width: 360, height: 100 }, zIndex: 2,
          origin: "user", exportStrategy: "native", dependencies: [],
          paragraphs: [{ runs: [
            { text: "Pitch ", fontFamily: "Inter", fontSizePt: 32, color: "#111111" },
            { text: "Figma", fontFamily: "Inter", fontSizePt: 32, bold: true, color: "#111111" },
          ] }],
          layoutItem: { width: "fixed", height: "fixed" },
        },
        {
          id: "image", type: "image", semanticRole: "visual",
          geometry: { x: 508, y: 124, width: 200, height: 200 }, zIndex: 3,
          origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: assetId }],
          assetId, fit: "cover", layoutItem: { width: "fixed", height: "fixed" },
        },
      ],
      status: "draft", qaIssueIds: [], dependencyIds: [],
    }],
  };
}

test("Figma bridge bundle embeds exact original image bytes and canonical Auto Layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-figma-bridge-"));
  try {
    const registry = new AssetRegistry(root);
    const asset = await registry.registerImage({
      bytes: ONE_PX_PNG,
      originalName: "source.png",
      provenance: { source: "import" },
    });
    const deck = fixture(asset.id);
    const bundle = await createFigmaBridgeBundle(deck, registry);
    assert.equal(bundle.kind, "pitch-figma-bridge");
    assert.equal(bundle.deck.slides[0].scene[0].type, "frame");
    const frame = bundle.deck.slides[0].scene[0] as any;
    assert.equal(frame.layout.direction, "horizontal");
    assert.equal(frame.layout.gapDU, 24);
    assert(Buffer.from(bundle.assets[asset.id].bytesBase64, "base64").equals(ONE_PX_PNG));
    assert.equal(bundle.warnings.length, 0);

    const output = join(root, "exports", "deck.pitch-figma.json");
    await writeFigmaBridgeBundle(deck, registry, output);
    const disk = JSON.parse(await readFile(output, "utf8"));
    assert.equal(disk.deck.id, "figma_deck");
    assert.equal(disk.assets[asset.id].contentHash, asset.contentHash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Figma bridge reports unsupported scene types instead of silently dropping them", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-figma-warning-"));
  try {
    const registry = new AssetRegistry(root);
    const asset = await registry.registerImage({ bytes: ONE_PX_PNG, originalName: "source.png", provenance: { source: "import" } });
    const deck = fixture(asset.id);
    deck.slides[0].scene.push({
      id: "chart", type: "chart", semanticRole: "chart",
      geometry: { x: 1000, y: 100, width: 600, height: 400 }, zIndex: 4,
      origin: "user", exportStrategy: "native", dependencies: [],
      chart: { chartType: "bar", categories: ["A"], series: [{ name: "Series", values: [1] }], insightStatement: "A", dataSourceRefs: [] },
    });
    const bundle = await createFigmaBridgeBundle(deck, registry);
    assert(bundle.warnings.some((warning) => warning.elementId === "chart" && warning.code === "unsupported-element"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
