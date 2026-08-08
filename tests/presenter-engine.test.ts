import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import type { MotionDocument } from "../packages/motion-engine/src/index.js";
import { advancePresenter, createPresenterState, jumpToSlide, pausePresenter, presenterElapsedMs, presenterView, resumePresenter, retreatPresenter, shouldAutoAdvance } from "../packages/presenter-engine/src/index.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Present", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" }, briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [
      { id: "s1", order: 0, title: "One", archetype: "freeform", semantic: { purpose: "", takeaway: "", questionAnswered: "", narrativeRole: "", claimIds: [], evidenceRefs: [], audienceRelevance: "", density: "sparse" }, scene: [{ id: "a", type: "shape", semanticRole: "visual", geometry: { x: 0, y: 0, width: 100, height: 100 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#000000" }, { id: "b", type: "shape", semanticRole: "visual", geometry: { x: 200, y: 0, width: 100, height: 100 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#111111" }], speakerNotes: "Say the key point.", status: "draft", qaIssueIds: [], dependencyIds: [] },
      { id: "s2", order: 1, title: "Two", archetype: "freeform", semantic: { purpose: "", takeaway: "", questionAnswered: "", narrativeRole: "", claimIds: [], evidenceRefs: [], audienceRelevance: "", density: "sparse" }, scene: [], speakerNotes: "Close.", status: "draft", qaIssueIds: [], dependencyIds: [] },
    ],
  };
}

function motion(): MotionDocument {
  return {
    schemaVersion: "0.1", deckId: "deck", slides: [
      { slideId: "s1", transition: { type: "fade", durationMs: 300 }, tracks: [], builds: [
        { id: "build_a", slideId: "s1", elementIds: ["a"], kind: "entrance", effect: "fade", trigger: "onClick", durationMs: 300 },
        { id: "build_b", slideId: "s1", elementIds: ["b"], kind: "entrance", effect: "scale", trigger: "withPrevious", durationMs: 400 },
        { id: "build_c", slideId: "s1", elementIds: ["b"], kind: "emphasis", effect: "pulse", trigger: "onClick", durationMs: 250 },
      ] },
      { slideId: "s2", transition: { type: "push", durationMs: 400, advance: { afterMs: 5000 } }, tracks: [], builds: [] },
    ]
  };
}

test("advance walks click build groups before leaving the slide", () => {
  const d = deck();
  const m = motion();
  let state = createPresenterState(d, 1000);
  assert.equal(state.buildClickIndex, -1);
  state = advancePresenter(d, m, state, 1100);
  assert.equal(state.slideIndex, 0);
  assert.equal(state.buildClickIndex, 0);
  let view = presenterView(d, m, state, 1100);
  assert.deepEqual(view.build.currentStepIds, ["build_a", "build_b"]);
  assert.equal(view.speakerNotes, "Say the key point.");

  state = advancePresenter(d, m, state, 1200);
  assert.equal(state.buildClickIndex, 1);
  view = presenterView(d, m, state, 1200);
  assert.deepEqual(view.build.currentStepIds, ["build_c"]);

  state = advancePresenter(d, m, state, 1300);
  assert.equal(state.slideIndex, 1);
  assert.equal(state.buildClickIndex, -1);
  assert.equal(state.slideEnteredAtMs, 1300);
});

test("retreat returns to previous build and previous slide final build group", () => {
  const d = deck(); const m = motion();
  let state = createPresenterState(d, 0);
  state = advancePresenter(d, m, state, 10);
  state = advancePresenter(d, m, state, 20);
  state = retreatPresenter(d, m, state, 30);
  assert.equal(state.buildClickIndex, 0);
  state = retreatPresenter(d, m, state, 40);
  assert.equal(state.buildClickIndex, -1);
  state = advancePresenter(d, m, advancePresenter(d, m, state, 50), 60);
  state = advancePresenter(d, m, state, 70);
  assert.equal(state.slideIndex, 1);
  state = retreatPresenter(d, m, state, 80);
  assert.equal(state.slideIndex, 0);
  assert.equal(state.buildClickIndex, 1);
});

test("final slide advance marks presenter finished and retreat restores it", () => {
  const d = deck(); const m = motion();
  let state = createPresenterState(d, 0);
  state = jumpToSlide(d, state, 1, 100);
  state = advancePresenter(d, m, state, 200);
  assert.equal(state.finished, true);
  state = retreatPresenter(d, m, state, 300);
  assert.equal(state.finished, false);
  assert.equal(state.slideIndex, 1);
});

test("pause and resume exclude paused wall time from presenter timer", () => {
  const d = deck();
  let state = createPresenterState(d, 1000);
  assert.equal(presenterElapsedMs(state, 2500), 1500);
  state = pausePresenter(state, 2500);
  assert.equal(presenterElapsedMs(state, 9000), 1500);
  state = resumePresenter(state, 5000);
  assert.equal(presenterElapsedMs(state, 6000), 2500);
});

test("auto-advance waits for build completion and configured slide dwell", () => {
  const d = deck(); const m = motion();
  let state = createPresenterState(d, 0);
  state = jumpToSlide(d, state, 1, 1000);
  assert.equal(shouldAutoAdvance(d, m, state, 5999), false);
  assert.equal(shouldAutoAdvance(d, m, state, 6000), true);
});

test("jump validates slide bounds and view exposes current/next progress", () => {
  const d = deck(); const m = motion();
  const state = createPresenterState(d, 0);
  const view = presenterView(d, m, state, 500);
  assert.equal(view.currentSlide.id, "s1");
  assert.equal(view.nextSlide?.id, "s2");
  assert.equal(view.slideNumber, 1);
  assert.equal(view.slideCount, 2);
  assert.equal(view.progress, 0.5);
  assert.throws(() => jumpToSlide(d, state, 9), /out of range/);
});
