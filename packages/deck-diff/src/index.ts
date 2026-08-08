import type { DeckDocument, SceneElement, SlideDocument } from "../../deck-model/src/index.js";

export type SlideDiffKind = "added" | "removed" | "moved" | "renamed" | "semantic" | "scene";
export type ElementDiffKind = "added" | "removed" | "typeChanged" | "geometry" | "presentation" | "content" | "dependencies";

export interface ElementDiff {
  elementId: string;
  kind: ElementDiffKind;
  before?: unknown;
  after?: unknown;
  fields?: string[];
}

export interface SlideDiff {
  slideId: string;
  kinds: SlideDiffKind[];
  beforeOrder?: number;
  afterOrder?: number;
  beforeTitle?: string;
  afterTitle?: string;
  semanticFields: string[];
  elementDiffs: ElementDiff[];
}

export interface DeckDiff {
  beforeDeckId: string;
  afterDeckId: string;
  changed: boolean;
  slideDiffs: SlideDiff[];
  summary: {
    slidesAdded: number;
    slidesRemoved: number;
    slidesMoved: number;
    semanticChanges: number;
    elementsAdded: number;
    elementsRemoved: number;
    geometryChanges: number;
    presentationChanges: number;
    contentChanges: number;
  };
}

const PRESENTATION_FIELDS = ["name", "zIndex", "opacity", "locked", "exportStrategy"] as const;
const SEMANTIC_FIELDS = ["purpose", "takeaway", "questionAnswered", "narrativeRole", "claimIds", "evidenceRefs", "audienceRelevance", "decisionContribution", "density"] as const;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${stable(val)}`).join(",")}}`;
  return JSON.stringify(value);
}

function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function geometry(element: SceneElement) {
  return element.geometry;
}

function presentation(element: SceneElement) {
  return Object.fromEntries(PRESENTATION_FIELDS.map((field) => [field, (element as any)[field]]));
}

function dependencies(element: SceneElement) {
  return [...element.dependencies].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

function content(element: SceneElement): unknown {
  const commonExcluded = new Set(["id", "type", "name", "semanticRole", "geometry", "zIndex", "locked", "opacity", "origin", "exportStrategy", "dependencies", "tags", "groupId", "layoutItem"]);
  return Object.fromEntries(Object.entries(element as any).filter(([key]) => !commonExcluded.has(key)).sort(([a], [b]) => a.localeCompare(b)));
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !same(before[key], after[key])).sort();
}

function elementDiff(before: SceneElement | undefined, after: SceneElement | undefined): ElementDiff[] {
  if (!before && after) return [{ elementId: after.id, kind: "added", after: structuredClone(after) }];
  if (before && !after) return [{ elementId: before.id, kind: "removed", before: structuredClone(before) }];
  if (!before || !after) return [];
  if (before.type !== after.type) return [{ elementId: before.id, kind: "typeChanged", before: before.type, after: after.type }];
  const diffs: ElementDiff[] = [];
  if (!same(geometry(before), geometry(after))) diffs.push({ elementId: before.id, kind: "geometry", before: structuredClone(geometry(before)), after: structuredClone(geometry(after)), fields: changedFields(geometry(before) as any, geometry(after) as any) });
  const beforePresentation = presentation(before);
  const afterPresentation = presentation(after);
  if (!same(beforePresentation, afterPresentation)) diffs.push({ elementId: before.id, kind: "presentation", before: beforePresentation, after: afterPresentation, fields: changedFields(beforePresentation, afterPresentation) });
  const beforeContent = content(before);
  const afterContent = content(after);
  if (!same(beforeContent, afterContent)) diffs.push({ elementId: before.id, kind: "content", before: structuredClone(beforeContent), after: structuredClone(afterContent), fields: changedFields(beforeContent as any, afterContent as any) });
  const beforeDependencies = dependencies(before);
  const afterDependencies = dependencies(after);
  if (!same(beforeDependencies, afterDependencies)) diffs.push({ elementId: before.id, kind: "dependencies", before: beforeDependencies, after: afterDependencies });
  return diffs;
}

