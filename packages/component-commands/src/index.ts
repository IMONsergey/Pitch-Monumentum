import { randomUUID } from "node:crypto";
import type { DeckDocument, SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import {
  instantiateComponent,
  refreshComponentInstance,
  validateComponentDefinition,
  type ComponentDefinition,
  type ComponentInstanceRecord,
  type ComponentOverride,
  type ComponentOverrideValue,
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

export interface ComponentInstanceSummary {
  id: string;
  componentId: string;
  slideId: string;
  elementIds: string[];
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
    if ((element.type === "shape" || element.type === "frame") && element.fill) slots.push({ id: `fill_${element.id}`, name: `${element.name || "Object"} fill`, kind: "fill", targetElementId: element.id });
    if ((element.type === "shape" || element.type === "line") && element.stroke) slots.push({ id: `stroke_${element.id}`, name: `${element.name || "Object"} stroke`, kind: "stroke", targetElementId: element.id });
  }
  return slots;
}

export function createComponentDefinitionFromSelection(input: CreateComponentInput): ComponentDefinition {
  if (!input.name.trim()) throw new Error("Component name is required");
  const closure = selectedClosure(input.slide, input.selectedIds);
  const box = bounds(closure.elements);
  const included = new Set(closure.elements.map((element) => element.id));
  const elements = closure.elements.map((element) => localizeElement(element, included, box.left, box.top));
  const definition: ComponentDefinition = {
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
  validateComponentDefinition(definition);
  return definition;
}

function componentTag(instanceId: string): string { return `component:${instanceId}`; }
function definitionTag(componentId: string): string { return `component-def:${componentId}`; }
function sourceTag(sourceId: string): string { return `component-source:${sourceId}`; }
function tagValue(element: SceneElement, prefix: string): string | undefined {
  return element.tags?.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
}
function expectedInstanceElementId(instanceId: string, sourceId: string): string {
  return `${instanceId}_${sourceId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function tagInstantiatedElements(elements: SceneElement[], definition: ComponentDefinition, instance: ComponentInstanceRecord): SceneElement[] {
  const sourceById = new Map(Object.entries(instance.elementIdMap).map(([sourceId, elementId]) => [elementId, sourceId]));
  return elements.map((element) => {
    const sourceId = sourceById.get(element.id);
    const tags = (element.tags ?? []).filter((tag) => !tag.startsWith("component-def:") && !tag.startsWith("component-source:"));
    return {
      ...element,
      tags: [...new Set([...tags, definitionTag(definition.id), ...(sourceId ? [sourceTag(sourceId)] : [])])],
    } as SceneElement;
  });
}

function applyZBaseline(elements: SceneElement[], definition: ComponentDefinition, instance: ComponentInstanceRecord, baseline: number): SceneElement[] {
  const definitionById = new Map(definition.elements.map((element) => [element.id, element]));
  const sourceById = new Map(Object.entries(instance.elementIdMap).map(([sourceId, elementId]) => [elementId, sourceId]));
  const minDefinitionZ = Math.min(...definition.elements.map((element) => element.zIndex));
  return elements.map((element) => {
    const source = definitionById.get(sourceById.get(element.id) ?? "");
    return { ...element, zIndex: baseline + Math.max(0, (source?.zIndex ?? minDefinitionZ) - minDefinitionZ) } as SceneElement;
  });
}

export function instantiateComponentIntoDeck(input: InstantiateComponentInput) {
  const slide = input.deck.slides.find((item) => item.id === input.slideId);
  if (!slide) throw new Error(`Unknown slide: ${input.slideId}`);
  const built = instantiateComponent(input.definition, input.transform, input.overrides ?? [], input.instanceId);
  const existingIds = new Set(input.deck.slides.flatMap((item) => item.scene.map((element) => element.id)));
  for (const element of built.elements) if (existingIds.has(element.id)) throw new Error(`Component element id already exists: ${element.id}`);
  const baseline = Math.max(0, ...slide.scene.map((element) => element.zIndex)) + 1;
  const taggedElements = applyZBaseline(tagInstantiatedElements(built.elements, input.definition, built.instance), input.definition, built.instance, baseline);
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

export function componentInstanceId(element: SceneElement): string | undefined {
  return tagValue(element, "component:");
}
export function componentDefinitionId(element: SceneElement): string | undefined {
  return tagValue(element, "component-def:");
}
export function componentSourceElementId(element: SceneElement): string | undefined {
  return tagValue(element, "component-source:");
}

export function componentInstanceSummaries(deck: DeckDocument): ComponentInstanceSummary[] {
  const groups = new Map<string, ComponentInstanceSummary>();
  for (const slide of deck.slides) for (const element of slide.scene) {
    const id = componentInstanceId(element);
    const componentId = componentDefinitionId(element);
    if (!id || !componentId) continue;
    const key = `${slide.id}:${id}`;
    const current = groups.get(key) ?? { id, componentId, slideId: slide.id, elementIds: [] };
    current.elementIds.push(element.id);
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => a.slideId.localeCompare(b.slideId) || a.id.localeCompare(b.id));
}

function mapInstanceElements(definition: ComponentDefinition, elements: SceneElement[], instanceId: string): Record<string, string> {
  const currentIds = new Set(elements.map((element) => element.id));
  const result: Record<string, string> = {};
  for (const source of definition.elements) {
    const tagged = elements.find((element) => componentSourceElementId(element) === source.id);
    if (tagged) result[source.id] = tagged.id;
    else {
      const expected = expectedInstanceElementId(instanceId, source.id);
      if (currentIds.has(expected)) result[source.id] = expected;
    }
  }
  return result;
}

function deriveTransform(definition: ComponentDefinition, elements: SceneElement[], instanceId: string, idMap: Record<string, string>): Required<ComponentInstanceTransform> {
  const currentById = new Map(elements.map((element) => [element.id, element]));
  const definitionById = new Map(definition.elements.map((element) => [element.id, element]));
  const candidateIds = [...definition.rootIds, ...definition.elements.map((element) => element.id)];
  for (const sourceId of candidateIds) {
    const source = definitionById.get(sourceId);
    const current = currentById.get(idMap[sourceId] ?? expectedInstanceElementId(instanceId, sourceId));
    if (!source || !current || source.geometry.width <= 0 || source.geometry.height <= 0) continue;
    const scaleX = current.geometry.width / source.geometry.width;
    const scaleY = current.geometry.height / source.geometry.height;
    if (!(scaleX > 0) || !(scaleY > 0) || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)) continue;
    return {
      x: current.geometry.x - source.geometry.x * scaleX,
      y: current.geometry.y - source.geometry.y * scaleY,
      scaleX,
      scaleY,
    };
  }
  throw new Error(`Cannot derive transform for component instance ${instanceId}`);
}

function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function inferredOverride(slot: ComponentSlot, current: SceneElement, base: SceneElement): ComponentOverrideValue | undefined {
  if (slot.kind === "text" && current.type === "text" && base.type === "text" && !equal(current.paragraphs, base.paragraphs)) return { kind: "text", paragraphs: structuredClone(current.paragraphs) };
  if (slot.kind === "image" && current.type === "image" && base.type === "image" && (current.assetId !== base.assetId || current.alt !== base.alt)) return { kind: "image", assetId: current.assetId, alt: current.alt };
  if (slot.kind === "fill" && (current.type === "shape" || current.type === "frame") && (base.type === "shape" || base.type === "frame") && current.fill && current.fill !== base.fill) return { kind: "fill", color: current.fill };
  if (slot.kind === "stroke" && (current.type === "shape" || current.type === "line") && (base.type === "shape" || base.type === "line") && current.stroke && !equal(current.stroke, base.stroke)) return { kind: "stroke", color: current.stroke.color, widthDU: current.stroke.widthDU, dash: current.stroke.dash };
  return undefined;
}

function recordFromCurrentInstance(definition: ComponentDefinition, elements: SceneElement[], instanceId: string): ComponentInstanceRecord {
  const idMap = mapInstanceElements(definition, elements, instanceId);
  const transform = deriveTransform(definition, elements, instanceId, idMap);
  const seed: ComponentInstanceRecord = {
    schemaVersion: "0.1",
    id: instanceId,
    componentId: definition.id,
    elementIdMap: idMap,
    rootIds: definition.rootIds.map((sourceId) => idMap[sourceId] ?? expectedInstanceElementId(instanceId, sourceId)),
    transform,
    overrides: [],
  };
  const base = refreshComponentInstance(definition, seed);
  const currentById = new Map(elements.map((element) => [element.id, element]));
  const baseById = new Map(base.elements.map((element) => [element.id, element]));
  const overrides: ComponentOverride[] = [];
  for (const slot of definition.slots) {
    const elementId = base.instance.elementIdMap[slot.targetElementId];
    const current = currentById.get(elementId);
    const baseline = baseById.get(elementId);
    if (!current || !baseline) continue;
    const value = inferredOverride(slot, current, baseline);
    if (value) overrides.push({ slotId: slot.id, value });
  }
  return { ...base.instance, overrides };
}

function refreshOneInstance(previousDefinition: ComponentDefinition, nextDefinition: ComponentDefinition, currentElements: SceneElement[], instanceId: string, resetOverrides = false): SceneElement[] {
  const record = recordFromCurrentInstance(previousDefinition, currentElements, instanceId);
  const nextRecord: ComponentInstanceRecord = { ...record, componentId: nextDefinition.id, overrides: resetOverrides ? [] : record.overrides };
  const built = refreshComponentInstance(nextDefinition, nextRecord);
  const baseline = Math.min(...currentElements.map((element) => element.zIndex));
  return applyZBaseline(tagInstantiatedElements(built.elements, nextDefinition, built.instance), nextDefinition, built.instance, baseline);
}

export function refreshComponentInstancesInDeck(deck: DeckDocument, previousDefinition: ComponentDefinition, nextDefinition: ComponentDefinition) {
  if (previousDefinition.id !== nextDefinition.id) throw new Error("Component propagation requires the same component id");
  validateComponentDefinition(previousDefinition);
  validateComponentDefinition(nextDefinition);
  let changed = false;
  const affectedSlideIds: string[] = [];
  const affectedElementIds: string[] = [];
  const slides = deck.slides.map((slide) => {
    const instanceIds = [...new Set(slide.scene.filter((element) => componentDefinitionId(element) === previousDefinition.id).map(componentInstanceId).filter((id): id is string => Boolean(id)))];
    if (!instanceIds.length) return slide;
    let scene = slide.scene;
    for (const instanceId of instanceIds) {
      const current = scene.filter((element) => componentInstanceId(element) === instanceId && componentDefinitionId(element) === previousDefinition.id);
      if (!current.length) continue;
      const refreshed = refreshOneInstance(previousDefinition, nextDefinition, current, instanceId);
      const oldIds = new Set(current.map((element) => element.id));
      scene = [...scene.filter((element) => !oldIds.has(element.id)), ...refreshed];
      affectedElementIds.push(...oldIds, ...refreshed.map((element) => element.id));
      changed = true;
    }
    if (!changed) return slide;
    affectedSlideIds.push(slide.id);
    return { ...slide, status: "draft" as const, scene };
  });
  return {
    deck: changed ? { ...deck, updatedAt: new Date().toISOString(), slides } : deck,
    changed,
    reason: `Refresh instances of ${nextDefinition.name}`,
    affectedSlideIds: [...new Set(affectedSlideIds)],
    affectedElementIds: [...new Set(affectedElementIds)],
  };
}

export function resetComponentInstanceInDeck(deck: DeckDocument, definition: ComponentDefinition, instanceId: string) {
  if (!instanceId.trim()) throw new Error("Component instance id is required");
  validateComponentDefinition(definition);
  const slide = deck.slides.find((item) => item.scene.some((element) => componentInstanceId(element) === instanceId && componentDefinitionId(element) === definition.id));
  if (!slide) throw new Error(`No component instance ${instanceId} for ${definition.id}`);
  const current = slide.scene.filter((element) => componentInstanceId(element) === instanceId && componentDefinitionId(element) === definition.id);
  const refreshed = refreshOneInstance(definition, definition, current, instanceId, true);
  const oldIds = new Set(current.map((element) => element.id));
  const nextDeck: DeckDocument = {
    ...deck,
    updatedAt: new Date().toISOString(),
    slides: deck.slides.map((item) => item.id === slide.id ? { ...item, status: "draft", scene: [...item.scene.filter((element) => !oldIds.has(element.id)), ...refreshed] } : item),
  };
  return {
    deck: nextDeck,
    changed: true,
    reason: `Reset component instance ${instanceId}`,
    affectedSlideIds: [slide.id],
    affectedElementIds: [...new Set([...oldIds, ...refreshed.map((element) => element.id)])],
    nextSelectionIds: refreshed.filter((element) => nextDefinitionRoot(definition, componentSourceElementId(element))).map((element) => element.id),
  };
}

function nextDefinitionRoot(definition: ComponentDefinition, sourceId: string | undefined): boolean {
  return Boolean(sourceId && definition.rootIds.includes(sourceId));
}

export function detachComponentFromDeck(deck: DeckDocument, slideId: string, instanceId: string) {
  if (!instanceId.trim()) throw new Error("Component instance id is required");
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const tag = componentTag(instanceId);
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
        tags: element.tags?.filter((value) => value !== tag && !value.startsWith("component-def:") && !value.startsWith("component-source:")),
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
