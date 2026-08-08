import { randomUUID } from "node:crypto";
import type { DeckDocument } from "../../deck-model/src/index.js";
import {
  validateMotionDocument,
  type BuildEffect,
  type BuildKind,
  type BuildStep,
  type BuildTrigger,
  type Easing,
  type MotionDocument,
  type MotionKeyframe,
  type MotionProperty,
  type MotionTrack,
  type SlideMotion,
  type SlideTransition,
} from "../../motion-engine/src/index.js";

export type MotionCommand =
  | { command: "setSlideTransition"; slideId: string; transition: SlideTransition | null }
  | {
      command: "addBuild";
      slideId: string;
      elementIds: string[];
      kind: BuildKind;
      effect: BuildEffect;
      trigger: BuildTrigger;
      durationMs: number;
      delayMs?: number;
      direction?: BuildStep["direction"];
      distanceDU?: number;
      easing?: Easing;
      buildId?: string;
    }
  | { command: "updateBuild"; slideId: string; buildId: string; changes: Partial<Omit<BuildStep, "id" | "slideId">> }
  | { command: "deleteBuild"; slideId: string; buildId: string }
  | { command: "reorderBuild"; slideId: string; buildId: string; toIndex: number }
  | {
      command: "setTrack";
      slideId: string;
      elementId: string;
      property: MotionProperty;
      keyframes: MotionKeyframe[];
      enabled?: boolean;
      trackId?: string;
    }
  | { command: "deleteTrack"; slideId: string; trackId: string }
  | { command: "clearSlideMotion"; slideId: string };

export interface MotionCommandResult {
  motion: MotionDocument;
  changed: boolean;
  reason: string;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  nextBuildId?: string;
  nextTrackId?: string;
}

