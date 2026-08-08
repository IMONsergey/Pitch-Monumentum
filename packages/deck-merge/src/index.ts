import type { DeckDocument, SceneElement, SlideDocument, SlideSemanticContract } from "../../deck-model/src/index.js";

export interface MergeConflict {
  scope: "deck" | "slide" | "semantic" | "element" | "order";
  slideId?: string;
  elementId?: string;
  field?: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
  message: string;
}

export interface DeckMergeResult {
  deck: DeckDocument;
  conflicts: MergeConflict[];
  applied: Array<{ scope: MergeConflict["scope"]; slideId?: string; elementId?: string; field?: string; source: "theirs" }>;
  changed: boolean;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${stable(val)}`).join(",")}}`;
  return JSON.stringify(value);
}

function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fieldMerge<T>(base: T, ours: T, theirs: T): { value: T; source?: "theirs"; conflict?: boolean } {
  if (same(ours, theirs)) return { value: clone(ours) };
  if (same(ours, base) && !same(theirs, base)) return { value: clone(theirs), source: "theirs" };
  if (same(theirs, base)) return { value: clone(ours) };
  return { value: clone(ours), conflict: true };
}

function semanticFields(): Array<keyof SlideSemanticContract> {
  return ["purpose", "takeaway", "questionAnswered", "narrativeRole", "claimIds", "evidenceRefs", "audienceRelevance", "decisionContribution", "density"];
}

function mergeSemantic(base: SlideDocument, ours: SlideDocument, theirs: SlideDocument, conflicts: MergeConflict[], applied: DeckMergeResult["applied"]): SlideSemanticContract {
  const result = clone(ours.semantic) as any;
  for (const field of semanticFields()) {
    const merged = fieldMerge((base.semantic as any)[field], (ours.semantic as any)[field], (theirs.semantic as any)[field]);
    result[field] = merged.value;
    if (merged.source) applied.push({ scope: "semantic", slideId: ours.id, field: String(field), source: "theirs" });
    if (merged.conflict) conflicts.push({ scope: "semantic", slideId: ours.id, field: String(field), base: clone((base.semantic as any)[field]), ours: clone((ours.semantic as any)[field]), theirs: clone((theirs.semantic as any)[field]), message: `Both branches changed slide ${ours.id} semantic field ${String(field)} differently.` });
  }
  return result as SlideSemanticContract;
}

function elementMap(slide?: SlideDocument): Map<string, SceneElement> {
  return new Map((slide?.scene ?? []).map((element) => [element.id, element]));
}

function mergeElement(base: SceneElement | undefined, ours: SceneElement | undefined, theirs: SceneElement | undefined, slideId: string, elementId: string, conflicts: MergeConflict[], applied: DeckMergeResult["applied"]): SceneElement | undefined {
  if (!base) {
    if (ours && !theirs) return clone(ours);
    if (!ours && theirs) { applied.push({ scope: "element", slideId, elementId, source: "theirs" }); return clone(theirs); }
    if (ours && theirs) {
      if (same(ours, theirs)) return clone(ours);
      conflicts.push({ scope: "element", slideId, elementId, base: undefined, ours: clone(ours), theirs: clone(theirs), message: `Both branches added element ${elementId} differently.` });
      return clone(ours);
    }
    return undefined;
  }

  if (!ours && !theirs) return undefined;
  if (!ours && theirs) {
    if (same(theirs, base)) return undefined;
    conflicts.push({ scope: "element", slideId, elementId, base: clone(base), ours: undefined, theirs: clone(theirs), message: `Our branch removed element ${elementId} while their branch modified it.` });
    return undefined;
  }
  if (ours && !theirs) {
    if (same(ours, base)) { applied.push({ scope: "element", slideId, elementId, source: "theirs" }); return undefined; }
    conflicts.push({ scope: "element", slideId, elementId, base: clone(base), ours: clone(ours), theirs: undefined, message: `Their branch removed element ${elementId} while our branch modified it.` });
    return clone(ours);
  }
  if (!ours || !theirs) return clone(ours ?? theirs!);
  const merged = fieldMerge(base, ours, theirs);
  if (merged.source) { applied.push({ scope: "element", slideId, elementId, source: "theirs" }); return clone(theirs); }
  if (merged.conflict) {
    conflicts.push({ scope: "element", slideId, elementId, base: clone(base), ours: clone(ours), theirs: clone(theirs), message: `Both branches changed element ${elementId} differently.` });
    return clone(ours);
  }
  return clone(merged.value);
}

function mergeScene(base: SlideDocument, ours: SlideDocument, theirs: SlideDocument, conflicts: MergeConflict[], applied: DeckMergeResult["applied"]): SceneElement[] {
  const b = elementMap(base);
  const o = elementMap(ours);
  const t = elementMap(theirs);
  const ids = [...new Set([...b.keys(), ...o.keys(), ...t.keys()])];
  const merged = ids.map((id) => mergeElement(b.get(id), o.get(id), t.get(id), ours.id, id, conflicts, applied)).filter((element): element is SceneElement => Boolean(element));
  const orderRank = new Map(ours.scene.map((element, index) => [element.id, index]));
  return merged.sort((a, bElement) => {
    const ar = orderRank.get(a.id);
    const br = orderRank.get(bElement.id);
    if (ar !== undefined && br !== undefined) return ar - br;
    if (ar !== undefined) return -1;
    if (br !== undefined) return 1;
    return a.zIndex - bElement.zIndex || a.id.localeCompare(bElement.id);
  });
}

