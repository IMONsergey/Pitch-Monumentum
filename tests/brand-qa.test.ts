import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import type { DeckTheme } from "../packages/design-system/src/index.js";
import { brandCoverage, runBrandQA } from "../packages/brand-qa/src/index.js";

const theme: DeckTheme = {
  schemaVersion: "0.1", id: "theme", name: "Brand",
  colors: { primary: "#112233", body: "#222222" }, fonts: { display: "Inter" }, typeScalePt: { display: 48 }, spacingDU: { m: 24 },
};

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Brand QA", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Brand", archetype: "freeform", semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [
      { id: "bound", type: "shape", shape: "rect", fill: "#112233", semanticRole: "visual", geometry: { x: 100, y: 100, width: 300, height: 200 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], tokenBindings: { fill: "primary" } } as any,
      { id: "literal", type: "shape", shape: "rect", fill: "#112233", semanticRole: "visual", geometry: { x: 500, y: 100, width: 300, height: 200 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "offbrand", type: "shape", shape: "rect", fill: "#FF00FF", semanticRole: "visual", geometry: { x: 900, y: 100, width: 300, height: 200 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "mixed", type: "text", semanticRole: "body", geometry: { x: 100, y: 450, width: 900, height: 100 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "A", color: "#222222", fontFamily: "Inter", fontSizePt: 48 }, { text: "B", color: "#112233", fontFamily: "Arial", fontSizePt: 24 }] }] },
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  } as DeckDocument;
}

test("brand coverage measures eligible token bindings by target", () => {
  const coverage = brandCoverage(deck());
  assert.equal(coverage.byTarget.fill.eligible, 3);
  assert.equal(coverage.byTarget.fill.bound, 1);
  assert.equal(coverage.byTarget.fill.coverage, 1 / 3);
  assert(coverage.coverage < 1);
});

test("brand QA distinguishes hardcoded brand values, off-brand values and mixed text", () => {
  const issues = runBrandQA(deck(), theme);
  assert(issues.some(issue => issue.code === "hardcoded-brand-value" && issue.elementId === "literal" && issue.target === "fill"));
  assert(issues.some(issue => issue.code === "unknown-brand-value" && issue.elementId === "offbrand" && issue.severity === "major"));
  assert(issues.some(issue => issue.code === "mixed-text-style" && issue.elementId === "mixed"));
});
