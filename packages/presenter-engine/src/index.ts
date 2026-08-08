import type { DeckDocument, SlideDocument } from "../../deck-model/src/index.js";
import { compileBuildPhases, type MotionDocument, type SlideMotion, type SlideTransition } from "../../motion-engine/src/index.js";

export interface PresenterState {
  deckId: string;
  slideIndex: number;
  buildClickIndex: number;
  startedAtMs: number;
  slideEnteredAtMs: number;
  pausedAtMs?: number;
  elapsedBeforePauseMs: number;
  finished: boolean;
}

export interface PresenterView {
  currentSlide: SlideDocument;
  nextSlide?: SlideDocument;
  slideNumber: number;
  slideCount: number;
  progress: number;
  speakerNotes?: string;
  build: {
    activeClickIndex: number;
    clickCount: number;
    currentStepIds: string[];
    completedStepIds: string[];
  };
  transition?: SlideTransition;
  autoAdvanceAtMs?: number;
  elapsedMs: number;
  finished: boolean;
}

function nowValue(nowMs?: number): number {
  const value = nowMs ?? Date.now();
  if (!Number.isFinite(value) || value < 0) throw new Error("Presenter time must be a non-negative finite number");
  return value;
}

function motionFor(motion: MotionDocument | undefined, slideId: string): SlideMotion | undefined {
  return motion?.slides.find((entry) => entry.slideId === slideId);
}

function clickCount(slideMotion?: SlideMotion): number {
  if (!slideMotion) return 0;
  const phases = compileBuildPhases(slideMotion.builds);
  return phases.length ? Math.max(...phases.map((phase) => phase.clickIndex)) + 1 : 0;
}

function clampState(deck: DeckDocument, state: PresenterState): PresenterState {
  if (state.deckId !== deck.id) throw new Error(`Presenter state belongs to ${state.deckId}, current deck is ${deck.id}`);
  if (!deck.slides.length) throw new Error("Cannot present an empty deck");
  const slideIndex = Math.max(0, Math.min(deck.slides.length - 1, state.slideIndex));
  return { ...state, slideIndex };
}

export function createPresenterState(deck: DeckDocument, nowMs?: number): PresenterState {
  if (!deck.slides.length) throw new Error("Cannot present an empty deck");
  const now = nowValue(nowMs);
  return {
    deckId: deck.id,
    slideIndex: 0,
    buildClickIndex: -1,
    startedAtMs: now,
    slideEnteredAtMs: now,
    elapsedBeforePauseMs: 0,
    finished: false,
  };
}

export function advancePresenter(deck: DeckDocument, motion: MotionDocument | undefined, stateInput: PresenterState, nowMs?: number): PresenterState {
  const now = nowValue(nowMs);
  const state = clampState(deck, stateInput);
  if (state.finished) return state;
  const slide = deck.slides[state.slideIndex];
  const count = clickCount(motionFor(motion, slide.id));
  if (state.buildClickIndex + 1 < count) return { ...state, buildClickIndex: state.buildClickIndex + 1 };
  if (state.slideIndex + 1 < deck.slides.length) return { ...state, slideIndex: state.slideIndex + 1, buildClickIndex: -1, slideEnteredAtMs: now };
  return { ...state, finished: true };
}

export function retreatPresenter(deck: DeckDocument, motion: MotionDocument | undefined, stateInput: PresenterState, nowMs?: number): PresenterState {
  const now = nowValue(nowMs);
  const state = clampState(deck, stateInput);
  if (state.finished) {
    const last = deck.slides[deck.slides.length - 1];
    return { ...state, finished: false, slideIndex: deck.slides.length - 1, buildClickIndex: clickCount(motionFor(motion, last.id)) - 1, slideEnteredAtMs: now };
  }
  if (state.buildClickIndex >= 0) return { ...state, buildClickIndex: state.buildClickIndex - 1 };
  if (state.slideIndex <= 0) return state;
  const previousIndex = state.slideIndex - 1;
  const previous = deck.slides[previousIndex];
  return { ...state, slideIndex: previousIndex, buildClickIndex: clickCount(motionFor(motion, previous.id)) - 1, slideEnteredAtMs: now };
}

export function jumpToSlide(deck: DeckDocument, stateInput: PresenterState, slideIndex: number, nowMs?: number): PresenterState {
  const now = nowValue(nowMs);
  const state = clampState(deck, stateInput);
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= deck.slides.length) throw new Error(`Presenter slide index ${slideIndex} is out of range`);
  return { ...state, slideIndex, buildClickIndex: -1, slideEnteredAtMs: now, finished: false };
}

export function pausePresenter(state: PresenterState, nowMs?: number): PresenterState {
  if (state.pausedAtMs !== undefined) return state;
  return { ...state, pausedAtMs: nowValue(nowMs) };
}

export function resumePresenter(state: PresenterState, nowMs?: number): PresenterState {
  if (state.pausedAtMs === undefined) return state;
  const now = nowValue(nowMs);
  return { ...state, elapsedBeforePauseMs: state.elapsedBeforePauseMs + Math.max(0, now - state.pausedAtMs), pausedAtMs: undefined };
}

export function presenterElapsedMs(state: PresenterState, nowMs?: number): number {
  const now = state.pausedAtMs ?? nowValue(nowMs);
  return Math.max(0, now - state.startedAtMs - state.elapsedBeforePauseMs);
}

export function presenterView(deck: DeckDocument, motion: MotionDocument | undefined, stateInput: PresenterState, nowMs?: number): PresenterView {
  const state = clampState(deck, stateInput);
  const currentSlide = deck.slides[state.slideIndex];
  const nextSlide = deck.slides[state.slideIndex + 1];
  const slideMotion = motionFor(motion, currentSlide.id);
  const phases = slideMotion ? compileBuildPhases(slideMotion.builds) : [];
  const count = phases.length ? Math.max(...phases.map((phase) => phase.clickIndex)) + 1 : 0;
  const currentStepIds = phases.filter((phase) => phase.clickIndex === state.buildClickIndex).map((phase) => phase.stepId);
  const completedStepIds = phases.filter((phase) => phase.clickIndex <= state.buildClickIndex).map((phase) => phase.stepId);
  const advance = slideMotion?.transition?.advance;
  const autoAdvanceAtMs = typeof advance === "object" ? state.slideEnteredAtMs + advance.afterMs : undefined;
  return {
    currentSlide,
    nextSlide,
    slideNumber: state.slideIndex + 1,
    slideCount: deck.slides.length,
    progress: (state.slideIndex + 1) / deck.slides.length,
    speakerNotes: currentSlide.speakerNotes,
    build: { activeClickIndex: state.buildClickIndex, clickCount: count, currentStepIds, completedStepIds },
    transition: slideMotion?.transition,
    autoAdvanceAtMs,
    elapsedMs: presenterElapsedMs(state, nowMs),
    finished: state.finished,
  };
}

export function shouldAutoAdvance(deck: DeckDocument, motion: MotionDocument | undefined, stateInput: PresenterState, nowMs?: number): boolean {
  const now = nowValue(nowMs);
  const view = presenterView(deck, motion, stateInput, now);
  if (view.autoAdvanceAtMs === undefined) return false;
  return stateInput.buildClickIndex >= view.build.clickCount - 1 && now >= view.autoAdvanceAtMs;
}
