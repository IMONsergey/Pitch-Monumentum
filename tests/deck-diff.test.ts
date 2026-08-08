import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { diffDecks } from "../packages/deck-diff/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Main", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: ["claim"], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [
      { id: "s1", order: 0, title: "Decision", archetype: "thesis", semantic: { purpose: "ask", takeaway: "Approve phase two", questionAnswered: "what now?", narrativeRole: "decision", claimIds: ["claim"], evidenceRefs: ["e1"], audienceRelevance: "board", density: "sparse" }, scene: [
        { id: "title", type: "text", semanticRole: "title", geometry: { x: 100, y: 80, width: 1200, height: 140 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [{ kind: "claim", id: "claim" }], paragraphs: [{ runs: [{ text: "Approve phase two", fontSizePt: 42, bold: true, color: "#111111" }] }] },
        { id: "metric", type: "shape", semanticRole: "visual", geometry: { x: 100, y: 320, width: 500, height: 300 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], shape: "roundRect", fill: "#335CFF" }
      ], status: "ready", qaIssueIds: [], dependencyIds: ["claim", "e1"] },
      { id: "s2", order: 1, title: "Evidence", archetype: "evidence", semantic: { purpose: "prove", takeaway: "CAC fell", questionAnswered: "did it work?", narrativeRole: "evidence", claimIds: ["claim"], evidenceRefs: ["e1"], audienceRelevance: "board", density: "balanced" }, scene: [], status: "ready", qaIssueIds: [], dependencyIds: ["claim", "e1"] }
    ]
  };
}

test("identical decks produce an empty diff", () => {
  const deck = fixture();
  const diff = diffDecks(deck, structuredClone(deck));
  assert.equal(diff.changed, false);
  assert.deepEqual(diff.slideDiffs, []);
  assert.deepEqual(diff.summary, { slidesAdded: 0, slidesRemoved: 0, slidesMoved: 0, semanticChanges: 0, elementsAdded: 0, elementsRemoved: 0, geometryChanges: 0, presentationChanges: 0, contentChanges: 0 });
});

test("branch diff separates semantic, geometry, presentation and content changes", () => {
  const before = fixture();
  const after = structuredClone(before);
  const slide = after.slides[0];
  slide.title = "CFO decision";
  slide.semantic.takeaway = "Approve because payback is 8 months";
  slide.semantic.audienceRelevance = "CFO";
  const title = slide.scene.find((element) => element.id === "title") as any;
  title.geometry.x = 180;
  title.opacity = 0.8;
  title.paragraphs[0].runs[0].text = "Approve with an 8-month payback";
  const metric = slide.scene.find((element) => element.id === "metric") as any;
  metric.fill = "#14B8A6";

  const diff = diffDecks(before, after);
  assert.equal(diff.changed, true);
  const s1 = diff.slideDiffs.find((entry) => entry.slideId === "s1")!;
  assert(s1.kinds.includes("renamed"));
  assert(s1.kinds.includes("semantic"));
  assert(s1.kinds.includes("scene"));
  assert.deepEqual(s1.semanticFields.sort(), ["audienceRelevance", "takeaway"]);
  const titleDiffs = s1.elementDiffs.filter((entry) => entry.elementId === "title");
  assert(titleDiffs.some((entry) => entry.kind === "geometry" && entry.fields?.includes("x")));
  assert(titleDiffs.some((entry) => entry.kind === "presentation" && entry.fields?.includes("opacity")));
  assert(titleDiffs.some((entry) => entry.kind === "content"));
  assert(s1.elementDiffs.some((entry) => entry.elementId === "metric" && entry.kind === "content"));
  assert.equal(diff.summary.geometryChanges, 1);
  assert.equal(diff.summary.presentationChanges, 1);
  assert.equal(diff.summary.contentChanges, 2);
  assert.equal(diff.summary.semanticChanges, 2);
});

test("storyboard reorder add and remove are explicit instead of inferred from screenshots", () => {
  const before = fixture();
  const after = structuredClone(before);
  after.slides = [
    { ...after.slides[1], order: 0 },
    { id: "s3", order: 1, title: "Appendix", archetype: "freeform", semantic: { purpose: "appendix", takeaway: "", questionAnswered: "", narrativeRole: "appendix", claimIds: [], evidenceRefs: [], audienceRelevance: "reader", density: "dense" }, scene: [{ id: "appendix_text", type: "text", semanticRole: "body", geometry: { x: 100, y: 100, width: 800, height: 300 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Appendix", fontSizePt: 20 }] }] }], status: "draft", qaIssueIds: [], dependencyIds: [] },
  ];
  const diff = diffDecks(before, after);
  assert.equal(diff.summary.slidesAdded, 1);
  assert.equal(diff.summary.slidesRemoved, 1);
  assert.equal(diff.summary.slidesMoved, 1);
  assert(diff.slideDiffs.find((entry) => entry.slideId === "s2")?.kinds.includes("moved"));
  assert(diff.slideDiffs.find((entry) => entry.slideId === "s3")?.kinds.includes("added"));
  assert(diff.slideDiffs.find((entry) => entry.slideId === "s1")?.kinds.includes("removed"));
});

test("dependency changes are tracked separately from visual content", () => {
  const before = fixture();
  const after = structuredClone(before);
  const title = after.slides[0].scene.find((element) => element.id === "title") as any;
  title.dependencies.push({ kind: "evidence", id: "e2" });
  const diff = diffDecks(before, after);
  const change = diff.slideDiffs[0].elementDiffs.find((entry) => entry.kind === "dependencies");
  assert(change);
  assert.equal(diff.summary.contentChanges, 0);
  assert.equal(diff.summary.geometryChanges, 0);
});
