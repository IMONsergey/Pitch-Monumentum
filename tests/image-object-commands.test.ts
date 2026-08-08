import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { executeImageObjectCommand } from "../packages/image-object-commands/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Image", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Image", archetype: "freeform", semantic: { purpose: "image", takeaway: "", questionAnswered: "", narrativeRole: "working", claimIds: [], evidenceRefs: [], audienceRelevance: "", density: "sparse" }, scene: [
      { id: "photo", type: "image", semanticRole: "visual", geometry: { x: 100, y: 100, width: 800, height: 500 }, zIndex: 1, origin: "agent", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset" }], assetId: "asset", fit: "cover", alt: "Original" },
      { id: "title", type: "text", semanticRole: "title", geometry: { x: 100, y: 40, width: 800, height: 50 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Title", fontSizePt: 30 }] }] }
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }]
  };
}

test("setCrop changes only image scene object and preserves asset id/geometry", () => {
  const deck = fixture();
  const titleBefore = structuredClone(deck.slides[0].scene[1]);
  const result = executeImageObjectCommand(deck, "s1", "photo", { command: "setCrop", crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.1 } });
  assert.equal(result.changed, true);
  const photo = result.deck.slides[0].scene[0] as any;
  assert.deepEqual(photo.crop, { left: 0.1, top: 0.2, right: 0.3, bottom: 0.1 });
  assert.equal(photo.assetId, "asset");
  assert.deepEqual(photo.geometry, deck.slides[0].scene[0].geometry);
  assert.deepEqual(result.deck.slides[0].scene[1], titleBefore);
  assert.equal(photo.origin, "user");
});

test("cropToAspect uses source dimensions and focal point without changing original asset handle", () => {
  const deck = fixture();
  const result = executeImageObjectCommand(deck, "s1", "photo", { command: "cropToAspect", aspect: 1, focal: { x: 0.9, y: 0.5 } }, { id: "asset", width: 2000, height: 1000 });
  const photo = result.deck.slides[0].scene[0] as any;
  assert.equal(photo.assetId, "asset");
  assert(photo.crop.left > photo.crop.right);
  assert(Math.abs((1 - photo.crop.left - photo.crop.right) * 2000 / 1000 - 1) < 1e-9);
});

test("fit alt corner radius and crop reset are independent bounded commands", () => {
  let deck = fixture();
  deck = executeImageObjectCommand(deck, "s1", "photo", { command: "setFit", fit: "contain" }).deck;
  deck = executeImageObjectCommand(deck, "s1", "photo", { command: "setAlt", alt: "  Product image  " }).deck;
  deck = executeImageObjectCommand(deck, "s1", "photo", { command: "setCornerRadius", radiusDU: 24 }).deck;
  deck = executeImageObjectCommand(deck, "s1", "photo", { command: "setCrop", crop: { left: 0.1 } }).deck;
  deck = executeImageObjectCommand(deck, "s1", "photo", { command: "resetCrop" }).deck;
  const photo = deck.slides[0].scene[0] as any;
  assert.equal(photo.fit, "contain");
  assert.equal(photo.alt, "Product image");
  assert.equal(photo.cornerRadiusDU, 24);
  assert.equal(photo.crop, undefined);
});

test("image commands fail closed on mismatched asset, invalid crop/radius and wrong element type", () => {
  const deck = fixture();
  assert.throws(() => executeImageObjectCommand(deck, "s1", "photo", { command: "cropToAspect", aspect: 1 }, { id: "other", width: 100, height: 100 }), /does not match/);
  assert.throws(() => executeImageObjectCommand(deck, "s1", "photo", { command: "setCrop", crop: { left: 0.7, right: 0.4 } }), /leave some source/);
  assert.throws(() => executeImageObjectCommand(deck, "s1", "photo", { command: "setCornerRadius", radiusDU: -1 }), /non-negative/);
  assert.throws(() => executeImageObjectCommand(deck, "s1", "title", { command: "setFit", fit: "cover" }), /not an image/);
});

test("no-op image command returns original deck object", () => {
  const deck = fixture();
  const result = executeImageObjectCommand(deck, "s1", "photo", { command: "setFit", fit: "cover" });
  assert.equal(result.changed, false);
  assert.equal(result.deck, deck);
});
