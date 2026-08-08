import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument, SlideDocument } from "../packages/deck-model/src/index.js";
import { contrastRatio, runAdvancedVisualQA } from "../packages/visual-qa/src/index.js";

function slide(id: string, order: number, titleX = 100, titleSize = 36): SlideDocument {
  return {
    id,
    order,
    title: id,
    archetype: "freeform",
    semantic: { purpose: "test", takeaway: "", questionAnswered: "", narrativeRole: "working", claimIds: [], evidenceRefs: [], audienceRelevance: "", density: "balanced" },
    scene: [
      { id: `${id}_bg`, type: "shape", semanticRole: "decoration", geometry: { x: 0, y: 0, width: 1920, height: 1080 }, zIndex: 0, origin: "user", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#FFFFFF" },
      { id: `${id}_title`, type: "text", semanticRole: "title", geometry: { x: titleX, y: 90, width: 1300, height: 120 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Decision title", fontSizePt: titleSize, color: "#111111" }] }] },
      { id: `${id}_body`, type: "text", semanticRole: "body", geometry: { x: 100, y: 270, width: 700, height: 260 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Body copy", fontSizePt: 18, color: "#475467" }] }] },
    ],
    status: "draft",
    qaIssueIds: [],
    dependencyIds: [],
  };
}

function deck(slides: SlideDocument[]): DeckDocument {
  return { schemaVersion: "0.1", id: "deck", title: "Visual QA", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides };
}

test("healthy simple deck produces no advanced hard visual issues", () => {
  const issues = runAdvancedVisualQA(deck([slide("s1", 0), slide("s2", 1)]));
  assert.equal(issues.some(issue => issue.severity === "critical"), false);
  assert.equal(issues.some(issue => issue.category === "readability"), false);
  assert.equal(issues.some(issue => issue.category === "contrast"), false);
});

test("visual QA catches unsafe edges, micro text and weak contrast", () => {
  const s = slide("s1", 0);
  const body = s.scene.find(element => element.id === "s1_body") as any;
  body.geometry.x = 10;
  body.paragraphs[0].runs[0].fontSizePt = 8;
  body.paragraphs[0].runs[0].color = "#CCCCCC";
  const issues = runAdvancedVisualQA(deck([s]));
  assert(issues.some(issue => issue.category === "edge" && issue.elementIds.includes("s1_body")));
  assert(issues.some(issue => issue.category === "readability" && issue.elementIds.includes("s1_body")));
  assert(issues.some(issue => issue.category === "contrast" && issue.elementIds.includes("s1_body")));
});

test("visual QA catches independent content overlap and title hierarchy inversion", () => {
  const s = slide("s1", 0, 100, 24);
  const body = s.scene.find(element => element.id === "s1_body") as any;
  body.geometry = { x: 120, y: 110, width: 800, height: 220 };
  body.paragraphs[0].runs[0].fontSizePt = 34;
  const issues = runAdvancedVisualQA(deck([s]));
  assert(issues.some(issue => issue.category === "overlap" && issue.elementIds.includes("s1_title") && issue.elementIds.includes("s1_body")));
  assert(issues.some(issue => issue.category === "hierarchy" && issue.severity === "major"));
});

test("deck consistency flags title position and size drift across otherwise related slides", () => {
  const s1 = slide("s1", 0, 100, 36);
  const s2 = slide("s2", 1, 102, 36);
  const s3 = slide("s3", 2, 260, 50);
  const issues = runAdvancedVisualQA(deck([s1, s2, s3]));
  assert(issues.some(issue => issue.category === "consistency" && issue.slideId === "s3" && issue.message.includes("position drifts")));
  assert(issues.some(issue => issue.category === "consistency" && issue.slideId === "s3" && issue.message.includes("Title size")));
});

test("dense slide gets explicit density issue instead of vague quality feedback", () => {
  const s = slide("s1", 0);
  const body = s.scene.find(element => element.id === "s1_body") as any;
  body.paragraphs[0].runs[0].text = "A".repeat(1400);
  const issues = runAdvancedVisualQA(deck([s]));
  const density = issues.find(issue => issue.category === "density" && issue.message.includes("1400"));
  assert(density);
  assert.equal(density?.autoFixSafe, false);
});

test("contrast ratio follows WCAG luminance math for black and white", () => {
  assert(Math.abs((contrastRatio("#000000", "#FFFFFF") ?? 0) - 21) < 1e-9);
  assert.equal(contrastRatio("bad", "#FFFFFF"), undefined);
});
