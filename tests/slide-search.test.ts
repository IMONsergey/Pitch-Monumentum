import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SlideDocument } from "../packages/deck-model/src/index.js";
import { buildSlideSearchIndex, normalizeSearchText, searchSlides, tokenizeSearchText } from "../packages/slide-search/src/index.js";

function slide(id: string, order: number, title: string, takeaway: string, text: string, archetype: SlideDocument["archetype"], extras: Partial<SlideDocument> = {}): SlideDocument {
  return {
    id, order, title, archetype,
    semantic: { purpose: "inform", takeaway, questionAnswered: "What does this mean?", narrativeRole: "body", claimIds: [], evidenceRefs: [], audienceRelevance: "board", density: "sparse" },
    scene: [{ id: `${id}_text`, type: "text", semanticRole: "body", geometry: { x: 100, y: 100, width: 900, height: 300 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text, fontSizePt: 24 }] }] }],
    status: "ready", qaIssueIds: [], dependencyIds: [], ...extras,
  };
}

function deck(): DeckDocument {
  const decision = slide("decision", 0, "Decision required", "Approve phase two now", "Investment committee should approve phase two with an eight month payback.", "decision");
  decision.semantic.purpose = "decision";
  decision.semantic.questionAnswered = "What should the board approve?";
  decision.semantic.claimIds = ["claim_payback"];
  const evidence = slide("evidence", 1, "CAC proof", "Customer acquisition cost fell 31%", "Cohort evidence shows CAC fell while conversion improved.", "evidence");
  evidence.semantic.evidenceRefs = ["evidence_cac"];
  const media = slide("launch", 2, "Запуск продукта", "Показываем новый продукт крупно", "Главный визуальный кадр и короткий манифест запуска.", "cover");
  media.scene.push({ id: "hero", type: "image", assetId: "asset_hero", fit: "cover", semanticRole: "visual", geometry: { x: 900, y: 100, width: 700, height: 700 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset_hero" }] });
  return {
    schemaVersion: "0.1", id: "search_deck", title: "Search", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", slides: [decision, evidence, media], sourceIds: [], claimIds: ["claim_payback"], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
  };
}

test("Unicode normalization/tokenization handles Russian and English deterministically", () => {
  assert.equal(normalizeSearchText("  ЗАПУСК—ПРОДУКТА  "), "запуск продукта");
  assert.deepEqual(tokenizeSearchText("Запуск продукта / Board-ready"), ["запуск", "продукта", "board", "ready"]);
});

test("board decision intent ranks decision slide above evidence and cover", () => {
  const index = buildSlideSearchIndex(deck(), { approvedSlideIds: ["evidence"] });
  const results = searchSlides(index, "board approve phase two");
  assert.equal(results[0].slideId, "decision");
  assert(results[0].score > results.find((item) => item.slideId === "evidence")?.score!);
  assert(results[0].reasons.some((reason) => reason.field === "title" || reason.field === "takeaway" || reason.field === "text"));
});

test("phrase matches in takeaway/title receive stronger relevance", () => {
  const index = buildSlideSearchIndex(deck());
  const results = searchSlides(index, "customer acquisition cost fell");
  assert.equal(results[0].slideId, "evidence");
  assert(results[0].reasons.some((reason) => reason.detail.includes("Phrase match")));
});

test("filters can query approved media archetype claim and evidence subsets", () => {
  const index = buildSlideSearchIndex(deck(), { approvedSlideIds: ["evidence"], tagsBySlideId: { launch: ["brand launch", "hero"] } });
  assert.deepEqual(searchSlides(index, "", { approved: true }).map((item) => item.slideId), ["evidence"]);
  assert.deepEqual(searchSlides(index, "", { hasMedia: true }).map((item) => item.slideId), ["launch"]);
  assert.deepEqual(searchSlides(index, "", { archetypes: ["decision"] }).map((item) => item.slideId), ["decision"]);
  assert.deepEqual(searchSlides(index, "", { claimIds: ["claim_payback"] }).map((item) => item.slideId), ["decision"]);
  assert.deepEqual(searchSlides(index, "", { evidenceRefs: ["evidence_cac"] }).map((item) => item.slideId), ["evidence"]);
  assert.equal(searchSlides(index, "hero brand launch")[0].slideId, "launch");
});

test("approved boost helps only after relevance exists", () => {
  const index = buildSlideSearchIndex(deck(), { approvedSlideIds: ["evidence"] });
  const results = searchSlides(index, "phase two");
  assert.equal(results[0].slideId, "decision");
  assert.equal(results.some((item) => item.slideId === "evidence"), false, "approval alone must not make an irrelevant slide searchable");
});
