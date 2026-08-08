import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, ImageElement } from "../packages/deck-model/src/index.js";
import { executeMediaCommand, validateImageCrop } from "../packages/media-commands/src/index.js";

function fixture(): DeckDocument {
  const image: ImageElement = {
    id: "image_1", type: "image", assetId: "asset_a", fit: "cover", alt: "Original",
    semanticRole: "visual", geometry: { x: 120, y: 140, width: 900, height: 560 }, zIndex: 1,
    origin: "user", exportStrategy: "native", dependencies: [],
  };
  return {
    schemaVersion: "0.1", id: "deck_media", title: "Media",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{ id: "slide_1", order: 0, title: "Image", archetype: "freeform", semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [image], status: "ready", qaIssueIds: [], dependencyIds: [] }],
  };
}

function image(deck: DeckDocument): ImageElement {
  return deck.slides[0].scene[0] as ImageElement;
}

test("media commands edit crop, fit, radius and asset without mutating input", () => {
  const original = fixture();
  let result = executeMediaCommand(original, { command: "setImageCrop", slideId: "slide_1", elementId: "image_1", crop: { left: .1, top: .05, right: .15, bottom: .1 } });
  assert.deepEqual(image(result.deck).crop, { left: .1, top: .05, right: .15, bottom: .1 });
  assert.equal(image(original).crop, undefined);

  result = executeMediaCommand(result.deck, { command: "setImageFit", slideId: "slide_1", elementId: "image_1", fit: "contain" });
  result = executeMediaCommand(result.deck, { command: "setImageCornerRadius", slideId: "slide_1", elementId: "image_1", cornerRadiusDU: 32 });
  result = executeMediaCommand(result.deck, { command: "replaceImageAsset", slideId: "slide_1", elementId: "image_1", assetId: "asset_b", alt: "Replacement" });
  assert.equal(image(result.deck).fit, "contain");
  assert.equal(image(result.deck).cornerRadiusDU, 32);
  assert.equal(image(result.deck).assetId, "asset_b");
  assert.equal(image(result.deck).alt, "Replacement");
  assert.equal(result.deck.slides[0].status, "draft");
});

test("crop validation rejects invisible and invalid crops", () => {
  assert.throws(() => validateImageCrop({ left: .6, right: .5, top: 0, bottom: 0 }), /visible width/);
  assert.throws(() => validateImageCrop({ left: -.1, right: 0, top: 0, bottom: 0 }), /between 0/);
});
