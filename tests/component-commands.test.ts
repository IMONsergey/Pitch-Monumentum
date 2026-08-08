import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SceneElement, SlideDocument } from "../packages/deck-model/src/index.js";
import {
  componentDefinitionId,
  componentInstanceId,
  componentInstanceSummaries,
  componentSourceElementId,
  createComponentDefinitionFromSelection,
  detachComponentFromDeck,
  instantiateComponentIntoDeck,
  refreshComponentInstancesInDeck,
  resetComponentInstanceInDeck,
} from "../packages/component-commands/src/index.js";
import type { ComponentDefinition } from "../packages/components/src/index.js";

function slide(): SlideDocument {
  return {
    id: "slide_1", order: 0, title: "Components", archetype: "freeform",
    semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
    scene: [
      { id: "bg", type: "shape", shape: "rect", fill: "#111111", semanticRole: "decoration", geometry: { x: 0, y: 0, width: 1920, height: 1080 }, zIndex: 20, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "frame", type: "frame", childIds: ["title"], fill: "#EEEEEE", semanticRole: "visual", geometry: { x: 400, y: 300, width: 600, height: 320 }, zIndex: 21, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "title", type: "text", groupId: "frame", paragraphs: [{ runs: [{ text: "Reusable title", fontSizePt: 32 }] }], semanticRole: "title", geometry: { x: 460, y: 360, width: 480, height: 80 }, zIndex: 22, origin: "user", exportStrategy: "native", dependencies: [] },
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

function textOf(element: SceneElement | undefined): string | undefined {
  return element?.type === "text" ? element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join("") : undefined;
}

function revisedDefinition(previous: ComponentDefinition): ComponentDefinition {
  const next = structuredClone(previous);
  next.elements = next.elements.map((element) => {
    if (element.id === "frame" && element.type === "frame") return { ...element, fill: "#FFD700" };
    if (element.id === "title" && element.type === "text") return { ...element, paragraphs: [{ runs: [{ text: "Master title v2", fontSizePt: 32 }] }] };
    return element;
  });
  const badge: SceneElement = {
    id: "badge", type: "shape", shape: "ellipse", fill: "#FF3366", semanticRole: "decoration",
    geometry: { x: 500, y: 30, width: 60, height: 60 }, zIndex: 23, origin: "user", exportStrategy: "native", dependencies: [],
  };
  next.elements.push(badge);
  next.rootIds.push("badge");
  return next;
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

test("component instance is inserted above existing content with stable source tags and can detach", () => {
  const original = deck();
  const definition = createComponentDefinitionFromSelection({ slide: original.slides[0], selectedIds: ["frame"], name: "Hero card", componentId: "component_hero" });
  const inserted = instantiateComponentIntoDeck({ deck: original, slideId: "slide_1", definition, transform: { x: 1100, y: 300 }, instanceId: "instance_demo" });
  assert.equal(inserted.deck.slides[0].scene.length, 5);
  const instanceRoot = inserted.deck.slides[0].scene.find((element) => element.id === "instance_demo_frame");
  assert(instanceRoot);
  assert.equal(componentInstanceId(instanceRoot), "instance_demo");
  assert.equal(componentDefinitionId(instanceRoot), "component_hero");
  assert.equal(componentSourceElementId(instanceRoot), "frame");
  assert((instanceRoot.zIndex ?? 0) > 22, "linked instance should be placed above existing scene content");
  assert.deepEqual(inserted.nextSelectionIds, ["instance_demo_frame"]);

  const detached = detachComponentFromDeck(inserted.deck, "slide_1", "instance_demo");
  assert.equal(detached.deck.slides[0].scene.length, 5);
  const detachedRoot = detached.deck.slides[0].scene.find((element) => element.id === "instance_demo_frame")!;
  assert.equal(componentInstanceId(detachedRoot), undefined);
  assert.equal(componentDefinitionId(detachedRoot), undefined);
  assert.equal(componentSourceElementId(detachedRoot), undefined);
});

test("master refresh propagates structure and style while preserving instance override, then reset clears it", () => {
  const original = deck();
  const definition = createComponentDefinitionFromSelection({ slide: original.slides[0], selectedIds: ["frame"], name: "Hero card", componentId: "component_hero" });
  const textSlot = definition.slots.find((slot) => slot.kind === "text" && slot.targetElementId === "title");
  assert(textSlot);

  const first = instantiateComponentIntoDeck({
    deck: original, slideId: "slide_1", definition, transform: { x: 50, y: 620 }, instanceId: "instance_a",
    overrides: [{ slotId: textSlot.id, value: { kind: "text", paragraphs: [{ runs: [{ text: "Local A", fontSizePt: 32 }] }] } }],
  });
  const second = instantiateComponentIntoDeck({ deck: first.deck, slideId: "slide_1", definition, transform: { x: 900, y: 620 }, instanceId: "instance_b" });
  assert.equal(componentInstanceSummaries(second.deck).length, 2);

  const nextDefinition = revisedDefinition(definition);
  const refreshed = refreshComponentInstancesInDeck(second.deck, definition, nextDefinition);
  assert.equal(refreshed.changed, true);
  assert.equal(refreshed.affectedSlideIds.length, 1);

  const scene = refreshed.deck.slides[0].scene;
  assert.equal(textOf(scene.find((element) => element.id === "instance_a_title")), "Local A");
  assert.equal(textOf(scene.find((element) => element.id === "instance_b_title")), "Master title v2");
  const aFrame = scene.find((element) => element.id === "instance_a_frame");
  const bFrame = scene.find((element) => element.id === "instance_b_frame");
  assert.equal(aFrame?.type === "frame" ? aFrame.fill : undefined, "#FFD700");
  assert.equal(bFrame?.type === "frame" ? bFrame.fill : undefined, "#FFD700");
  assert(scene.some((element) => element.id === "instance_a_badge"));
  assert(scene.some((element) => element.id === "instance_b_badge"));

  const reset = resetComponentInstanceInDeck(refreshed.deck, nextDefinition, "instance_a");
  assert.equal(textOf(reset.deck.slides[0].scene.find((element) => element.id === "instance_a_title")), "Master title v2");
  assert(reset.nextSelectionIds.includes("instance_a_frame"));
});

test("refresh tolerates a removed slot and drops the stale override", () => {
  const original = deck();
  const definition = createComponentDefinitionFromSelection({ slide: original.slides[0], selectedIds: ["frame"], name: "Hero card", componentId: "component_hero" });
  const textSlot = definition.slots.find((slot) => slot.kind === "text")!;
  const inserted = instantiateComponentIntoDeck({
    deck: original, slideId: "slide_1", definition, transform: { x: 1000, y: 300 }, instanceId: "instance_removed_slot",
    overrides: [{ slotId: textSlot.id, value: { kind: "text", paragraphs: [{ runs: [{ text: "Local", fontSizePt: 32 }] }] } }],
  });
  const next = structuredClone(definition);
  next.slots = next.slots.filter((slot) => slot.id !== textSlot.id);
  const refreshed = refreshComponentInstancesInDeck(inserted.deck, definition, next);
  assert.equal(textOf(refreshed.deck.slides[0].scene.find((element) => element.id === "instance_removed_slot_title")), "Reusable title");
});
