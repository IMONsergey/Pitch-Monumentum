import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SlideDocument } from "../packages/deck-model/src/index.js";
import { executeProductionSlideMasterCommand } from "../packages/slide-master-commands/src/production.js";
import { runSlideMasterQA } from "../packages/slide-master-qa/src/index.js";

function semantic() { return { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" as const }; }
function template(): SlideDocument { return { id: "template", order: 0, title: "Template", archetype: "freeform", semantic: semantic(), status: "draft", qaIssueIds: [], dependencyIds: [], scene: [
  { id: "bg", type: "shape", shape: "rect", fill: "#101112", semanticRole: "decoration", geometry: { x: 0, y: 0, width: 1920, height: 1080 }, zIndex: 0, origin: "user", exportStrategy: "native", dependencies: [] },
  { id: "title", type: "text", semanticRole: "title", geometry: { x: 120, y: 100, width: 1500, height: 150 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Master title", color: "#FFFFFF", fontSizePt: 56 }] }] },
  { id: "body", type: "text", semanticRole: "body", geometry: { x: 120, y: 320, width: 1000, height: 400 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Master body", color: "#CCCCCC", fontSizePt: 26 }] }] },
] }; }
function content(): SlideDocument { return { id: "s1", order: 1, title: "Content", archetype: "freeform", semantic: semantic(), status: "draft", qaIssueIds: [], dependencyIds: [], scene: [
  { id: "title_content", type: "text", semanticRole: "title", geometry: { x: 300, y: 140, width: 1200, height: 180 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Real title", fontSizePt: 70 }] }] },
  { id: "body_content", type: "text", semanticRole: "body", geometry: { x: 300, y: 400, width: 1100, height: 320 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Real body", fontSizePt: 30 }] }] },
] }; }
function deck(): DeckDocument { return { schemaVersion: "0.1", id: "deck", title: "QA", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides: [template(), content()] }; }

function linkedDeck(): DeckDocument {
  let result = executeProductionSlideMasterCommand(deck(), { command: "createMaster", slideId: "template", name: "Editorial", masterId: "master" });
  result = executeProductionSlideMasterCommand(result.deck, { command: "applyMaster", slideId: "s1", masterId: "master", instanceId: "instance" });
  return result.deck;
}

test("valid linked master deck is structurally ready", () => {
  const report = runSlideMasterQA(linkedDeck());
  assert.equal(report.masterCount, 1);
  assert.equal(report.linkedSlideCount, 1);
  assert.equal(report.instanceCount, 1);
  assert.equal(report.ready, true);
  assert.equal(report.issues.some(issue => issue.severity === "critical"), false);
});

test("QA detects unknown master/source/placeholder references", () => {
  const broken = structuredClone(linkedDeck()) as any;
  const linked = broken.slides.find((slide: any) => slide.id === "s1").scene.filter((element: any) => element.tags?.some((tag: string) => tag.startsWith("slide-master:")));
  linked[0].tags = linked[0].tags.map((tag: string) => tag.startsWith("slide-master:") ? "slide-master:missing" : tag);
  linked[1].tags = linked[1].tags.map((tag: string) => tag.startsWith("slide-master-source:") ? "slide-master-source:missing_source" : tag);
  linked[2].tags = linked[2].tags.map((tag: string) => tag.startsWith("slide-placeholder:") ? "slide-placeholder:missing_placeholder" : tag);
  const report = runSlideMasterQA(broken);
  assert.equal(report.ready, false);
  assert(report.issues.some(issue => issue.code === "unknown-master"));
  assert(report.issues.some(issue => issue.code === "unknown-source"));
  assert(report.issues.some(issue => issue.code === "unknown-placeholder"));
});

test("QA detects duplicate source identity and missing required placeholder", () => {
  const broken = structuredClone(linkedDeck()) as any;
  const slide = broken.slides.find((item: any) => item.id === "s1");
  const title = slide.scene.find((element: any) => element.tags?.includes("slide-placeholder:placeholder_title"));
  assert(title);
  const duplicate = structuredClone(title);
  duplicate.id = `${title.id}_duplicate`;
  slide.scene.push(duplicate);
  slide.scene = slide.scene.filter((element: any) => !element.tags?.includes("slide-placeholder:placeholder_title") || element.id === duplicate.id);
  const report = runSlideMasterQA(broken);
  assert(report.issues.some(issue => issue.code === "missing-required-placeholder") || report.issues.some(issue => issue.code === "duplicate-source-in-instance"));
});

test("manual master-owned geometry/style drift is reported as minor, not destructive corruption", () => {
  const drifted = structuredClone(linkedDeck()) as any;
  const slide = drifted.slides.find((item: any) => item.id === "s1");
  const title = slide.scene.find((element: any) => element.tags?.includes("slide-placeholder:placeholder_title"));
  title.geometry.x += 50;
  title.paragraphs[0].runs[0].fontSizePt += 4;
  const report = runSlideMasterQA(drifted);
  assert.equal(report.ready, true);
  assert(report.issues.some(issue => issue.code === "master-geometry-drift" && issue.elementId === title.id));
  assert(report.issues.some(issue => issue.code === "master-style-drift" && issue.elementId === title.id));
});