function mergeExistingSlide(base: SlideDocument, ours: SlideDocument, theirs: SlideDocument, conflicts: MergeConflict[], applied: DeckMergeResult["applied"]): SlideDocument {
  const result = clone(ours);
  for (const field of ["title", "archetype", "sectionId", "recipeId", "speakerNotes"] as const) {
    const merged = fieldMerge((base as any)[field], (ours as any)[field], (theirs as any)[field]);
    (result as any)[field] = merged.value;
    if (merged.source) applied.push({ scope: "slide", slideId: ours.id, field, source: "theirs" });
    if (merged.conflict) conflicts.push({ scope: "slide", slideId: ours.id, field, base: clone((base as any)[field]), ours: clone((ours as any)[field]), theirs: clone((theirs as any)[field]), message: `Both branches changed slide ${ours.id} field ${field} differently.` });
  }
  result.semantic = mergeSemantic(base, ours, theirs, conflicts, applied);
  result.scene = mergeScene(base, ours, theirs, conflicts, applied);
  const deps = fieldMerge(base.dependencyIds, ours.dependencyIds, theirs.dependencyIds);
  result.dependencyIds = deps.value;
  if (deps.source) applied.push({ scope: "slide", slideId: ours.id, field: "dependencyIds", source: "theirs" });
  if (deps.conflict) conflicts.push({ scope: "slide", slideId: ours.id, field: "dependencyIds", base: clone(base.dependencyIds), ours: clone(ours.dependencyIds), theirs: clone(theirs.dependencyIds), message: `Both branches changed slide ${ours.id} dependencies differently.` });
  result.qaIssueIds = [];
  result.status = "draft";
  return result;
}

function slideMap(deck: DeckDocument): Map<string, SlideDocument> {
  return new Map(deck.slides.map((slide) => [slide.id, slide]));
}

function mergeSlide(base: SlideDocument | undefined, ours: SlideDocument | undefined, theirs: SlideDocument | undefined, conflicts: MergeConflict[], applied: DeckMergeResult["applied"]): SlideDocument | undefined {
  const id = ours?.id ?? theirs?.id ?? base?.id ?? "unknown";
  if (!base) {
    if (ours && !theirs) return clone(ours);
    if (!ours && theirs) { applied.push({ scope: "slide", slideId: id, source: "theirs" }); return clone(theirs); }
    if (ours && theirs) {
      if (same(ours, theirs)) return clone(ours);
      conflicts.push({ scope: "slide", slideId: id, base: undefined, ours: clone(ours), theirs: clone(theirs), message: `Both branches added slide ${id} differently.` });
      return clone(ours);
    }
    return undefined;
  }
  if (!ours && !theirs) return undefined;
  if (!ours && theirs) {
    if (same(theirs, base)) return undefined;
    conflicts.push({ scope: "slide", slideId: id, base: clone(base), ours: undefined, theirs: clone(theirs), message: `Our branch removed slide ${id} while their branch modified it.` });
    return undefined;
  }
  if (ours && !theirs) {
    if (same(ours, base)) { applied.push({ scope: "slide", slideId: id, source: "theirs" }); return undefined; }
    conflicts.push({ scope: "slide", slideId: id, base: clone(base), ours: clone(ours), theirs: undefined, message: `Their branch removed slide ${id} while our branch modified it.` });
    return clone(ours);
  }
  return mergeExistingSlide(base, ours!, theirs!, conflicts, applied);
}

function orderMap(deck: DeckDocument): Map<string, number> {
  return new Map(deck.slides.map((slide) => [slide.id, slide.order]));
}

export function mergeDecks(base: DeckDocument, ours: DeckDocument, theirs: DeckDocument): DeckMergeResult {
  if (base.id !== ours.id || base.id !== theirs.id) throw new Error("Three-way merge requires the same deck id in base, ours and theirs");
  const conflicts: MergeConflict[] = [];
  const applied: DeckMergeResult["applied"] = [];
  const b = slideMap(base);
  const o = slideMap(ours);
  const t = slideMap(theirs);
  const ids = [...new Set([...b.keys(), ...o.keys(), ...t.keys()])];
  const mergedSlides = ids.map((id) => mergeSlide(b.get(id), o.get(id), t.get(id), conflicts, applied)).filter((slide): slide is SlideDocument => Boolean(slide));

  const baseOrder = orderMap(base);
  const ourOrder = orderMap(ours);
  const theirOrder = orderMap(theirs);
  const rank = new Map<string, number>();
  for (const slide of mergedSlides) {
    const baseValue = baseOrder.get(slide.id);
    const ourValue = ourOrder.get(slide.id);
    const theirValue = theirOrder.get(slide.id);
    if (baseValue === undefined) rank.set(slide.id, ourValue ?? theirValue ?? 99999);
    else if (ourValue === theirValue) rank.set(slide.id, ourValue ?? baseValue);
    else if (ourValue === baseValue && theirValue !== undefined) { rank.set(slide.id, theirValue); applied.push({ scope: "order", slideId: slide.id, source: "theirs" }); }
    else if (theirValue === baseValue || theirValue === undefined) rank.set(slide.id, ourValue ?? baseValue);
    else {
      rank.set(slide.id, ourValue ?? baseValue);
      conflicts.push({ scope: "order", slideId: slide.id, base: baseValue, ours: ourValue, theirs: theirValue, message: `Both branches moved slide ${slide.id} to different positions.` });
    }
  }
  mergedSlides.sort((a, bSlide) => (rank.get(a.id) ?? 99999) - (rank.get(bSlide.id) ?? 99999) || a.id.localeCompare(bSlide.id));
  mergedSlides.forEach((slide, order) => { slide.order = order; });

  const mergedDeck: DeckDocument = { ...clone(ours), slides: mergedSlides, updatedAt: new Date().toISOString() };
  return { deck: mergedDeck, conflicts, applied, changed: !same(mergedDeck, ours) };
}
