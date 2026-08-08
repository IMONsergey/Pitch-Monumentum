import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SlideDocument } from "../packages/deck-model/src/index.js";
import { executeSlideMasterCommand, recommendMastersForSlide, type MasteredDeckDocument } from "../packages/slide-master-commands/src/index.js";
import { slideMasterId, slidePlaceholderId } from "../packages/slide-masters/src/index.js";

function semantic() { return { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" as const }; }
function template(): SlideDocument { return { id: "template", order: 0, title: "Template", archetype: "freeform", semantic: semantic(), status: "draft", qaIssueIds: [], dependencyIds: [], scene: [
  { id: "bg", type: "shape", shape: "rect", fill: "#101112", semanticRole: "decoration", geometry: { x: 0, y: 0, width: 1920, height: 1080 }, zIndex: 0, origin: "user", exportStrategy: "native", dependencies: [] },
  { id: "title", type: "text", semanticRole: "title", geometry: { x: 120, y: 100, width: 1500, height: 150 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Template title", color: "#FFFFFF", fontSizePt: 56 }] }] },
  { id: "body", type: "text", semanticRole: "body", geometry: { x: 120, y: 320, width: 1000, height: 400 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Template body", color: "#CCCCCC", fontSizePt: 26 }] }] },
] }; }
function content(id: string, order: number, titleText: string): SlideDocument { return { id, order, title: titleText, archetype: "freeform", semantic: semantic(), status: "draft", qaIssueIds: [], dependencyIds: [], scene: [
  { id: `${id}_title`, type: "text", semanticRole: "title", geometry: { x: 300, y: 80, width: 1200, height: 180 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: titleText, fontSizePt: 60 }] }] },
  { id: `${id}_body`, type: "text", semanticRole: "body", geometry: { x: 300, y: 340, width: 1100, height: 300 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: `${titleText} body`, fontSizePt: 28 }] }] },
] }; }
function deck(): DeckDocument { return { schemaVersion: "0.1", id: "deck", title: "Masters", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides: [template(), content("s1",1,"Alpha"), content("s2",2,"Beta")] }; }
function placeholder(slide: SlideDocument, id: string): any { return slide.scene.find(element => slidePlaceholderId(element) === id); }

test("Update Master propagates layout while preserving per-slide placeholder content and stable IDs", () => {
  let state = executeSlideMasterCommand(deck(), { command: "createMaster", slideId: "template", name: "Editorial", masterId: "master_editorial" });
  state = executeSlideMasterCommand(state.deck, { command: "applyMaster", slideId: "s1", masterId: "master_editorial", instanceId: "layout_s1" });
  state = executeSlideMasterCommand(state.deck, { command: "applyMaster", slideId: "s2", masterId: "master_editorial", instanceId: "layout_s2" });
  const beforeS1 = state.deck.slides.find(slide => slide.id === "s1")!;
  const beforeS2 = state.deck.slides.find(slide => slide.id === "s2")!;
  const s1TitleId = placeholder(beforeS1, "placeholder_title").id;
  const s2TitleId = placeholder(beforeS2, "placeholder_title").id;
  assert.equal(placeholder(beforeS2, "placeholder_title").paragraphs[0].runs[0].text, "Beta");

  const edited = structuredClone(state.deck) as MasteredDeckDocument;
  const s1 = edited.slides.find(slide => slide.id === "s1")!;
  const title = placeholder(s1, "placeholder_title");
  title.geometry = { x: 220, y: 180, width: 1180, height: 190 };
  title.paragraphs[0].runs[0].color = "#FFDD00";

  const updated = executeSlideMasterCommand(edited, { command: "updateMasterFromSlide", slideId: "s1", masterId: "master_editorial" });
  const afterS1 = updated.deck.slides.find(slide => slide.id === "s1")!;
  const afterS2 = updated.deck.slides.find(slide => slide.id === "s2")!;
  const afterS1Title = placeholder(afterS1, "placeholder_title");
  const afterS2Title = placeholder(afterS2, "placeholder_title");
  assert.equal(afterS1Title.id, s1TitleId);
  assert.equal(afterS2Title.id, s2TitleId);
  assert.deepEqual(afterS2Title.geometry, { x: 220, y: 180, width: 1180, height: 190 });
  assert.equal(afterS2Title.paragraphs[0].runs[0].text, "Beta");
  assert.equal(afterS2Title.paragraphs[0].runs[0].color, undefined);
  const master = (updated.deck as MasteredDeckDocument).slideMasters?.master_editorial;
  assert(master);
  assert.deepEqual(master.elements.find(element => element.id === "title")?.geometry, { x: 220, y: 180, width: 1180, height: 190 });
  assert.deepEqual(updated.affectedSlideIds.sort(), ["s1", "s2"]);
});

test("applied master can be detached without losing editable scene objects", () => {
  let state = executeSlideMasterCommand(deck(), { command: "createMaster", slideId: "template", name: "Editorial", masterId: "master_editorial" });
  state = executeSlideMasterCommand(state.deck, { command: "applyMaster", slideId: "s1", masterId: "master_editorial", instanceId: "layout_s1" });
  const detached = executeSlideMasterCommand(state.deck, { command: "detachMaster", slideId: "s1" });
  const slide = detached.deck.slides.find(item => item.id === "s1")!;
  assert.equal(slide.scene.some(element => Boolean(slideMasterId(element))), false);
  assert(slide.scene.some(element => (element as any).paragraphs?.[0]?.runs?.[0]?.text === "Alpha"));
});

test("master recommendations are available from deck-local definitions", () => {
  let state = executeSlideMasterCommand(deck(), { command: "createMaster", slideId: "template", name: "Editorial", masterId: "master_editorial" });
  const recommendations = recommendMastersForSlide(state.deck, "s1");
  assert.equal(recommendations[0].masterId, "master_editorial");
});
