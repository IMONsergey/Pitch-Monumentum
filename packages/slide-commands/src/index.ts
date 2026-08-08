import { randomUUID } from "node:crypto";
import type { DeckDocument, SceneElement, SlideDocument } from "../../deck-model/src/index.js";

export type SlideCommandInput =
  | { command: "newSlide"; afterSlideId?: string; title?: string }
  | { command: "duplicateSlide"; slideId: string }
  | { command: "deleteSlide"; slideId: string }
  | { command: "moveSlide"; slideId: string; toIndex: number }
  | { command: "renameSlide"; slideId: string; title: string };

export interface SlideCommandResult {
  deck: DeckDocument;
  nextSlideId: string;
  affectedSlideIds: string[];
  reason: string;
}

const SLIDE_COMMANDS = new Set<SlideCommandInput["command"]>(["newSlide", "duplicateSlide", "deleteSlide", "moveSlide", "renameSlide"]);

export function isSlideCommand(input: unknown): input is SlideCommandInput {
  const command = (input as any)?.command;
  return typeof command === "string" && SLIDE_COMMANDS.has(command as SlideCommandInput["command"]);
}

function slideById(deck: DeckDocument, slideId: string): SlideDocument {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  return slide;
}

function reindex(slides: SlideDocument[]): SlideDocument[] {
  return slides.map((slide, order) => slide.order === order ? slide : { ...slide, order });
}

function withSlides(deck: DeckDocument, slides: SlideDocument[]): DeckDocument {
  return { ...deck, slides: reindex(slides), updatedAt: new Date().toISOString() };
}

function insertionIndex(deck: DeckDocument, afterSlideId?: string): number {
  if (!afterSlideId) return deck.slides.length;
  const index = deck.slides.findIndex((slide) => slide.id === afterSlideId);
  if (index < 0) throw new Error(`Unknown slide: ${afterSlideId}`);
  return index + 1;
}

function blankSlide(deck: DeckDocument, title: string): SlideDocument {
  return {
    id: `slide_${randomUUID()}`,
    order: deck.slides.length,
    title,
    archetype: "freeform",
    semantic: {
      purpose: "Define this slide's role",
      takeaway: "",
      questionAnswered: "",
      narrativeRole: "working",
      claimIds: [],
      evidenceRefs: [],
      audienceRelevance: "",
      density: "balanced",
    },
    scene: [],
    status: "draft",
    qaIssueIds: [],
    dependencyIds: [],
  };
}

function remapElement(element: SceneElement, idMap: Map<string, string>): SceneElement {
  const clone: any = structuredClone(element);
  clone.id = idMap.get(element.id)!;
  if (clone.name) clone.name = `${clone.name} copy`;
  if (clone.type === "frame" || clone.type === "group") {
    clone.childIds = clone.childIds.map((id: string) => idMap.get(id) ?? id);
  }
  if (clone.groupId) clone.groupId = idMap.get(clone.groupId) ?? clone.groupId;
  clone.origin = "user";
  return clone as SceneElement;
}

export function duplicateSlideDocument(source: SlideDocument): SlideDocument {
  const idMap = new Map(source.scene.map((element) => [element.id, `${element.id}_copy_${randomUUID().slice(0, 8)}`]));
  return {
    ...structuredClone(source),
    id: `slide_${randomUUID()}`,
    title: `${source.title} Copy`,
    scene: source.scene.map((element) => remapElement(element, idMap)),
    status: "draft",
    qaIssueIds: [],
  };
}

export function executeSlideCommand(deck: DeckDocument, input: SlideCommandInput): SlideCommandResult {
  if (input.command === "newSlide") {
    const slide = blankSlide(deck, input.title?.trim() || "Untitled slide");
    const at = insertionIndex(deck, input.afterSlideId);
    const slides = [...deck.slides];
    slides.splice(at, 0, slide);
    return { deck: withSlides(deck, slides), nextSlideId: slide.id, affectedSlideIds: [slide.id], reason: "Create slide" };
  }

  if (input.command === "duplicateSlide") {
    const source = slideById(deck, input.slideId);
    const duplicate = duplicateSlideDocument(source);
    const sourceIndex = deck.slides.findIndex((slide) => slide.id === source.id);
    const slides = [...deck.slides];
    slides.splice(sourceIndex + 1, 0, duplicate);
    return { deck: withSlides(deck, slides), nextSlideId: duplicate.id, affectedSlideIds: [source.id, duplicate.id], reason: `Duplicate slide ${source.id}` };
  }

  if (input.command === "deleteSlide") {
    if (deck.slides.length <= 1) throw new Error("A presentation must keep at least one slide");
    const sourceIndex = deck.slides.findIndex((slide) => slide.id === input.slideId);
    if (sourceIndex < 0) throw new Error(`Unknown slide: ${input.slideId}`);
    const slides = deck.slides.filter((slide) => slide.id !== input.slideId);
    const fallback = slides[Math.min(sourceIndex, slides.length - 1)];
    return { deck: withSlides(deck, slides), nextSlideId: fallback.id, affectedSlideIds: [input.slideId, fallback.id], reason: `Delete slide ${input.slideId}` };
  }

  if (input.command === "moveSlide") {
    if (!Number.isInteger(input.toIndex) || input.toIndex < 0 || input.toIndex >= deck.slides.length) throw new Error(`Invalid slide destination index: ${input.toIndex}`);
    const from = deck.slides.findIndex((slide) => slide.id === input.slideId);
    if (from < 0) throw new Error(`Unknown slide: ${input.slideId}`);
    const slides = [...deck.slides];
    const [moved] = slides.splice(from, 1);
    slides.splice(input.toIndex, 0, moved);
    return { deck: withSlides(deck, slides), nextSlideId: moved.id, affectedSlideIds: [moved.id], reason: `Move slide ${moved.id} to ${input.toIndex}` };
  }

  const slide = slideById(deck, input.slideId);
  const title = input.title.trim();
  if (!title) throw new Error("Slide title cannot be empty");
  return {
    deck: withSlides(deck, deck.slides.map((item) => item.id === slide.id ? { ...item, title, status: "draft" } : item)),
    nextSlideId: slide.id,
    affectedSlideIds: [slide.id],
    reason: `Rename slide ${slide.id}`,
  };
}
