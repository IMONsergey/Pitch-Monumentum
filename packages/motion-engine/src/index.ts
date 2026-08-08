import type { DeckDocument, Geometry, SceneElement } from "../../deck-model/src/index.js";

export type MotionProperty = "x" | "y" | "width" | "height" | "rotation" | "opacity" | "scaleX" | "scaleY";
export type NamedEasing = "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut";
export type Easing = NamedEasing | { type: "cubicBezier"; x1: number; y1: number; x2: number; y2: number };

export interface MotionKeyframe {
  timeMs: number;
  value: number;
  easing?: Easing;
}

export interface MotionTrack {
  id: string;
  slideId: string;
  elementId: string;
  property: MotionProperty;
  keyframes: MotionKeyframe[];
  enabled?: boolean;
}

export type BuildTrigger = "onClick" | "withPrevious" | "afterPrevious";
export type BuildKind = "entrance" | "emphasis" | "exit";
export type BuildEffect = "appear" | "fade" | "scale" | "slide" | "wipe" | "pulse";

export interface BuildStep {
  id: string;
  slideId: string;
  elementIds: string[];
  kind: BuildKind;
  effect: BuildEffect;
  trigger: BuildTrigger;
  durationMs: number;
  delayMs?: number;
  direction?: "left" | "right" | "up" | "down";
  distanceDU?: number;
  easing?: Easing;
}

export type SlideTransitionType = "none" | "fade" | "push" | "wipe" | "dissolve";

export interface SlideTransition {
  type: SlideTransitionType;
  durationMs: number;
  direction?: "left" | "right" | "up" | "down";
  advance?: "manual" | { afterMs: number };
}

export interface SlideMotion {
  slideId: string;
  transition?: SlideTransition;
  tracks: MotionTrack[];
  builds: BuildStep[];
}

export interface MotionDocument {
  schemaVersion: "0.1";
  deckId: string;
  slides: SlideMotion[];
}

export interface MotionIssue {
  severity: "minor" | "major" | "critical";
  code: string;
  slideId?: string;
  elementId?: string;
  message: string;
}

export interface BuildPhase {
  clickIndex: number;
  stepId: string;
  slideId: string;
  elementIds: string[];
  kind: BuildKind;
  effect: BuildEffect;
  trigger: BuildTrigger;
  relativeStartMs: number;
  durationMs: number;
  direction?: BuildStep["direction"];
  distanceDU?: number;
  easing: Easing;
}

export interface SampledElementMotion {
  elementId: string;
  geometry?: Partial<Geometry>;
  opacity?: number;
  scaleX?: number;
  scaleY?: number;
}

const EPS = 1e-7;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function nonNegative(value: number, label: string): number {
  finite(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cubicBezierCoordinate(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function cubicBezierDerivative(t: number, p1: number, p2: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** Solve x(t)=progress, then return y(t). Deterministic Newton + bisection fallback. */
export function evaluateEasing(easing: Easing | undefined, progress: number): number {
  const p = clamp01(progress);
  if (!easing || easing === "linear") return p;
  let curve: [number, number, number, number];
  if (easing === "ease") curve = [0.25, 0.1, 0.25, 1];
  else if (easing === "easeIn") curve = [0.42, 0, 1, 1];
  else if (easing === "easeOut") curve = [0, 0, 0.58, 1];
  else if (easing === "easeInOut") curve = [0.42, 0, 0.58, 1];
  else {
    curve = [
      clamp01(finite(easing.x1, "easing.x1")),
      finite(easing.y1, "easing.y1"),
      clamp01(finite(easing.x2, "easing.x2")),
      finite(easing.y2, "easing.y2"),
    ];
  }
  const [x1, y1, x2, y2] = curve;
  let t = p;
  for (let i = 0; i < 8; i += 1) {
    const x = cubicBezierCoordinate(t, x1, x2) - p;
    if (Math.abs(x) < EPS) return cubicBezierCoordinate(t, y1, y2);
    const derivative = cubicBezierDerivative(t, x1, x2);
    if (Math.abs(derivative) < EPS) break;
    const next = t - x / derivative;
    if (next < 0 || next > 1) break;
    t = next;
  }
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    t = (low + high) / 2;
    const x = cubicBezierCoordinate(t, x1, x2);
    if (Math.abs(x - p) < EPS) break;
    if (x < p) low = t; else high = t;
  }
  return cubicBezierCoordinate(t, y1, y2);
}

function sortedKeyframes(track: MotionTrack): MotionKeyframe[] {
  if (track.keyframes.length < 1) throw new Error(`Motion track ${track.id} has no keyframes`);
  const frames = [...track.keyframes].map((frame, index) => ({
    ...frame,
    timeMs: nonNegative(frame.timeMs, `${track.id} keyframe ${index} timeMs`),
    value: finite(frame.value, `${track.id} keyframe ${index} value`),
  })).sort((a, b) => a.timeMs - b.timeMs);
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].timeMs === frames[i - 1].timeMs) throw new Error(`Motion track ${track.id} contains duplicate keyframe time ${frames[i].timeMs}`);
  }
  return frames;
}

