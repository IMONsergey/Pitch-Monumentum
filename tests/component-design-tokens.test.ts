import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SlideDocument } from "../packages/deck-model/src/index.js";
import { createComponentDefinitionFromSelection, instantiateComponentIntoDeck, refreshComponentInstancesInDeck } from "../packages/component-commands/src/index.js";
import type { TokenizedSceneElement } from "../packages/design-system/src/index.js";

function slide(): SlideDocument {
  const shape: TokenizedSceneElement = {
    id: "card", type: "shape", shape: "roundRect", fill: "#112233", semanticRole: "visual",
    geometry: { x: 200, y: 200, width: 600, height: 320 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [],
    tokenBindings: { fill: "primary" },
  };
  return {
    id: "s1", order: 0, title: "Tokens", archetype: "freeform",
    semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
    scene: [shape], status: "draft", qaIssueIds: [], dependencyIds: [],
  };
}

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Tokens", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides: [slide()],
  };
}

test("component definition and linked instance retain canonical token bindings", () => {
  const original = deck();
  const master = createComponentDefinitionFromSelection({ slide: original.slides[0], selectedIds: ["card"], name: "Card", componentId: "component_card" });
  assert.equal((master.elements[0] as TokenizedSceneElement).tokenBindings?.fill, "primary");

  const inserted = instantiateComponentIntoDeck({ deck: original, slideId: "s1", definition: master, transform: { x: 900, y: 200 }, instanceId: "instance_card" });
  const instance = inserted.deck.slides[0].scene.find(element => element.id === "instance_card_card") as TokenizedSceneElement;
  assert.equal(instance.tokenBindings?.fill, "primary");

  const nextMaster = structuredClone(master);
  (nextMaster.elements[0] as any).fill = "#334455";
  const refreshed = refreshComponentInstancesInDeck(inserted.deck, master, nextMaster);
  const refreshedInstance = refreshed.deck.slides[0].scene.find(element => element.id === "instance_card_card") as TokenizedSceneElement;
  assert.equal(refreshedInstance.tokenBindings?.fill, "primary");
  assert.equal((refreshedInstance as any).fill, "#334455");
});
