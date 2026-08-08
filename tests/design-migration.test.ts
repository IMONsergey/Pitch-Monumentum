import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import type { DeckTheme } from "../packages/design-system/src/index.js";
import { applyDesignMigration, planDesignMigration } from "../packages/design-migration/src/index.js";

const theme: DeckTheme = { schemaVersion: "0.1", id: "theme", name: "Brand", colors: { primary: "#112233", body: "#222222" }, fonts: { display: "Inter" }, typeScalePt: { display: 48 }, spacingDU: { m: 24 } };
function deck(): DeckDocument { return { schemaVersion: "0.1", id: "deck", title: "Migration", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides: [{ id: "s1", order: 0, title: "Migration", archetype: "freeform", semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [
  { id: "shape", type: "shape", shape: "rect", fill: "#112233", semanticRole: "visual", geometry: { x: 100, y: 100, width: 300, height: 200 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
  { id: "title", type: "text", semanticRole: "title", geometry: { x: 100, y: 400, width: 800, height: 100 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Hello", color: "#222222", fontFamily: "Inter", fontSizePt: 48 }] }] },
  { id: "offbrand", type: "shape", shape: "rect", fill: "#FF00FF", semanticRole: "visual", geometry: { x: 900, y: 100, width: 300, height: 200 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [] },
], status: "draft", qaIssueIds: [], dependencyIds: [] }] }; }

test("migration dry-run predicts exact binding impact without mutating input", () => {
  const original = deck();
  const plan = planDesignMigration(original, theme);
  assert.equal((original as any).theme, undefined);
  assert(plan.commands.length >= 4);
  assert(plan.affectedElementIds.includes("shape"));
  assert(plan.affectedElementIds.includes("title"));
  assert(plan.after.coverage.coverage > plan.before.coverage.coverage);
  assert(plan.after.issues.some(issue => issue.code === "unknown-brand-value" && issue.elementId === "offbrand"));
  const applied = applyDesignMigration(original, plan, theme) as any;
  assert.equal(applied.theme.id, "theme");
  assert.equal(applied.slides[0].scene.find((item: any) => item.id === "shape").tokenBindings.fill, "primary");
});

test("migration confidence threshold is validated", () => {
  assert.throws(() => planDesignMigration(deck(), theme, 1.1), /between 0 and 1/);
});