export function sampleTrack(track: MotionTrack, timeMs: number): number {
  const time = nonNegative(timeMs, "timeMs");
  const frames = sortedKeyframes(track);
  if (time <= frames[0].timeMs) return frames[0].value;
  if (time >= frames[frames.length - 1].timeMs) return frames[frames.length - 1].value;
  for (let i = 1; i < frames.length; i += 1) {
    const right = frames[i];
    if (time > right.timeMs) continue;
    const left = frames[i - 1];
    const raw = (time - left.timeMs) / (right.timeMs - left.timeMs);
    const eased = evaluateEasing(right.easing ?? left.easing, raw);
    return left.value + (right.value - left.value) * eased;
  }
  return frames[frames.length - 1].value;
}

export function compileBuildPhases(builds: BuildStep[]): BuildPhase[] {
  const phases: BuildPhase[] = [];
  let clickIndex = -1;
  let previousStart = 0;
  let previousEnd = 0;
  for (const [index, step] of builds.entries()) {
    if (!step.elementIds.length) throw new Error(`Build ${step.id} has no element targets`);
    const durationMs = nonNegative(step.durationMs, `${step.id} durationMs`);
    const delayMs = nonNegative(step.delayMs ?? 0, `${step.id} delayMs`);
    let relativeStartMs: number;
    if (step.trigger === "onClick") {
      clickIndex += 1;
      relativeStartMs = delayMs;
      previousStart = relativeStartMs;
      previousEnd = relativeStartMs + durationMs;
    } else if (step.trigger === "withPrevious") {
      if (index === 0) clickIndex = 0;
      relativeStartMs = previousStart + delayMs;
      previousEnd = Math.max(previousEnd, relativeStartMs + durationMs);
    } else {
      if (index === 0) clickIndex = 0;
      relativeStartMs = previousEnd + delayMs;
      previousStart = relativeStartMs;
      previousEnd = relativeStartMs + durationMs;
    }
    phases.push({
      clickIndex: Math.max(0, clickIndex),
      stepId: step.id,
      slideId: step.slideId,
      elementIds: [...new Set(step.elementIds)],
      kind: step.kind,
      effect: step.effect,
      trigger: step.trigger,
      relativeStartMs,
      durationMs,
      direction: step.direction,
      distanceDU: step.distanceDU,
      easing: step.easing ?? "easeInOut",
    });
  }
  return phases;
}

function slideById(deck: DeckDocument, slideId: string) {
  return deck.slides.find((slide) => slide.id === slideId);
}

function elementById(deck: DeckDocument, slideId: string, elementId: string): SceneElement | undefined {
  return slideById(deck, slideId)?.scene.find((element) => element.id === elementId);
}

