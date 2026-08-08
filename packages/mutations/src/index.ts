import { createHash, randomUUID } from "node:crypto";
import type {
  AutoLayoutSpec,
  DeckDocument,
  Geometry,
  LayoutItemSpec,
  SceneElement,
  SlideDocument,
  SlideSemanticContract,
  TextElement,
  TextParagraph,
} from "../../deck-model/src/index.js";
import { stableStringify } from "../../shared/src/index.js";

export type MutationOrigin = "user" | "codex" | "deterministic";

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
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => ({
        ...element,
        ...operation.changes,
      }));
    case "updateAutoLayout":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => {
        if (element.type !== "frame" && element.type !== "group") {
          throw new Error(`Element ${operation.elementId} cannot own auto layout`);
        }
        return { ...element, layout: operation.layout ?? undefined };
      });
    case "updateLayoutItem":
      return mutateElement(deck, operation.slideId, operation.elementId, (element) => ({
        ...element,
        layoutItem: operation.layoutItem ?? undefined,
      }));
    case "addElement": {
      ensureUniqueElementId(deck, operation.element);
      const slide = findSlide(deck, operation.slideId);
      return replaceSlide(deck, operation.slideId, {
        ...slide,
        scene: [...slide.scene, operation.element],
        status: "draft",
      });
    }
    case "removeElement": {
      const slide = findSlide(deck, operation.slideId);
      findElement(slide, operation.elementId);
      return replaceSlide(deck, operation.slideId, {
        ...slide,
        scene: slide.scene.filter((element) => element.id !== operation.elementId),
        status: "draft",
      });
    }
    case "updateSlideSemantic": {
      const slide = findSlide(deck, operation.slideId);
      return replaceSlide(deck, operation.slideId, {
        ...slide,
        semantic: { ...slide.semantic, ...operation.changes },
        status: "draft",
      });
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
    || operation.op === "updateAutoLayout"
    || operation.op === "updateLayoutItem"
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
  const impacts = mutation.operations.map((operation) => impactForOperation(deck, operation));
  let next = deck;
  for (const operation of mutation.operations) next = applyOperation(next, operation);
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
