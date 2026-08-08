import { randomUUID } from "node:crypto";
import type { DeckDocument, SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import {
  instantiateComponent,
  type ComponentDefinition,
  type ComponentOverride,
  type ComponentInstanceTransform,
  type ComponentSlot,
} from "../../components/src/index.js";

export interface CreateComponentInput {
  slide: SlideDocument;
  selectedIds: string[];
  name: string;
  componentId?: string;
  description?: string;
}

export interface InstantiateComponentInput {
  deck: DeckDocument;
  slideId: string;
  definition: ComponentDefinition;
  transform: ComponentInstanceTransform;
  overrides?: ComponentOverride[];
  instanceId?: string;
}

function selectedClosure(slide: SlideDocument, selectedIds: string[]): { elements: SceneElement[]; rootIds: string[] } {
  const index = new Map(slide.scene.map((element) => [element.id, element]));
  const requested = [...new Set(selectedIds)];
  if (!requested.length) throw new Error("Select at least one object to create a component");
  for (const id of requested) if (!index.has(id)) throw new Error(`Unknown element ${id} on slide ${slide.id}`);

  const included = new Set<string>();
  const visit = (id: string): void => {
    if (included.has(id)) return;
    const element = index.get(id);
    if (!element) return;
    included.add(id);
    if (element.type === "frame" || element.type === "group") for (const childId of element.childIds) visit(childId);
  };
  requested.forEach(visit);

  const parentByChild = new Map<string, string>();
  for (const element of slide.scene) {
    if (element.type !== "frame" && element.type !== "group") continue;
    for (const childId of element.childIds) parentByChild.set(childId, element.id);
  }
  const rootIds = [...included].filter((id) => !included.has(parentByChild.get(id) ?? ""));
  const elements = slide.scene.filter((element) => included.has(element.id));
  return { elements, rootIds };
}

function bounds(elements: SceneElement[]) {
  const left = Math.min(...elements.map((element) => element.geometry.x));
  const top = Math.min(...elements.map((element) => element.geometry.y));
  const right = Math.max(...elements.map((element) => element.geometry.x + element.geometry.width));
  const bottom = Math.max(...elements.map((element) => element.geometry.y + element.geometry.height));
  return { left, top, width: right - left, height: bottom - top };
}

function localizeElement(element: SceneElement, includedIds: Set<string>, left: number, top: number): SceneElement {
  const next: any = structuredClone(element);
  next.geometry = { ...next.geometry, x: next.geometry.x - left, y: next.geometry.y - top };
  if (next.groupId && !includedIds.has(next.groupId)) next.groupId = undefined;
  if (next.type === "frame" || next.type === "group") next.childIds = next.childIds.filter((id: string) => includedIds.has(id));
  return next as SceneElement;
}

function autoSlots(elements: SceneElement[]): ComponentSlot[] {
  const slots: ComponentSlot[] = [];
  for (const element of elements) {
    if (element.type === "text") slots.push({ id: `text_${element.id}`, name: element.name || "Text", kind: "text", targetElementId: element.id });
    if (element.type === "image") slots.push({ id: `image_${element.id}`, name: element.name || "Image", kind: "image", targetElementId: element.id });
  }
  return slots;
}

export function createComponentDefinitionFromSelection(input: CreateComponentInput): ComponentDefinition {
  if (!input.name.trim()) throw new Error("Component name is required");
  const closure = selectedClosure(input.slide, input.selectedIds);
  const box = bounds(closure.elements);
  const included = new Set(closure.elements.map((element) => element.id));
  const elements = closure.elements.map((element) => localizeElement(element, included, box.left, box.top));
  return {
    schemaVersion: "0.1",
    id: input.componentId?.trim() || `component_${randomUUID()}`,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    widthDU: Math.max(1, box.width),
    heightDU: Math.max(1, box.height),
    rootIds: closure.rootIds,
    elements,
    slots: autoSlots(elements),
  };
}

export function instantiateComponentIntoDeck(input: InstantiateComponentInput) {
  const slide = input.deck.slides.find((item) => item.id === input.slideId);
  if (!slide) throw new Error(`Unknown slide: ${input.slideId}`);
  const built = instantiateComponent(input.definition, input.transform, input.overrides ?? [], input.instanceId);
  const existingIds = new Set(input.deck.slides.flatMap((item) => item.scene.map((element) => element.id)));
  for (const element of built.elements) if (existingIds.has(element.id)) throw new Error(`Component element id already exists: ${element.id}`);
  const taggedElements = built.elements.map((element) => ({
    ...element,
    tags: [...new Set([...(element.tags ?? []), `component-def:${input.definition.id}`])],
  })) as SceneElement[];
  const deck: DeckDocument = {
    ...input.deck,
    updatedAt: new Date().toISOString(),
    slides: input.deck.slides.map((item) => item.id === slide.id ? {
      ...item,
      status: "draft",
      scene: [...item.scene, ...taggedElements],
    } : item),
  };
  return {
    deck,
    changed: true,
    reason: `Insert component ${input.definition.name}`,
    instance: built.instance,
    affectedSlideIds: [slide.id],
    affectedElementIds: taggedElements.map((element) => element.id),
    nextSelectionIds: built.instance.rootIds,
  };
}

export function detachComponentFromDeck(deck: DeckDocument, slideId: string, instanceId: string) {
  if (!instanceId.trim()) throw new Error("Component instance id is required");
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const tag = `component:${instanceId}`;
  const affectedIds = slide.scene.filter((element) => element.tags?.includes(tag)).map((element) => element.id);
  if (!affectedIds.length) throw new Error(`No component instance ${instanceId} on slide ${slide.id}`);
  const affected = new Set(affectedIds);
  const nextDeck: DeckDocument = {
    ...deck,
    updatedAt: new Date().toISOString(),
    slides: deck.slides.map((item) => item.id === slide.id ? {
      ...item,
      status: "draft",
      scene: item.scene.map((element) => affected.has(element.id) ? {
        ...element,
        tags: element.tags?.filter((value) => value !== tag && !value.startsWith("component-def:")),
      } as SceneElement : element),
    } : item),
  };
  return {
    deck: nextDeck,
    changed: true,
    reason: `Detach component ${instanceId}`,
    affectedSlideIds: [slide.id],
    affectedElementIds: affectedIds,
    nextSelectionIds: affectedIds,
  };
}

export function componentInstanceId(element: SceneElement): string | undefined {
  return element.tags?.find((tag) => tag.startsWith("component:"))?.slice("component:".length);
}
