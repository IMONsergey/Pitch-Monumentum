import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { deckHash } from "../packages/mutations/src/index.js";
import { executePitchEditorTool, pitchEditorToolDefinition } from "../packages/codex-editor-tools/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "deck",
    title: "Codex tools",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b",
    narrativeId: "n",
    designSystemId: "d",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z",
    updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1",
      order: 0,
      title: "Slide",
      archetype: "freeform",
      semantic: {
        purpose: "test",
        takeaway: "test",
        questionAnswered: "test",
        narrativeRole: "test",
        claimIds: [],
        evidenceRefs: [],
        audienceRelevance: "test",
        density: "balanced",
      },
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
      scene: [
        {
          id: "a",
          type: "shape",
          semanticRole: "visual",
          geometry: { x: 100, y: 100, width: 120, height: 80 },
          zIndex: 1,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          shape: "rect",
          fill: "#cccccc",
        },
        {
          id: "b",
          type: "shape",
          semanticRole: "visual",
          geometry: { x: 300, y: 200, width: 120, height: 80 },
          zIndex: 2,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          shape: "rect",
          fill: "#dddddd",
        },
      ],
    }],
  };
}

test("Codex nudge runs through ordinary DeckMutation with optimistic hash", () => {
  const deck = fixture();
  const result = executePitchEditorTool(deck, {
    name: "pitch_editor_command",
    expectedDeckHash: deckHash(deck),
    arguments: { command: "nudge", slideId: "s1", elementIds: ["a"], dx: 24, dy: -8 },
  });
  const moved = result.applied.deck.slides[0].scene.find((element) => element.id === "a")!;
  const untouched = result.applied.deck.slides[0].scene.find((element) => element.id === "b")!;
  assert.equal(moved.geometry.x, 124);
  assert.equal(moved.geometry.y, 92);
  assert.equal(untouched.geometry.x, 300);
  assert.equal(result.applied.deck.slides[0].scene.length, 2);
  assert.equal(result.command, "nudge");
  assert.notEqual(result.beforeHash, result.afterHash);
});

test("stale Codex tool call is rejected by the same optimistic lock as manual edits", () => {
  const deck = fixture();
  assert.throws(() => executePitchEditorTool(deck, {
    name: "pitch_editor_command",
    expectedDeckHash: "stale-hash",
    arguments: { command: "delete", slideId: "s1", elementIds: ["a"] },
  }), /Deck changed since mutation was authored/);
});

test("Codex insert creates a normal native scene element with agent provenance", () => {
  const result = executePitchEditorTool(fixture(), {
    name: "pitch_editor_command",
    arguments: {
      command: "insertText",
      slideId: "s1",
      elementIds: [],
      geometry: { x: 500, y: 120, width: 620, height: 140 },
      text: "Generated through the editor tool",
      fontSizePt: 32,
    },
  });
  const inserted = result.applied.deck.slides[0].scene.find((element) => result.nextSelectionIds.includes(element.id));
  assert(inserted && inserted.type === "text");
  if (!inserted || inserted.type !== "text") throw new Error("Expected native text element");
  assert.equal(inserted.paragraphs[0].runs[0].text, "Generated through the editor tool");
  assert.equal(inserted.origin, "agent");
  assert.equal(inserted.exportStrategy, "native");
});

test("tool schema is strict and exposes bounded professional editor commands", () => {
  assert.equal(pitchEditorToolDefinition.name, "pitch_editor_command");
  assert.equal(pitchEditorToolDefinition.strict, true);
  assert.equal(pitchEditorToolDefinition.parameters.additionalProperties, false);
  assert((pitchEditorToolDefinition.parameters.properties.command.enum as readonly string[]).includes("group"));
  assert((pitchEditorToolDefinition.parameters.properties.command.enum as readonly string[]).includes("insertFrame"));
});