export function validateMotionDocument(deck: DeckDocument, motion: MotionDocument): MotionIssue[] {
  const issues: MotionIssue[] = [];
  if (motion.deckId !== deck.id) issues.push({ severity: "critical", code: "motion:deck-mismatch", message: `Motion document belongs to ${motion.deckId}, current deck is ${deck.id}` });
  const seenTracks = new Set<string>();
  const seenBuilds = new Set<string>();
  for (const slideMotion of motion.slides) {
    const slide = slideById(deck, slideMotion.slideId);
    if (!slide) {
      issues.push({ severity: "critical", code: "motion:missing-slide", slideId: slideMotion.slideId, message: `Motion references missing slide ${slideMotion.slideId}` });
      continue;
    }
    if (slideMotion.transition) {
      if (!Number.isFinite(slideMotion.transition.durationMs) || slideMotion.transition.durationMs < 0) issues.push({ severity: "critical", code: "motion:invalid-transition-duration", slideId: slide.id, message: "Slide transition duration must be non-negative" });
      if (typeof slideMotion.transition.advance === "object" && (!Number.isFinite(slideMotion.transition.advance.afterMs) || slideMotion.transition.advance.afterMs < 0)) issues.push({ severity: "critical", code: "motion:invalid-auto-advance", slideId: slide.id, message: "Slide auto-advance must be non-negative" });
    }
    for (const track of slideMotion.tracks) {
      if (seenTracks.has(track.id)) issues.push({ severity: "critical", code: "motion:duplicate-track-id", slideId: slide.id, elementId: track.elementId, message: `Duplicate motion track id ${track.id}` });
      seenTracks.add(track.id);
      if (track.slideId !== slide.id) issues.push({ severity: "critical", code: "motion:track-slide-mismatch", slideId: slide.id, elementId: track.elementId, message: `Track ${track.id} declares slide ${track.slideId}` });
      if (!elementById(deck, slide.id, track.elementId)) issues.push({ severity: "critical", code: "motion:missing-element", slideId: slide.id, elementId: track.elementId, message: `Track ${track.id} targets missing element ${track.elementId}` });
      try { sortedKeyframes(track); } catch (error) { issues.push({ severity: "critical", code: "motion:invalid-keyframes", slideId: slide.id, elementId: track.elementId, message: error instanceof Error ? error.message : String(error) }); }
      if ((track.property === "opacity" || track.property === "scaleX" || track.property === "scaleY") && track.keyframes.some((frame) => frame.value < 0)) issues.push({ severity: "major", code: "motion:negative-visual-value", slideId: slide.id, elementId: track.elementId, message: `${track.property} has a negative keyframe value` });
    }
    for (const build of slideMotion.builds) {
      if (seenBuilds.has(build.id)) issues.push({ severity: "critical", code: "motion:duplicate-build-id", slideId: slide.id, message: `Duplicate build id ${build.id}` });
      seenBuilds.add(build.id);
      if (build.slideId !== slide.id) issues.push({ severity: "critical", code: "motion:build-slide-mismatch", slideId: slide.id, message: `Build ${build.id} declares slide ${build.slideId}` });
      for (const elementId of build.elementIds) if (!elementById(deck, slide.id, elementId)) issues.push({ severity: "critical", code: "motion:missing-build-element", slideId: slide.id, elementId, message: `Build ${build.id} targets missing element ${elementId}` });
      try { nonNegative(build.durationMs, `${build.id} durationMs`); nonNegative(build.delayMs ?? 0, `${build.id} delayMs`); } catch (error) { issues.push({ severity: "critical", code: "motion:invalid-build-timing", slideId: slide.id, message: error instanceof Error ? error.message : String(error) }); }
    }
    try { compileBuildPhases(slideMotion.builds); } catch (error) { issues.push({ severity: "critical", code: "motion:invalid-build-order", slideId: slide.id, message: error instanceof Error ? error.message : String(error) }); }
  }
  return issues;
}

export function sampleSlideMotion(slideMotion: SlideMotion, timeMs: number): Map<string, SampledElementMotion> {
  const result = new Map<string, SampledElementMotion>();
  for (const track of slideMotion.tracks) {
    if (track.enabled === false) continue;
    const entry = result.get(track.elementId) ?? { elementId: track.elementId };
    const value = sampleTrack(track, timeMs);
    if (track.property === "opacity") entry.opacity = value;
    else if (track.property === "scaleX") entry.scaleX = value;
    else if (track.property === "scaleY") entry.scaleY = value;
    else {
      entry.geometry = { ...(entry.geometry ?? {}), [track.property]: value };
    }
    result.set(track.elementId, entry);
  }
  return result;
}

export function motionDuration(slideMotion: SlideMotion): number {
  const trackEnd = slideMotion.tracks.reduce((max, track) => Math.max(max, ...track.keyframes.map((frame) => frame.timeMs)), 0);
  const phases = compileBuildPhases(slideMotion.builds);
  const buildEnd = phases.reduce((max, phase) => Math.max(max, phase.relativeStartMs + phase.durationMs), 0);
  return Math.max(trackEnd, buildEnd, slideMotion.transition?.durationMs ?? 0);
}
