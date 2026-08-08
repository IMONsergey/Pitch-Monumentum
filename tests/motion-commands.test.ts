import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { executeMotionCommand, reconcileMotionDocument } from "../packages/motion-commands/src/index.js";
import { validateMotionDocument } from "../packages/motion-engine/src/index.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "deck_motion",
    title: "Motion",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief",
    narrativeId: "narrative",
    designSystemId: "design",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{
      id: "slide_1",
      order: 0,
      title: "Hero",
      archetype: "freeform",
      semantic: { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
      scene: [{
        id: "shape_1", type: "shape", shape: "rect", fill: "#111111", semanticRole: "visual",
        geometry: { x: 100, y: 100, width: 400, height: 240 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [],
      }],
      status: "draft", qaIssueIds: [], dependencyIds: [],
    }],
  };
}

test("motion commands create transition, build and keyframe track", () => {
  const current = deck();
  let result = executeMotionCommand(current, null, {
    command: "setSlideTransition",
    slideId: "slide_1",
    transition: { type: "fade", durationMs: 350, advance: "manual" },
  });
  result = executeMotionCommand(current, result.motion, {
    command: "addBuild",
    slideId: "slide_1",
    elementIds: ["shape_1"],
    kind: "entrance",
    effect: "fade",
    trigger: "onClick",
    durationMs: 420,
    buildId: "build_1",
  });
  result = executeMotionCommand(current, result.motion, {
    command: "setTrack",
    slideId: "slide_1",
    elementId: "shape_1",
    property: "x",
    keyframes: [{ timeMs: 0, value: 100 }, { timeMs: 600, value: 500, easing: "easeOut" }],
    trackId: "track_1",
  });

  assert.equal(result.motion.slides[0].transition?.type, "fade");
  assert.equal(result.motion.slides[0].builds[0].id, "build_1");
  assert.equal(result.motion.slides[0].tracks[0].id, "track_1");
  assert.equal(validateMotionDocument(current, result.motion).filter((issue) => issue.severity === "critical").length, 0);
});

test("reconcile removes stale targets after a deck edit", () => {
  const current = deck();
  const result = executeMotionCommand(current, null, {
    command: "addBuild", slideId: "slide_1", elementIds: ["shape_1"], kind: "entrance", effect: "scale", trigger: "onClick", durationMs: 300,
  });
  const withoutElement = structuredClone(current);
  withoutElement.slides[0].scene = [];
  const reconciled = reconcileMotionDocument(withoutElement, result.motion);
  assert.deepEqual(reconciled.slides, []);
});

test("motion commands update, reorder and delete build state deterministically", () => {
  const current = deck();
  let motion = executeMotionCommand(current, null, {
    command: "addBuild", slideId: "slide_1", elementIds: ["shape_1"], kind: "entrance", effect: "appear", trigger: "onClick", durationMs: 100, buildId: "a",
  }).motion;
  motion = executeMotionCommand(current, motion, {
    command: "addBuild", slideId: "slide_1", elementIds: ["shape_1"], kind: "emphasis", effect: "pulse", trigger: "afterPrevious", durationMs: 200, buildId: "b",
  }).motion;
  motion = executeMotionCommand(current, motion, { command: "reorderBuild", slideId: "slide_1", buildId: "b", toIndex: 0 }).motion;
  assert.deepEqual(motion.slides[0].builds.map((build) => build.id), ["b", "a"]);
  motion = executeMotionCommand(current, motion, { command: "updateBuild", slideId: "slide_1", buildId: "b", changes: { durationMs: 600 } }).motion;
  assert.equal(motion.slides[0].builds[0].durationMs, 600);
  motion = executeMotionCommand(current, motion, { command: "deleteBuild", slideId: "slide_1", buildId: "a" }).motion;
  assert.deepEqual(motion.slides[0].builds.map((build) => build.id), ["b"]);
});