function clone<T>(value: T): T { return structuredClone(value); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function assertSlide(deck: DeckDocument, slideId: string) {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  return slide;
}

function assertElementIds(deck: DeckDocument, slideId: string, elementIds: string[]): string[] {
  const slide = assertSlide(deck, slideId);
  const ids = [...new Set(elementIds)];
  if (!ids.length) throw new Error("Motion command requires at least one target element");
  for (const id of ids) if (!slide.scene.some((element) => element.id === id)) throw new Error(`Unknown element ${id} on slide ${slideId}`);
  return ids;
}

function normalizedSlideMotion(motion: MotionDocument, slideId: string): SlideMotion {
  return clone(motion.slides.find((item) => item.slideId === slideId) ?? { slideId, tracks: [], builds: [] });
}

function replaceSlideMotion(motion: MotionDocument, next: SlideMotion): MotionDocument {
  const existing = motion.slides.some((item) => item.slideId === next.slideId);
  const slides = existing
    ? motion.slides.map((item) => item.slideId === next.slideId ? next : item)
    : [...motion.slides, next];
  return { ...motion, slides };
}

function removeEmptySlideMotion(motion: MotionDocument, slideId: string): MotionDocument {
  const entry = motion.slides.find((item) => item.slideId === slideId);
  if (!entry || entry.transition || entry.tracks.length || entry.builds.length) return motion;
  return { ...motion, slides: motion.slides.filter((item) => item.slideId !== slideId) };
}

function validateResult(deck: DeckDocument, motion: MotionDocument): void {
  const critical = validateMotionDocument(deck, motion).filter((issue) => issue.severity === "critical");
  if (critical.length) throw new Error(critical.map((issue) => issue.message).join("; "));
}

export function emptyMotionDocument(deck: DeckDocument): MotionDocument {
  return { schemaVersion: "0.1", deckId: deck.id, slides: [] };
}

/** Drop references that are impossible after deck/storyboard edits. This never invents replacement motion. */
export function reconcileMotionDocument(deck: DeckDocument, input?: MotionDocument | null): MotionDocument {
  const motion = input && input.deckId === deck.id ? clone(input) : emptyMotionDocument(deck);
  const slideIds = new Set(deck.slides.map((slide) => slide.id));
  const elementIds = new Map(deck.slides.map((slide) => [slide.id, new Set(slide.scene.map((element) => element.id))]));
  const slides = motion.slides
    .filter((slideMotion) => slideIds.has(slideMotion.slideId))
    .map((slideMotion) => {
      const valid = elementIds.get(slideMotion.slideId)!;
      return {
        ...slideMotion,
        tracks: slideMotion.tracks.filter((track) => valid.has(track.elementId)),
        builds: slideMotion.builds
          .map((build) => ({ ...build, elementIds: build.elementIds.filter((id) => valid.has(id)) }))
          .filter((build) => build.elementIds.length > 0),
      };
    })
    .filter((slideMotion) => Boolean(slideMotion.transition || slideMotion.tracks.length || slideMotion.builds.length));
  const next: MotionDocument = { ...motion, deckId: deck.id, slides };
  validateResult(deck, next);
  return next;
}

export function executeMotionCommand(deck: DeckDocument, inputMotion: MotionDocument | null | undefined, command: MotionCommand): MotionCommandResult {
  assertSlide(deck, command.slideId);
  const before = reconcileMotionDocument(deck, inputMotion);
  let next = clone(before);
  let affectedElementIds: string[] = [];
  let nextBuildId: string | undefined;
  let nextTrackId: string | undefined;
  let reason = command.command;

  if (command.command === "clearSlideMotion") {
    next = { ...next, slides: next.slides.filter((item) => item.slideId !== command.slideId) };
    reason = `Clear motion on ${command.slideId}`;
  } else {
    const slideMotion = normalizedSlideMotion(next, command.slideId);

    if (command.command === "setSlideTransition") {
      slideMotion.transition = command.transition ? clone(command.transition) : undefined;
      reason = command.transition ? `Set ${command.transition.type} transition on ${command.slideId}` : `Remove transition from ${command.slideId}`;
    }

    if (command.command === "addBuild") {
      affectedElementIds = assertElementIds(deck, command.slideId, command.elementIds);
      nextBuildId = command.buildId?.trim() || `build_${randomUUID()}`;
      if (slideMotion.builds.some((build) => build.id === nextBuildId)) throw new Error(`Build id already exists: ${nextBuildId}`);
      slideMotion.builds.push({
        id: nextBuildId,
        slideId: command.slideId,
        elementIds: affectedElementIds,
        kind: command.kind,
        effect: command.effect,
        trigger: command.trigger,
        durationMs: command.durationMs,
        delayMs: command.delayMs,
        direction: command.direction,
        distanceDU: command.distanceDU,
        easing: command.easing,
      });
      reason = `Add ${command.effect} ${command.kind} build`;
    }

    if (command.command === "updateBuild") {
      const index = slideMotion.builds.findIndex((build) => build.id === command.buildId);
      if (index < 0) throw new Error(`Unknown build: ${command.buildId}`);
      const current = slideMotion.builds[index];
      const changes = clone(command.changes);
      if (changes.elementIds) changes.elementIds = assertElementIds(deck, command.slideId, changes.elementIds);
      const updated: BuildStep = { ...current, ...changes, id: current.id, slideId: current.slideId };
      affectedElementIds = [...updated.elementIds];
      slideMotion.builds[index] = updated;
      reason = `Update build ${command.buildId}`;
    }

    if (command.command === "deleteBuild") {
      const current = slideMotion.builds.find((build) => build.id === command.buildId);
      if (!current) throw new Error(`Unknown build: ${command.buildId}`);
      affectedElementIds = [...current.elementIds];
      slideMotion.builds = slideMotion.builds.filter((build) => build.id !== command.buildId);
      reason = `Delete build ${command.buildId}`;
    }

    if (command.command === "reorderBuild") {
      if (!Number.isInteger(command.toIndex) || command.toIndex < 0 || command.toIndex >= slideMotion.builds.length) throw new Error(`Invalid build destination index: ${command.toIndex}`);
      const from = slideMotion.builds.findIndex((build) => build.id === command.buildId);
      if (from < 0) throw new Error(`Unknown build: ${command.buildId}`);
      const reordered = [...slideMotion.builds];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(command.toIndex, 0, moved);
      slideMotion.builds = reordered;
      affectedElementIds = [...moved.elementIds];
      reason = `Reorder build ${command.buildId}`;
    }

    if (command.command === "setTrack") {
      const [elementId] = assertElementIds(deck, command.slideId, [command.elementId]);
      affectedElementIds = [elementId];
      const existingIndex = command.trackId
        ? slideMotion.tracks.findIndex((track) => track.id === command.trackId)
        : slideMotion.tracks.findIndex((track) => track.elementId === elementId && track.property === command.property);
      const existing = existingIndex >= 0 ? slideMotion.tracks[existingIndex] : undefined;
      const trackId = existing?.id ?? (command.trackId?.trim() || `track_${randomUUID()}`);
      nextTrackId = trackId;
      const track: MotionTrack = {
        id: trackId,
        slideId: command.slideId,
        elementId,
        property: command.property,
        keyframes: clone(command.keyframes),
        enabled: command.enabled ?? existing?.enabled ?? true,
      };
      if (existingIndex >= 0) slideMotion.tracks[existingIndex] = track;
      else slideMotion.tracks.push(track);
      reason = `Set ${command.property} motion on ${elementId}`;
    }

    if (command.command === "deleteTrack") {
      const current = slideMotion.tracks.find((track) => track.id === command.trackId);
      if (!current) throw new Error(`Unknown motion track: ${command.trackId}`);
      affectedElementIds = [current.elementId];
      slideMotion.tracks = slideMotion.tracks.filter((track) => track.id !== command.trackId);
      reason = `Delete motion track ${command.trackId}`;
    }

    next = replaceSlideMotion(next, slideMotion);
    next = removeEmptySlideMotion(next, command.slideId);
  }

  validateResult(deck, next);
  return {
    motion: next,
    changed: !same(before, next),
    reason,
    affectedSlideIds: [command.slideId],
    affectedElementIds,
    nextBuildId,
    nextTrackId,
  };
}
