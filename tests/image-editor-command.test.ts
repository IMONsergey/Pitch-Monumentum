import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { executeEditorCommand } from "../packages/editor-commands/src/service.js";
import { applyDeckMutation, createMutation } from "../packages/mutations/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "image_command_deck", title: "Image command", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Slide", archetype: "freeform", semantic: { purpose: "test", takeaway: "image", questionAnswered: "image?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

test("insertImage creates an editable native image linked to the project asset", () => {
  const deck = fixture();
  const executed = executeEditorCommand(deck, { command: "insertImage", slideId: "s1", assetId: "asset_0123456789abcdef0123", geometry: { x: 120, y: 160, width: 720, height: 480 }, alt: "Product photo", fit: "contain", name: "Hero photo" });
  assert.equal(executed.operations.length, 1);
  const next = applyDeckMutation(deck, createMutation(executed.reason, executed.operations)).deck;
  const image = next.slides[0].scene[0];
  assert.equal(image.type, "image");
  if (image.type !== "image") throw new Error("Expected image");
  assert.equal(image.assetId, "asset_0123456789abcdef0123");
  assert.equal(image.fit, "contain");
  assert.equal(image.alt, "Product photo");
  assert.equal(image.name, "Hero photo");
  assert.equal(image.exportStrategy, "native");
  assert.deepEqual(image.dependencies, [{ kind: "asset", id: "asset_0123456789abcdef0123" }]);
  assert.deepEqual(executed.nextSelectionIds, [image.id]);
});
