import test from "node:test";
import assert from "node:assert/strict";
import type { CreativeDirectorPlan } from "../packages/creative-director/src/index.js";
import { validateCreativeExecutionBundle } from "../packages/creative-director/src/execution.js";

function plan(overrides: Partial<CreativeDirectorPlan> = {}): CreativeDirectorPlan {
  return {
    schemaVersion: "0.1",
    requestId: "request_1",
    deckId: "deck_1",
    createdAt: "2026-08-08T00:00:00.000Z",
    risk: "medium",
    blocked: false,
    blockers: [],
    assumptions: [],
    before: { score: 90, ready: true, blockerCount: 0, warningCount: 0, lanes: [], priorities: [] },
    steps: [
      { id: "edit_media", order: 1, phase: "edit", toolFamily: "media", operation: "setImageProperties", scope: { kind: "selection", slideIds: ["s1"], elementIds: ["img1"] }, risk: "medium", rationale: "test", prerequisites: [], expectedEffects: [], mustNotChange: [], requiresExplicitApproval: false },
      { id: "edit_brand", order: 2, phase: "edit", toolFamily: "design", operation: "setToken", scope: { kind: "deck" }, risk: "high", rationale: "test", prerequisites: [], expectedEffects: [], mustNotChange: [], requiresExplicitApproval: true },
    ],
    acceptanceCriteria: ["No regressions"],
    ...overrides,
  };
}

test("local media action within selection scope is valid", () => {
  const result = validateCreativeExecutionBundle(plan(), {
    schemaVersion: "0.1", requestId: "request_1", deckId: "deck_1", mode: "currentBranch",
    actions: [{ id: "a1", stepId: "edit_media", tool: "pitch_media_command", args: { command: "setImageProperties", slideId: "s1", elementId: "img1", changes: { fit: "cover" } } }],
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.effectiveMode, "currentBranch");
});

test("selection scope rejects object outside the planned selection", () => {
  const result = validateCreativeExecutionBundle(plan(), {
    schemaVersion: "0.1", requestId: "request_1", deckId: "deck_1",
    actions: [{ id: "a1", stepId: "edit_media", tool: "pitch_media_command", args: { command: "setImageProperties", slideId: "s1", elementId: "img2", changes: { fit: "cover" } } }],
  });
  assert.equal(result.valid, false);
  assert(result.issues.some((issue) => issue.code === "scope-violation"));
});

test("global setToken cannot be smuggled through a selection/local step", () => {
  const localBrand = plan({
    steps: [{ id: "edit_brand", order: 1, phase: "edit", toolFamily: "design", operation: "bindOrStyleSelection", scope: { kind: "selection", slideIds: ["s1"], elementIds: ["shape1"] }, risk: "medium", rationale: "test", prerequisites: [], expectedEffects: [], mustNotChange: [], requiresExplicitApproval: false }],
  });
  const result = validateCreativeExecutionBundle(localBrand, {
    schemaVersion: "0.1", requestId: "request_1", deckId: "deck_1",
    actions: [{ id: "a1", stepId: "edit_brand", tool: "pitch_design_command", args: { command: "setToken", category: "colors", token: "accent", value: "#FF0000" } }],
  });
  assert.equal(result.valid, false);
  assert(result.issues.some((issue) => issue.code === "global-propagation-outside-deck-scope"));
});

test("high-risk propagation requires approval and preview branch by default", () => {
  const blocked = plan({ blocked: true, blockers: ["edit_brand requires explicit approval for global propagation"], risk: "high" });
  const withoutApproval = validateCreativeExecutionBundle(blocked, {
    schemaVersion: "0.1", requestId: "request_1", deckId: "deck_1",
    actions: [{ id: "a1", stepId: "edit_brand", tool: "pitch_design_command", args: { command: "setToken", category: "colors", token: "accent", value: "#FF0000" } }],
  });
  assert.equal(withoutApproval.valid, false);
  assert(withoutApproval.issues.some((issue) => issue.code === "approval-required" || issue.code === "plan-blocked"));

  const approved = validateCreativeExecutionBundle(blocked, {
    schemaVersion: "0.1", requestId: "request_1", deckId: "deck_1", approvedStepIds: ["edit_brand"],
    actions: [{ id: "a1", stepId: "edit_brand", tool: "pitch_design_command", args: { command: "setToken", category: "colors", token: "accent", value: "#FF0000" } }],
  });
  assert.equal(approved.valid, true, JSON.stringify(approved.issues));
  assert.equal(approved.effectiveMode, "previewBranch");
});

test("direct high-risk write is rejected unless explicitly approved", () => {
  const approvedPlan = plan({ blocked: true, blockers: ["edit_brand requires explicit approval for global propagation"], risk: "high" });
  const result = validateCreativeExecutionBundle(approvedPlan, {
    schemaVersion: "0.1", requestId: "request_1", deckId: "deck_1", mode: "currentBranch", approvedStepIds: ["edit_brand"],
    actions: [{ id: "a1", stepId: "edit_brand", tool: "pitch_design_command", args: { command: "setToken", category: "colors", token: "accent", value: "#FF0000" } }],
  });
  assert.equal(result.valid, false);
  assert(result.issues.some((issue) => issue.code === "preview-branch-required"));
});
