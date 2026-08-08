import { createHash, randomUUID } from "node:crypto";
import type {
  AutoLayoutSpec,
  DeckDocument,
  Geometry,
  LayoutItemSpec,
  Paint,
  SceneElement,
  SlideDocument,
  SlideSemanticContract,
  StrokeStyle,
  TextElement,
  TextParagraph,
  VisualEffect,
} from "../../deck-model/src/index.js";
import { stableStringify } from "../../shared/src/index.js";

export type MutationOrigin = "user" | "codex" | "deterministic";
export type ElementStylePatch =
  | { kind: "shape"; fill?: string | null; stroke?: StrokeStyle | null; radiusDU?: number | null }
  | { kind: "frame"; fill?: string | null; stroke?: StrokeStyle | null; radiusDU?: number | null; clipContent?: boolean }
  | { kind: "image"; cornerRadiusDU?: number | null; fit?: "cover" | "contain" | "stretch" }
  | { kind: "line"; stroke?: StrokeStyle; startMarker?: "none" | "arrow" | "dot"; endMarker?: "none" | "arrow" | "dot" };

export interface ElementAppearancePatch {
  fillPaint?: Paint;
  clearFillPaint?: boolean;
  effects?: VisualEffect[];
}

export type DeckMutationOperation =
  | {
      op: "replaceText";
      slideId: string;
      elementId: string;
      paragraphs: TextParagraph[];
    }
  | {
      op: "updateGeometry";
      slideId: string;
      elementId: string;
      geometry: Partial<Geometry>;
    }
  | {
      op: "updateElementPresentation";
      slideId: string;
      elementId: string;
      changes: {
        zIndex?: number;
        opacity?: number;
        locked?: boolean;
        name?: string;
      };
    }
  | {
      op: "updateElementStyle";
      slideId: string;
      elementId: string;
      style: ElementStylePatch;
    }
  | {
      op: "updateElementAppearance";
      slideId: string;
      elementId: string;
      appearance: ElementAppearancePatch;
    }
  | {
      op: "updateAutoLayout";
      slideId: string;
      elementId: string;
      layout: AutoLayoutSpec | null;
    }
  | {
      op: "updateLayoutItem";
      slideId: string;
      elementId: string;
      layoutItem: LayoutItemSpec | null;
    }
  | {
      op: "updateContainerChildren";
      slideId: string;
      elementId: string;
      childIds: string[];
    }
  | {
      op: "addElement";
      slideId: string;
      element: SceneElement;
    }
  | {
      op: "removeElement";
      slideId: string;
      elementId: string;
    }
  | {
      op: "updateSlideSemantic";
      slideId: string;
      changes: Partial<SlideSemanticContract>;
    }
  | {
      op: "setSlideTitle";
      slideId: string;
      title: string;
    }
  | {
      op: "moveSlide";
      slideId: string;
      toIndex: number;
    };

export interface DeckMutation {
  id: string;
  createdAt: string;
  origin: MutationOrigin;
  reason: string;
  expectedDeckHash?: string;
  operations: DeckMutationOperation[];
}

export interface MutationImpact {
  affectedSlideIds: string[];
  affectedElementIds: string[];
  staleArtifacts: Array<"storyboard" | "qa:narrative" | "qa:evidence" | "qa:visual" | "qa:readability" | "export">;
  narrativeChanged: boolean;
  evidenceRisk: boolean;
  slideOrderChanged: boolean;
}

export interface AppliedDeckMutation {
  mutationId: string;
  beforeHash: string;
  afterHash: string;
  changed: boolean;
  deck: DeckDocument;
  impact: MutationImpact;
}

function isContainer(element: SceneElement): element is Extract<SceneElement, { type: "frame" | "group" }> {
  return element.type === "frame" || element.type === "group";
}

