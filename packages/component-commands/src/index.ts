import { randomUUID } from "node:crypto";
import type { SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import type { DeckMutationOperation } from "../../mutations/src/index.js";
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
  slide: SlideDocument;
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

export function instantiateComponentOperations(input: InstantiateComponentInput) {
  const built = instantiateComponent(input.definition, input.transform, input.overrides ?? [], input.instanceId);
  const existingIds = new Set(input.slide.scene.map((element) => element.id));
  for (const element of built.elements) if (existingIds.has(element.id)) throw new Error(`Component element id already exists: ${element.id}`);
  const operations: DeckMutationOperation[] = built.elements.map((element) => ({ op: "addElement", slideId: input.slide.id, element }));
  return { operations, instance: built.instance, nextSelectionIds: built.instance.rootIds };
}

export function detachComponentOperations(slide: SlideDocument, instanceId: string): { operations: DeckMutationOperation[]; affectedIds: string[] } {
  if (!instanceId.trim()) throw new Error("Component instance id is required");
  const tag = `component:${instanceId}`;
  const affected = slide.scene.filter((element) => element.tags?.includes(tag));
  if (!affected.length) throw new Error(`No component instance ${instanceId} on slide ${slide.id}`);
  const operations: DeckMutationOperation[] = affected.map((element) => ({
    op: "updateElementPresentation",
    slideId: slide.id,
    elementId: element.id,
    changes: { tags: (element.tags ?? []).filter((value) => value !== tag && !value.startsWith("component-def:")) },
  }));
  return { operations, affectedIds: affected.map((element) => element.id) };
}
