import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import type { DeckTheme } from "../packages/design-system/src/index.js";
import { bindingCommandsFromSuggestions, inferTokenBindings } from "../packages/design-system-inference/src/index.js";

const theme: DeckTheme = { schemaVersion: "0.1", id: "theme", name: "Brand", colors: { primary: "#112233", body: "#222222" }, fonts: { display: "Inter", body: "Arial" }, typeScalePt: { display: 48, body: 24 }, spacingDU: { m: 24 } };
function deck(): DeckDocument { return { schemaVersion: "0.1", id: "deck", title: "Inference", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z", slides: [{ id: "s1", order: 0, title: "One", archetype: "freeform", semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [
  { id: "shape_a", type: "shape", shape: "rect", fill: "#112233", semanticRole: "visual", geometry: { x: 100, y: 100, width: 300, height: 200 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
  { id: "shape_b", type: "shape", shape: "rect", fill: "#112233", semanticRole: "visual", geometry: { x: 500, y: 100, width: 300, height: 200 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [] },
  { id: "title", type: "text", semanticRole: "title", geometry: { x: 100, y: 400, width: 800, height: 100 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Hello", color: "#222222", fontFamily: "Inter", fontSizePt: 48 }] }] },
  { id: "mixed", type: "text", semanticRole: "body", geometry: { x: 100, y: 550, width: 800, height: 100 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "A", color: "#222222", fontFamily: "Inter", fontSizePt: 48 }, { text: "B", color: "#112233", fontFamily: "Arial", fontSizePt: 24 }] }] },
], status: "draft", qaIssueIds: [], dependencyIds: [] }] }; }

test("inference proposes exact brand token bindings and skips mixed text boxes", () => {
  const suggestions = inferTokenBindings(deck(), theme);
  assert(suggestions.some(item => item.elementId === "shape_a" && item.target === "fill" && item.token === "primary" && item.confidence === 1));
  assert(suggestions.some(item => item.elementId === "title" && item.target === "textColor" && item.token === "body"));
  assert(suggestions.some(item => item.elementId === "title" && item.target === "fontFamily" && item.token === "display"));
  assert(suggestions.some(item => item.elementId === "title" && item.target === "fontSizePt" && item.token === "display"));
  assert.equal(suggestions.some(item => item.elementId === "mixed"), false);
});

test("high-confidence suggestions are grouped into bounded bindToken commands", () => {
  const commands = bindingCommandsFromSuggestions(inferTokenBindings(deck(), theme));
  const fill = commands.find(command => command.command === "bindToken" && command.target === "fill" && command.token === "primary");
  assert(fill && fill.command === "bindToken");
  assert.deepEqual(fill.elementIds.sort(), ["shape_a", "shape_b"]);
  assert.equal(commands.filter(command => command.command === "bindToken" && command.elementIds.includes("title")).length, 3);
});