export function validateSceneHierarchy(scene: SceneElement[]): void {
  const index = new Map<string, SceneElement>();
  for (const element of scene) {
    if (index.has(element.id)) throw new Error(`Duplicate scene element id: ${element.id}`);
    index.set(element.id, element);
  }

  const parentByChild = new Map<string, string>();
  for (const element of scene) {
    if (!isContainer(element)) continue;
    const local = new Set<string>();
    for (const childId of element.childIds) {
      if (local.has(childId)) throw new Error(`Container ${element.id} contains duplicate child ${childId}`);
      local.add(childId);
      if (!index.has(childId)) throw new Error(`Container ${element.id} references missing child ${childId}`);
      const existingParent = parentByChild.get(childId);
      if (existingParent && existingParent !== element.id) {
        throw new Error(`Element ${childId} has multiple parents: ${existingParent}, ${element.id}`);
      }
      parentByChild.set(childId, element.id);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Scene hierarchy cycle detected at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const element = index.get(id);
    if (element && isContainer(element)) for (const childId of element.childIds) visit(childId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const element of scene) visit(element.id);
}

export function deckHash(deck: DeckDocument): string {
  return createHash("sha256").update(stableStringify(deck)).digest("hex");
}

export function createMutation(
  reason: string,
  operations: DeckMutationOperation[],
  origin: MutationOrigin = "user",
  expectedDeckHash?: string,
): DeckMutation {
  return {
    id: `mutation_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    origin,
    reason,
    expectedDeckHash,
    operations,
  };
}

function findSlide(deck: DeckDocument, slideId: string): SlideDocument {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  return slide;
}

function findElement(slide: SlideDocument, elementId: string): SceneElement {
  const element = slide.scene.find((item) => item.id === elementId);
  if (!element) throw new Error(`Unknown element ${elementId} on slide ${slide.id}`);
  return element;
}

function ensureUniqueElementId(deck: DeckDocument, element: SceneElement): void {
  for (const slide of deck.slides) {
    if (slide.scene.some((item) => item.id === element.id)) {
      throw new Error(`Scene element id already exists: ${element.id}`);
    }
  }
}

function replaceSlide(deck: DeckDocument, slideId: string, next: SlideDocument): DeckDocument {
  return {
    ...deck,
    slides: deck.slides.map((slide) => (slide.id === slideId ? next : slide)),
    updatedAt: new Date().toISOString(),
  };
}

function mutateElement(
  deck: DeckDocument,
  slideId: string,
  elementId: string,
  mapper: (element: SceneElement) => SceneElement,
): DeckDocument {
  const slide = findSlide(deck, slideId);
  const existing = findElement(slide, elementId);
  const replacement = mapper(existing);
  if (replacement.id !== existing.id || replacement.type !== existing.type) {
    throw new Error("Element mutation cannot change stable id or element type");
  }
  const nextSlide: SlideDocument = {
    ...slide,
    scene: slide.scene.map((element) => (element.id === elementId ? replacement : element)),
    status: "draft",
  };
  return replaceSlide(deck, slideId, nextSlide);
}

function valueOrUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}

function validHexColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}

function validateOpacity(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
}

export function validatePaint(paint: Paint): void {
  if (paint.kind === "none") return;
  if (paint.kind === "solid") {
    if (!validHexColor(paint.color)) throw new Error(`Invalid solid paint color: ${paint.color}`);
    if (paint.opacity !== undefined) validateOpacity(paint.opacity, "paint opacity");
    return;
  }
  if (!Number.isFinite(paint.angleDeg)) throw new Error("Gradient angle must be finite");
  if (paint.stops.length < 2) throw new Error("Linear gradient needs at least two stops");
  let previous = -Infinity;
  for (const stop of paint.stops) {
    if (!Number.isFinite(stop.position) || stop.position < 0 || stop.position > 1) throw new Error("Gradient stop position must be between 0 and 1");
    if (stop.position < previous) throw new Error("Gradient stops must be sorted by position");
    previous = stop.position;
    if (!validHexColor(stop.color)) throw new Error(`Invalid gradient stop color: ${stop.color}`);
    if (stop.opacity !== undefined) validateOpacity(stop.opacity, "gradient stop opacity");
  }
}

export function validateEffects(effects: VisualEffect[]): void {
  for (const effect of effects) {
    if (effect.kind !== "dropShadow") throw new Error(`Unsupported visual effect: ${(effect as { kind?: string }).kind}`);
    if (!validHexColor(effect.color)) throw new Error(`Invalid shadow color: ${effect.color}`);
    validateOpacity(effect.opacity, "shadow opacity");
    for (const [label, value] of [["shadow blur", effect.blurDU], ["shadow x", effect.offsetXDU], ["shadow y", effect.offsetYDU]] as const) {
      if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
    }
    if (effect.blurDU < 0) throw new Error("shadow blur must be non-negative");
  }
}

function applyElementStyle(element: SceneElement, style: ElementStylePatch): SceneElement {
  if (style.kind === "shape") {
    if (element.type !== "shape") throw new Error(`Element ${element.id} is not a shape`);
    return {
      ...element,
      ...(style.fill !== undefined ? { fill: valueOrUndefined(style.fill) } : {}),
      ...(style.stroke !== undefined ? { stroke: valueOrUndefined(style.stroke) } : {}),
      ...(style.radiusDU !== undefined ? { radiusDU: valueOrUndefined(style.radiusDU) } : {}),
    };
  }
  if (style.kind === "frame") {
    if (element.type !== "frame") throw new Error(`Element ${element.id} is not a frame`);
    return {
      ...element,
      ...(style.fill !== undefined ? { fill: valueOrUndefined(style.fill) } : {}),
      ...(style.stroke !== undefined ? { stroke: valueOrUndefined(style.stroke) } : {}),
      ...(style.radiusDU !== undefined ? { radiusDU: valueOrUndefined(style.radiusDU) } : {}),
      ...(style.clipContent !== undefined ? { clipContent: style.clipContent } : {}),
    };
  }
  if (style.kind === "image") {
    if (element.type !== "image") throw new Error(`Element ${element.id} is not an image`);
    return {
      ...element,
      ...(style.cornerRadiusDU !== undefined ? { cornerRadiusDU: valueOrUndefined(style.cornerRadiusDU) } : {}),
      ...(style.fit !== undefined ? { fit: style.fit } : {}),
    };
  }
  if (element.type !== "line") throw new Error(`Element ${element.id} is not a line`);
  return {
    ...element,
    ...(style.stroke !== undefined ? { stroke: style.stroke } : {}),
    ...(style.startMarker !== undefined ? { startMarker: style.startMarker } : {}),
    ...(style.endMarker !== undefined ? { endMarker: style.endMarker } : {}),
  };
}

function applyElementAppearance(element: SceneElement, appearance: ElementAppearancePatch): SceneElement {
  if (appearance.fillPaint !== undefined) {
    if (element.type !== "shape" && element.type !== "frame") throw new Error(`Element ${element.id} cannot have fillPaint`);
    validatePaint(appearance.fillPaint);
  }
  if (appearance.effects !== undefined) validateEffects(appearance.effects);

  if (element.type === "shape" || element.type === "frame") {
    return {
      ...element,
      ...(appearance.clearFillPaint ? { fillPaint: undefined } : {}),
      ...(appearance.fillPaint !== undefined ? { fillPaint: structuredClone(appearance.fillPaint) } : {}),
      ...(appearance.effects !== undefined ? { effects: structuredClone(appearance.effects) } : {}),
    };
  }
  if (appearance.fillPaint !== undefined || appearance.clearFillPaint) throw new Error(`Element ${element.id} cannot have fillPaint`);
  return {
    ...element,
    ...(appearance.effects !== undefined ? { effects: structuredClone(appearance.effects) } : {}),
  };
}

function applyOperation(deck: DeckDocument, operation: DeckMutationOperation): DeckDocument {
  switch (operation.op) {
    case "replaceText":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => {
        if (element.type !== "text") throw new Error(`Element ${operation.elementId} is not text`);
        return { ...element, paragraphs: operation.paragraphs } as TextElement;
      });
    case "updateGeometry":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => ({
        ...element,
        geometry: { ...element.geometry, ...operation.geometry },
      }));
    case "updateElementPresentation":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => ({ ...element, ...operation.changes }));
    case "updateElementStyle":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => applyElementStyle(element, operation.style));
    case "updateElementAppearance":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => applyElementAppearance(element, operation.appearance));
    case "updateAutoLayout":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => {
        if (!isContainer(element)) throw new Error(`Element ${operation.elementId} cannot own auto layout`);
        return { ...element, layout: operation.layout ?? undefined };
      });
    case "updateLayoutItem":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => ({ ...element, layoutItem: operation.layoutItem ?? undefined }));
    case "updateContainerChildren":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => {
        if (!isContainer(element)) throw new Error(`Element ${operation.elementId} is not a frame/group container`);
        return { ...element, childIds: [...operation.childIds] };
      });
    case "addElement": {
      ensureUniqueElementId(deck, operation.element);
      const slide = findSlide(deck, operation.slideId);
      return replaceSlide(deck, operation.slideId, { ...slide, scene: [...slide.scene, operation.element], status: "draft" });
    }
    case "removeElement": {
      const slide = findSlide(deck, operation.slideId);
      findElement(slide, operation.elementId);
      const scene = slide.scene
        .filter((element) => element.id !== operation.elementId)
        .map((element) => isContainer(element) && element.childIds.includes(operation.elementId)
          ? { ...element, childIds: element.childIds.filter((childId) => childId !== operation.elementId) }
          : element);
      return replaceSlide(deck, operation.slideId, { ...slide, scene, status: "draft" });
    }
    case "updateSlideSemantic": {
      const slide = findSlide(deck, operation.slideId);
      return replaceSlide(deck, operation.slideId, { ...slide, semantic: { ...slide.semantic, ...operation.changes }, status: "draft" });
    }
    case "setSlideTitle": {
      const slide = findSlide(deck, operation.slideId);
      return replaceSlide(deck, operation.slideId, { ...slide, title: operation.title, status: "draft" });
    }
    case "moveSlide": {
      if (!Number.isInteger(operation.toIndex) || operation.toIndex < 0 || operation.toIndex >= deck.slides.length) {
        throw new Error(`Invalid slide destination index: ${operation.toIndex}`);
      }
      const from = deck.slides.findIndex((slide) => slide.id === operation.slideId);
      if (from < 0) throw new Error(`Unknown slide: ${operation.slideId}`);
      const next = [...deck.slides];
      const [moved] = next.splice(from, 1);
      next.splice(operation.toIndex, 0, moved);
      return {
        ...deck,
        slides: next.map((slide, index) => (slide.order === index ? slide : { ...slide, order: index })),
        updatedAt: new Date().toISOString(),
      };
    }
  }
}

function impactForOperation(deck: DeckDocument, operation: DeckMutationOperation): MutationImpact {
  const slide = findSlide(deck, operation.slideId);
  const element = "elementId" in operation ? findElement(slide, operation.elementId) : undefined;
  const stale = new Set<MutationImpact["staleArtifacts"][number]>(["qa:visual", "export"]);
  let narrativeChanged = false;
  let evidenceRisk = false;
  let slideOrderChanged = false;

  if (operation.op === "replaceText" || operation.op === "setSlideTitle") {
    stale.add("qa:readability");
    stale.add("qa:narrative");
    narrativeChanged = true;
    if (element?.dependencies.some((dependency) => dependency.kind === "claim" || dependency.kind === "evidence")) {
      stale.add("qa:evidence");
      evidenceRisk = true;
    }
  }
  if (
    operation.op === "updateGeometry"
    || operation.op === "updateElementAppearance"
    || operation.op === "updateAutoLayout"
    || operation.op === "updateLayoutItem"
    || operation.op === "updateContainerChildren"
    || operation.op === "addElement"
    || operation.op === "removeElement"
  ) {
    stale.add("qa:readability");
  }
  if (operation.op === "updateSlideSemantic") {
    stale.add("storyboard");
    stale.add("qa:narrative");
    stale.add("qa:evidence");
    narrativeChanged = true;
    evidenceRisk = true;
  }
  if (operation.op === "moveSlide") {
    stale.add("storyboard");
    stale.add("qa:narrative");
    narrativeChanged = true;
    slideOrderChanged = true;
  }

  return {
    affectedSlideIds: [operation.slideId],
    affectedElementIds: "elementId" in operation ? [operation.elementId] : operation.op === "addElement" ? [operation.element.id] : [],
    staleArtifacts: [...stale],
    narrativeChanged,
    evidenceRisk,
    slideOrderChanged,
  };
}

function mergeImpact(impacts: MutationImpact[]): MutationImpact {
  return {
    affectedSlideIds: [...new Set(impacts.flatMap((impact) => impact.affectedSlideIds))],
    affectedElementIds: [...new Set(impacts.flatMap((impact) => impact.affectedElementIds))],
    staleArtifacts: [...new Set(impacts.flatMap((impact) => impact.staleArtifacts))],
    narrativeChanged: impacts.some((impact) => impact.narrativeChanged),
    evidenceRisk: impacts.some((impact) => impact.evidenceRisk),
    slideOrderChanged: impacts.some((impact) => impact.slideOrderChanged),
  };
}

export function applyDeckMutation(deck: DeckDocument, mutation: DeckMutation): AppliedDeckMutation {
  const beforeHash = deckHash(deck);
  if (mutation.expectedDeckHash && mutation.expectedDeckHash !== beforeHash) {
    throw new Error(`Deck changed since mutation was authored: expected ${mutation.expectedDeckHash}, got ${beforeHash}`);
  }

  const impacts: MutationImpact[] = [];
  let next = deck;
  for (const operation of mutation.operations) {
    impacts.push(impactForOperation(next, operation));
    next = applyOperation(next, operation);
  }

  for (const slide of next.slides) validateSceneHierarchy(slide.scene);

  const afterHash = deckHash(next);
  return {
    mutationId: mutation.id,
    beforeHash,
    afterHash,
    changed: beforeHash !== afterHash,
    deck: next,
    impact: mergeImpact(impacts),
  };
}
