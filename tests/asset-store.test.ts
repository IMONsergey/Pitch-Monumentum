import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectAssetStore } from "../packages/asset-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7rAAAAAASUVORK5CYII=";

function deck(assetId?: string): DeckDocument {
  return {
    schemaVersion: "0.1", id: "asset_deck", title: "Asset deck", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Image", archetype: "freeform", semantic: { purpose: "test", takeaway: "image", questionAnswered: "image?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: assetId ? [{ id: "img", type: "image", semanticRole: "visual", geometry: { x: 100, y: 100, width: 500, height: 400 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: assetId }], assetId, fit: "cover" }] : [], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

test("project image assets deduplicate by content and expose PPTX rich assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-assets-"));
  try {
    const store = new ProjectAssetStore(root);
    const first = await store.importImage({ filename: "one.png", mimeType: "image/png", dataBase64: PNG, width: 1, height: 1, source: "upload" });
    const second = await store.importImage({ filename: "duplicate.png", mimeType: "image/png", dataBase64: PNG, width: 1, height: 1, source: "clipboard" });
    assert.equal(second.id, first.id);
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.content(first.id)).metadata.sha256, first.sha256);
    const withImage = deck(first.id);
    assert.equal((await store.usage(withImage))[first.id], 1);
    const rich = await store.richAssetMapForDeck(withImage);
    assert.equal(rich[first.id].mimeType, "image/png");
    assert.match(rich[first.id].path, /original\.png$/);
    await assert.rejects(() => store.remove(first.id, withImage), /still used/);
    await store.remove(first.id, deck());
    assert.equal((await store.list()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asset store rejects unsupported and oversized image payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-assets-invalid-"));
  try {
    const store = new ProjectAssetStore(root);
    await assert.rejects(() => store.importImage({ filename: "x.webp", mimeType: "image/webp", dataBase64: PNG }), /Unsupported image type/);
    await assert.rejects(() => store.importImage({ filename: "empty.png", mimeType: "image/png", dataBase64: "" }), /empty/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
