import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SceneElement, SlideDocument } from "../packages/deck-model/src/index.js";
import { createComponentDefinitionFromSelection, instantiateComponentIntoDeck } from "../packages/component-commands/src/index.js";

function baseSlide(): SlideDocument {
  return {
    id: "s1", order: 0, title: "Component identity", archetype: "freeform",
    semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
    scene: [
      { id: "card", type: "frame", childIds: ["label"], fill: "#EEEEEE", semanticRole: "visual", geometry: { x: 100, y: 100, width: 500, height: 280 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "label", type: "text", groupId: "card", paragraphs: [{ runs: [{ text: "Master", fontSizePt: 28 }] }], semanticRole: "title", geometry: { x: 150, y: 150, width: 380, height: 70 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [] },
    ],
    status: "draft", qaIssueIds: [], dependencyIds: [],
  };
}

function baseDeck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Component identity", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides: [baseSlide()],
  };
}

test("authoring a new master from a linked instance preserves old source IDs and assigns IDs only to new elements", () => {
  const deck = baseDeck();
  const master = createComponentDefinitionFromSelection({ slide: deck.slides[0], selectedIds: ["card"], name: "Card", componentId: "component_card" });
  const inserted = instantiateComponentIntoDeck({ deck, slideId: "s1", definition: master, transform: { x: 800, y: 100 }, instanceId: "instance_card" });
  const slide = structuredClone(inserted.deck.slides[0]);
  const newBadge: SceneElement = {
    id: "new_badge", type: "shape", shape: "ellipse", fill: "#FF3366", semanticRole: "decoration",
    geometry: { x: 1250, y: 140, width: 60, height: 60 }, zIndex: 10, origin: "user", exportStrategy: "native", dependencies: [],
  };
  slide.scene.push(newBadge);

  const updated = createComponentDefinitionFromSelection({
    slide,
    selectedIds: ["instance_card_card", "new_badge"],
    name: "Card v2",
    componentId: "component_card",
  });

  const ids = new Set(updated.elements.map((element) => element.id));
  assert(ids.has("card"), "linked root should keep its master source id");
  assert(ids.has("label"), "linked child should keep its master source id");
  assert(ids.has("new_badge"), "new object should receive its own new source id");
  assert.equal(ids.has("instance_card_card"), false);
  assert.equal(ids.has("instance_card_label"), false);
  assert(updated.elements.every((element) => !(element.tags ?? []).some((tag) => tag.startsWith("component:"))), "master must not persist instance tags");
  assert(updated.elements.every((element) => !(element.tags ?? []).some((tag) => tag.startsWith("component-source:"))), "master must not persist source tags");
  assert(updated.slots.some((slot) => slot.kind === "text" && slot.targetElementId === "label"));
});
