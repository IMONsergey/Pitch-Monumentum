import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, ImageElement, SlideDocument } from "../packages/deck-model/src/index.js";
import { createComponentDefinitionFromSelection, instantiateComponentIntoDeck, refreshComponentInstancesInDeck, resetComponentInstanceInDeck } from "../packages/component-commands/src/index.js";

function slide(): SlideDocument {
  const image: ImageElement = {
    id: "portrait", type: "image", assetId: "asset_master", fit: "cover", semanticRole: "visual",
    geometry: { x: 300, y: 220, width: 500, height: 500 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset_master" }],
  };
  return {
    id: "s1", order: 0, title: "Media component", archetype: "freeform",
    semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
    scene: [image], status: "draft", qaIssueIds: [], dependencyIds: [],
  };
}

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Media component", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides: [slide()],
  };
}

function imageById(value: DeckDocument, id: string): ImageElement {
  const image = value.slides[0].scene.find((element) => element.id === id);
  assert(image?.type === "image");
  return image;
}

test("advanced image slot treatment survives master refresh and Reset restores master media", () => {
  const original = deck();
  const master = createComponentDefinitionFromSelection({ slide: original.slides[0], selectedIds: ["portrait"], name: "Portrait", componentId: "component_portrait" });
  const imageSlot = master.slots.find((slot) => slot.kind === "image");
  assert(imageSlot);

  const inserted = instantiateComponentIntoDeck({
    deck: original,
    slideId: "s1",
    definition: master,
    transform: { x: 900, y: 220 },
    instanceId: "instance_portrait",
    overrides: [{
      slotId: imageSlot.id,
      value: {
        kind: "image",
        assetId: "asset_local",
        alt: "Local art direction",
        fit: "cover",
        crop: { left: .12, top: .05, right: .08, bottom: .03 },
        focalPoint: { x: .78, y: .34 },
        clipShape: "ellipse",
        cornerRadiusDU: 0,
      },
    }],
  });

  const nextMaster = structuredClone(master);
  const masterImage = nextMaster.elements.find((element) => element.id === "portrait");
  assert(masterImage?.type === "image");
  masterImage.assetId = "asset_master_v2";
  masterImage.alt = "Master v2";
  masterImage.fit = "contain";
  masterImage.crop = { left: .02, top: .02, right: .02, bottom: .02 };
  masterImage.focalPoint = { x: .5, y: .5 };
  masterImage.clipShape = "roundRect";
  masterImage.cornerRadiusDU = 36;

  const refreshed = refreshComponentInstancesInDeck(inserted.deck, master, nextMaster);
  const local = imageById(refreshed.deck, "instance_portrait_portrait");
  assert.equal(local.assetId, "asset_local");
  assert.equal(local.alt, "Local art direction");
  assert.equal(local.fit, "cover");
  assert.deepEqual(local.crop, { left: .12, top: .05, right: .08, bottom: .03 });
  assert.deepEqual(local.focalPoint, { x: .78, y: .34 });
  assert.equal(local.clipShape, "ellipse");
  assert.equal(local.cornerRadiusDU, 0);

  const reset = resetComponentInstanceInDeck(refreshed.deck, nextMaster, "instance_portrait");
  const restored = imageById(reset.deck, "instance_portrait_portrait");
  assert.equal(restored.assetId, "asset_master_v2");
  assert.equal(restored.alt, "Master v2");
  assert.equal(restored.fit, "contain");
  assert.deepEqual(restored.crop, { left: .02, top: .02, right: .02, bottom: .02 });
  assert.deepEqual(restored.focalPoint, { x: .5, y: .5 });
  assert.equal(restored.clipShape, "roundRect");
  assert.equal(restored.cornerRadiusDU, 36);
});

test("instance can explicitly clear master focal/clip/radius through image override", () => {
  const original = deck();
  const master = createComponentDefinitionFromSelection({ slide: original.slides[0], selectedIds: ["portrait"], name: "Portrait", componentId: "component_portrait" });
  const masterImage = master.elements.find((element) => element.id === "portrait");
  assert(masterImage?.type === "image");
  masterImage.focalPoint = { x: .8, y: .2 };
  masterImage.clipShape = "roundRect";
  masterImage.cornerRadiusDU = 44;
  const imageSlot = master.slots.find((slot) => slot.kind === "image")!;

  const inserted = instantiateComponentIntoDeck({
    deck: original, slideId: "s1", definition: master, transform: { x: 900, y: 220 }, instanceId: "instance_clear",
    overrides: [{ slotId: imageSlot.id, value: { kind: "image", assetId: "asset_master", focalPoint: null, clipShape: null, cornerRadiusDU: null } }],
  });
  const local = imageById(inserted.deck, "instance_clear_portrait");
  assert.equal(local.focalPoint, undefined);
  assert.equal(local.clipShape, undefined);
  assert.equal(local.cornerRadiusDU, undefined);
});
