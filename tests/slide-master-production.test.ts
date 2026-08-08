import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SlideDocument } from "../packages/deck-model/src/index.js";
import { executeProductionSlideMasterCommand } from "../packages/slide-master-commands/src/production.js";
import { slidePlaceholderId } from "../packages/slide-masters/src/index.js";

function semantic() { return { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" as const }; }
function slide(id: string, order: number, text: string, template = false): SlideDocument { return { id, order, title: text, archetype: "freeform", semantic: semantic(), status: "draft", qaIssueIds: [], dependencyIds: [], scene: [
  { id: `${id}_title`, type: "text", semanticRole: "title", geometry: { x: template ? 120 : 300, y: template ? 100 : 160, width: 1400, height: 160 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], fitPolicy: "shrinkText", paragraphs: [{ align: template ? "left" : "center", runs: [{ text, fontFamily: template ? "Inter" : "Arial", fontSizePt: template ? 54 : 68, color: template ? "#FFFFFF" : "#111111", bold: template ? true : undefined }] }] },
] }; }
function deck(): DeckDocument { return { schemaVersion: "0.1", id: "deck", title: "Master style", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides: [slide("template",0,"Master",true), slide("s1",1,"Alpha"), slide("s2",2,"Beta")] }; }
function title(slide: SlideDocument): any { return slide.scene.find(element => slidePlaceholderId(element)?.includes("title")); }

test("production path applies master typography while preserving each slide text", () => {
  let result = executeProductionSlideMasterCommand(deck(), { command: "createMaster", slideId: "template", name: "Editorial", masterId: "master" });
  result = executeProductionSlideMasterCommand(result.deck, { command: "applyMaster", slideId: "s1", masterId: "master", instanceId: "i1" });
  result = executeProductionSlideMasterCommand(result.deck, { command: "applyMaster", slideId: "s2", masterId: "master", instanceId: "i2" });
  let s1 = result.deck.slides.find(item => item.id === "s1")!;
  let s2 = result.deck.slides.find(item => item.id === "s2")!;
  assert.equal(title(s1).paragraphs[0].runs[0].text, "Alpha");
  assert.equal(title(s1).paragraphs[0].runs[0].fontFamily, "Inter");
  assert.equal(title(s1).paragraphs[0].runs[0].fontSizePt, 54);
  assert.equal(title(s1).paragraphs[0].align, "left");

  const edited = structuredClone(result.deck);
  s1 = edited.slides.find(item => item.id === "s1")!;
  const authored = title(s1);
  authored.geometry.x = 240;
  authored.paragraphs[0].runs[0].fontSizePt = 62;
  authored.paragraphs[0].runs[0].color = "#FFDD00";
  authored.paragraphs[0].align = "right";
  result = executeProductionSlideMasterCommand(edited, { command: "updateMasterFromSlide", slideId: "s1", masterId: "master" });
  s2 = result.deck.slides.find(item => item.id === "s2")!;
  const beta = title(s2);
  assert.equal(beta.paragraphs[0].runs[0].text, "Beta");
  assert.equal(beta.paragraphs[0].runs[0].fontSizePt, 62);
  assert.equal(beta.paragraphs[0].runs[0].color, "#FFDD00");
  assert.equal(beta.paragraphs[0].align, "right");
  assert.equal(beta.geometry.x, 240);
});
