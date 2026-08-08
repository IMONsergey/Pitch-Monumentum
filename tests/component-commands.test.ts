import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SlideDocument } from "../packages/deck-model/src/index.js";
import { componentInstanceId, createComponentDefinitionFromSelection, detachComponentFromDeck, instantiateComponentIntoDeck } from "../packages/component-commands/src/index.js";

function slide(): SlideDocument {
  return {
    id: "slide_1", order: 0, title: "Components", archetype: "freeform",
    semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
    scene: [
      { id: "frame", type: "frame", childIds: ["title"], fill: "#EEEEEE", semanticRole: "visual", geometry: { x: 400, y: 300, width: 600, height: 320 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "title", type: "text", groupId: "frame", paragraphs: [{ runs: [{ text: "Reusable title", fontSizePt: 32 }] }], semanticRole: "title", geometry: { x: 460, y: 360, width: 480, height: 80 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [] },
    ],
    status: "draft", qaIssueIds: [], dependencyIds: [],
  };
}

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck_components", title: "Components",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", slides: [slide()], sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

test("selection becomes a localized reusable component with automatic slots", () => {
  const definition = createComponentDefinitionFromSelection({ slide: slide(), selectedIds: ["frame"], name: "Hero card", componentId: "component_hero" });
  assert.equal(definition.widthDU, 600);
  assert.equal(definition.heightDU, 320);
  assert.deepEqual(definition.rootIds, ["frame"]);
  assert.equal(definition.elements.find((element) => element.id === "frame")?.geometry.x, 0);
  assert.equal(definition.elements.find((element) => element.id === "title")?.geometry.x, 60);
  assert(definition.slots.some((slot) => slot.kind === "text" && slot.targetElementId === "title"));
});

test("component instance is inserted with stable tags and can detach without deleting content", () => {
  const original = deck();
  const definition = createComponentDefinitionFromSelection({ slide: original.slides[0], selectedIds: ["frame"], name: "Hero card", componentId: "component_hero" });
  const inserted = instantiateComponentIntoDeck({ deck: original, slideId: "slide_1", definition, transform: { x: 1100, y: 300 }, instanceId: "instance_demo" });
  assert.equal(inserted.deck.slides[0].scene.length, 4);
  const instanceRoot = inserted.deck.slides[0].scene.find((element) => element.id === "instance_demo_frame");
  assert(instanceRoot);
  assert.equal(componentInstanceId(instanceRoot), "instance_demo");
  assert(instanceRoot.tags?.includes("component-def:component_hero"));
  assert.deepEqual(inserted.nextSelectionIds, ["instance_demo_frame"]);

  const detached = detachComponentFromDeck(inserted.deck, "slide_1", "instance_demo");
  assert.equal(detached.deck.slides[0].scene.length, 4);
  const detachedRoot = detached.deck.slides[0].scene.find((element) => element.id === "instance_demo_frame")!;
  assert.equal(componentInstanceId(detachedRoot), undefined);
  assert.equal(detachedRoot.tags?.some((tag) => tag.startsWith("component-def:")), false);
});
