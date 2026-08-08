import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { auditTheme, executeDesignCommand, type DeckTheme, type ThemedDeckDocument, type TokenizedSceneElement } from "../packages/design-system/src/index.js";

const theme: DeckTheme = {
  schemaVersion: "0.1",
  id: "theme_brand",
  name: "Brand",
  colors: { primary: "#112233", text: "#202124", accent: "#55AA22" },
  fonts: { display: "Inter", body: "Arial" },
  typeScalePt: { display: 48, body: 24 },
  spacingDU: { s: 12, m: 24, l: 48 },
};

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck_theme", title: "Theme", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1", order: 0, title: "Theme", archetype: "freeform",
      semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
      scene: [
        { id: "shape", type: "shape", shape: "rect", fill: "#EEEEEE", stroke: { color: "#000000", widthDU: 2 }, semanticRole: "visual", geometry: { x: 100, y: 100, width: 400, height: 240 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
        { id: "title", type: "text", semanticRole: "title", geometry: { x: 100, y: 400, width: 900, height: 100 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Theme title", color: "#000000", fontFamily: "Helvetica", fontSizePt: 32 }] }] },
      ], status: "draft", qaIssueIds: [], dependencyIds: [],
    }],
  };
}

function element(deck: DeckDocument, id: string): TokenizedSceneElement {
  return deck.slides[0].scene.find((item) => item.id === id)! as TokenizedSceneElement;
}

test("theme binding materializes native values and token edits propagate deck-wide", () => {
  let result = executeDesignCommand(fixture(), { command: "initializeTheme", theme });
  result = executeDesignCommand(result.deck, { command: "bindToken", slideId: "s1", elementIds: ["shape"], target: "fill", token: "primary" });
  result = executeDesignCommand(result.deck, { command: "bindToken", slideId: "s1", elementIds: ["title"], target: "textColor", token: "text" });
  result = executeDesignCommand(result.deck, { command: "bindToken", slideId: "s1", elementIds: ["title"], target: "fontFamily", token: "display" });
  result = executeDesignCommand(result.deck, { command: "bindToken", slideId: "s1", elementIds: ["title"], target: "fontSizePt", token: "display" });

  assert.equal((element(result.deck, "shape") as any).fill, "#112233");
  assert.equal(element(result.deck, "shape").tokenBindings?.fill, "primary");
  const title = element(result.deck, "title") as any;
  assert.equal(title.paragraphs[0].runs[0].color, "#202124");
  assert.equal(title.paragraphs[0].runs[0].fontFamily, "Inter");
  assert.equal(title.paragraphs[0].runs[0].fontSizePt, 48);

  result = executeDesignCommand(result.deck, { command: "setToken", category: "colors", token: "primary", value: "#ABCDEF" });
  assert.equal((element(result.deck, "shape") as any).fill, "#ABCDEF");
  assert.deepEqual(result.affectedElementIds, ["shape"]);
  assert.deepEqual(result.audit, []);
});

test("unbind preserves current materialized value but stops future propagation", () => {
  let result = executeDesignCommand(fixture(), { command: "initializeTheme", theme });
  result = executeDesignCommand(result.deck, { command: "bindToken", slideId: "s1", elementIds: ["shape"], target: "fill", token: "primary" });
  result = executeDesignCommand(result.deck, { command: "unbindToken", slideId: "s1", elementIds: ["shape"], target: "fill" });
  const preserved = (element(result.deck, "shape") as any).fill;
  result = executeDesignCommand(result.deck, { command: "setToken", category: "colors", token: "primary", value: "#FF0000" });
  assert.equal((element(result.deck, "shape") as any).fill, preserved);
  assert.equal(element(result.deck, "shape").tokenBindings, undefined);
});

test("bound token cannot be deleted and invalid target binding fails closed", () => {
  let result = executeDesignCommand(fixture(), { command: "initializeTheme", theme });
  result = executeDesignCommand(result.deck, { command: "bindToken", slideId: "s1", elementIds: ["shape"], target: "fill", token: "primary" });
  assert.throws(() => executeDesignCommand(result.deck, { command: "deleteToken", category: "colors", token: "primary" }), /bound to/);
  assert.throws(() => executeDesignCommand(result.deck, { command: "bindToken", slideId: "s1", elementIds: ["shape"], target: "fontFamily", token: "display" }), /cannot bind a font token/);
});

test("theme audit detects manual drift from a token binding", () => {
  let result = executeDesignCommand(fixture(), { command: "initializeTheme", theme });
  result = executeDesignCommand(result.deck, { command: "bindToken", slideId: "s1", elementIds: ["shape"], target: "fill", token: "primary" });
  const drifted = structuredClone(result.deck) as ThemedDeckDocument;
  (drifted.slides[0].scene.find(item => item.id === "shape") as any).fill = "#000000";
  const issues = auditTheme(drifted);
  assert.equal(issues.some(issue => issue.code === "materialized-value-mismatch" && issue.elementId === "shape"), true);
});
