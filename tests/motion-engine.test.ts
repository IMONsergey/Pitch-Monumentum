import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { compileBuildPhases, evaluateEasing, motionDuration, sampleSlideMotion, sampleTrack, validateMotionDocument, type MotionDocument, type MotionTrack, type SlideMotion } from "../packages/motion-engine/src/index.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck_motion", title: "Motion", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Motion", archetype: "freeform", semantic: { purpose: "animate", takeaway: "", questionAnswered: "", narrativeRole: "working", claimIds: [], evidenceRefs: [], audienceRelevance: "", density: "sparse" }, scene: [
      { id: "box", type: "shape", semanticRole: "visual", geometry: { x: 100, y: 100, width: 300, height: 180 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#335CFF" },
      { id: "title", type: "text", semanticRole: "title", geometry: { x: 500, y: 100, width: 900, height: 160 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Motion", fontSizePt: 42 }] }] }
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }]
  };
}

function track(): MotionTrack {
  return { id: "track_x", slideId: "s1", elementId: "box", property: "x", keyframes: [
    { timeMs: 0, value: 100, easing: "linear" },
    { timeMs: 1000, value: 500, easing: "linear" }
  ] };
}

test("track sampling interpolates deterministically and clamps outside keyframes", () => {
  const t = track();
  assert.equal(sampleTrack(t, 0), 100);
  assert.equal(sampleTrack(t, 500), 300);
  assert.equal(sampleTrack(t, 1000), 500);
  assert.equal(sampleTrack(t, 2000), 500);
});

test("named and cubic-bezier easing remain bounded at endpoints", () => {
  for (const easing of ["linear", "ease", "easeIn", "easeOut", "easeInOut"] as const) {
    assert.equal(evaluateEasing(easing, 0), 0);
    assert(Math.abs(evaluateEasing(easing, 1) - 1) < 1e-6);
  }
  const mid = evaluateEasing({ type: "cubicBezier", x1: 0.2, y1: 0, x2: 0.8, y2: 1 }, 0.5);
  assert(mid > 0 && mid < 1);
});

test("build phases preserve onClick withPrevious and afterPrevious grouping", () => {
  const phases = compileBuildPhases([
    { id: "a", slideId: "s1", elementIds: ["title"], kind: "entrance", effect: "fade", trigger: "onClick", durationMs: 400 },
    { id: "b", slideId: "s1", elementIds: ["box"], kind: "entrance", effect: "scale", trigger: "withPrevious", durationMs: 700, delayMs: 100 },
    { id: "c", slideId: "s1", elementIds: ["box"], kind: "emphasis", effect: "pulse", trigger: "afterPrevious", durationMs: 300, delayMs: 50 },
    { id: "d", slideId: "s1", elementIds: ["title"], kind: "exit", effect: "fade", trigger: "onClick", durationMs: 250 },
  ]);
  assert.deepEqual(phases.map(phase => phase.clickIndex), [0, 0, 0, 1]);
  assert.equal(phases[0].relativeStartMs, 0);
  assert.equal(phases[1].relativeStartMs, 100);
  assert.equal(phases[2].relativeStartMs, 850);
  assert.equal(phases[3].relativeStartMs, 0);
});

test("sampleSlideMotion combines multiple tracks for one element without mutating deck", () => {
  const slideMotion: SlideMotion = {
    slideId: "s1",
    transition: { type: "fade", durationMs: 300 },
    tracks: [
      track(),
      { id: "opacity", slideId: "s1", elementId: "box", property: "opacity", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 1000, value: 1 }] },
      { id: "rotation", slideId: "s1", elementId: "title", property: "rotation", keyframes: [{ timeMs: 0, value: 0 }, { timeMs: 500, value: 15 }] },
    ],
    builds: [],
  };
  const sampled = sampleSlideMotion(slideMotion, 500);
  assert.equal(sampled.get("box")?.geometry?.x, 300);
  assert(Math.abs((sampled.get("box")?.opacity ?? 0) - 0.5) < 0.01);
  assert.equal(sampled.get("title")?.geometry?.rotation, 15);
  assert.equal(motionDuration(slideMotion), 1000);
});

test("motion validation catches dangling IDs, duplicate IDs and invalid timing", () => {
  const motion: MotionDocument = {
    schemaVersion: "0.1",
    deckId: "deck_motion",
    slides: [{
      slideId: "s1",
      transition: { type: "push", durationMs: -1 },
      tracks: [
        track(),
        { ...track(), id: "track_x", elementId: "missing" },
      ],
      builds: [
        { id: "build", slideId: "s1", elementIds: ["missing"], kind: "entrance", effect: "fade", trigger: "onClick", durationMs: 300 },
        { id: "build", slideId: "s1", elementIds: ["box"], kind: "exit", effect: "fade", trigger: "afterPrevious", durationMs: -3 },
      ],
    }],
  };
  const issues = validateMotionDocument(deck(), motion);
  const codes = new Set(issues.map(issue => issue.code));
  assert(codes.has("motion:invalid-transition-duration"));
  assert(codes.has("motion:duplicate-track-id"));
  assert(codes.has("motion:missing-element"));
  assert(codes.has("motion:missing-build-element"));
  assert(codes.has("motion:duplicate-build-id"));
  assert(codes.has("motion:invalid-build-timing"));
  assert(issues.some(issue => issue.severity === "critical"));
});

test("motion document deck mismatch is a hard gate", () => {
  const motion: MotionDocument = { schemaVersion: "0.1", deckId: "other", slides: [] };
  const issues = validateMotionDocument(deck(), motion);
  assert.equal(issues[0].code, "motion:deck-mismatch");
  assert.equal(issues[0].severity, "critical");
});