function semanticDiff(before: SlideDocument, after: SlideDocument): string[] {
  return SEMANTIC_FIELDS.filter((field) => !same((before.semantic as any)[field], (after.semantic as any)[field]));
}

function sceneDiff(before: SlideDocument, after: SlideDocument): ElementDiff[] {
  const ids = [...new Set([...before.scene.map((element) => element.id), ...after.scene.map((element) => element.id)])];
  const beforeById = new Map(before.scene.map((element) => [element.id, element]));
  const afterById = new Map(after.scene.map((element) => [element.id, element]));
  return ids.flatMap((id) => elementDiff(beforeById.get(id), afterById.get(id))).sort((a, b) => a.elementId.localeCompare(b.elementId) || a.kind.localeCompare(b.kind));
}

function addedSlide(slide: SlideDocument): SlideDiff {
  return { slideId: slide.id, kinds: ["added"], afterOrder: slide.order, afterTitle: slide.title, semanticFields: [], elementDiffs: slide.scene.map((element) => ({ elementId: element.id, kind: "added" as const, after: structuredClone(element) })) };
}

function removedSlide(slide: SlideDocument): SlideDiff {
  return { slideId: slide.id, kinds: ["removed"], beforeOrder: slide.order, beforeTitle: slide.title, semanticFields: [], elementDiffs: slide.scene.map((element) => ({ elementId: element.id, kind: "removed" as const, before: structuredClone(element) })) };
}

export function diffDecks(before: DeckDocument, after: DeckDocument): DeckDiff {
  const beforeById = new Map(before.slides.map((slide) => [slide.id, slide]));
  const afterById = new Map(after.slides.map((slide) => [slide.id, slide]));
  const ids = [...new Set([...before.slides.map((slide) => slide.id), ...after.slides.map((slide) => slide.id)])];
  const slideDiffs: SlideDiff[] = [];

  for (const id of ids) {
    const a = beforeById.get(id);
    const b = afterById.get(id);
    if (!a && b) { slideDiffs.push(addedSlide(b)); continue; }
    if (a && !b) { slideDiffs.push(removedSlide(a)); continue; }
    if (!a || !b) continue;
    const kinds: SlideDiffKind[] = [];
    if (a.order !== b.order) kinds.push("moved");
    if (a.title !== b.title) kinds.push("renamed");
    const semanticFields = semanticDiff(a, b);
    if (semanticFields.length) kinds.push("semantic");
    const elementDiffs = sceneDiff(a, b);
    if (elementDiffs.length) kinds.push("scene");
    if (kinds.length) slideDiffs.push({ slideId: id, kinds, beforeOrder: a.order, afterOrder: b.order, beforeTitle: a.title, afterTitle: b.title, semanticFields, elementDiffs });
  }

  const allElements = slideDiffs.flatMap((slide) => slide.elementDiffs);
  const count = (kind: ElementDiffKind) => allElements.filter((diff) => diff.kind === kind).length;
  const summary = {
    slidesAdded: slideDiffs.filter((slide) => slide.kinds.includes("added")).length,
    slidesRemoved: slideDiffs.filter((slide) => slide.kinds.includes("removed")).length,
    slidesMoved: slideDiffs.filter((slide) => slide.kinds.includes("moved")).length,
    semanticChanges: slideDiffs.reduce((sum, slide) => sum + slide.semanticFields.length, 0),
    elementsAdded: count("added"),
    elementsRemoved: count("removed"),
    geometryChanges: count("geometry"),
    presentationChanges: count("presentation"),
    contentChanges: count("content"),
  };
  return { beforeDeckId: before.id, afterDeckId: after.id, changed: slideDiffs.length > 0, slideDiffs, summary };
}
