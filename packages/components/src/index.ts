import { randomUUID } from "node:crypto";
import type { SceneElement, TextParagraph } from "../../deck-model/src/index.js";
import { validateSceneHierarchy } from "../../mutations/src/index.js";

export type ComponentSlotKind = "text" | "image" | "fill" | "stroke";

export interface ComponentSlot {
  id: string;
  name: string;
  kind: ComponentSlotKind;
  targetElementId: string;
}

export interface ComponentDefinition {
  schemaVersion: "0.1";
  id: string;
  name: string;
  description?: string;
  widthDU: number;
  heightDU: number;
  rootIds: string[];
  elements: SceneElement[];
  slots: ComponentSlot[];
}

export type ComponentOverrideValue =
  | { kind: "text"; paragraphs: TextParagraph[] }
  | { kind: "image"; assetId: string; alt?: string }
  | { kind: "fill"; color: string }
  | { kind: "stroke"; color: string; widthDU?: number; dash?: "solid" | "dash" | "dot" };

export interface ComponentOverride {
  slotId: string;
  value: ComponentOverrideValue;
}

export interface ComponentInstanceTransform {
  x: number;
  y: number;
  scaleX?: number;
  scaleY?: number;
}

export interface ComponentInstanceRecord {
  schemaVersion: "0.1";
  id: string;
  componentId: string;
  elementIdMap: Record<string, string>;
  rootIds: string[];
  transform: ComponentInstanceTransform;
  overrides: ComponentOverride[];
}

export interface InstantiatedComponent {
  instance: ComponentInstanceRecord;
  elements: SceneElement[];
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (value <= 0) throw new Error(`${label} must be greater than zero`);
  return value;
}

function color(value: string, label: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error(`${label} must be #RRGGBB`);
  return value.toUpperCase();
}

function elementIndex(definition: ComponentDefinition): Map<string, SceneElement> {
  return new Map(definition.elements.map((element) => [element.id, element]));
}

export function validateComponentDefinition(definition: ComponentDefinition): void {
  if (!definition.id.trim()) throw new Error("Component id is required");
  if (!definition.name.trim()) throw new Error("Component name is required");
  positive(definition.widthDU, "component widthDU");
  positive(definition.heightDU, "component heightDU");
  if (!definition.elements.length) throw new Error("Component must contain at least one element");
  validateSceneHierarchy(definition.elements);
  const index = elementIndex(definition);
  const roots = [...new Set(definition.rootIds)];
  if (!roots.length) throw new Error("Component must declare at least one root element");
  if (roots.length !== definition.rootIds.length) throw new Error("Component rootIds contain duplicates");
  for (const rootId of roots) if (!index.has(rootId)) throw new Error(`Component root ${rootId} is missing`);
  const slotIds = new Set<string>();
  for (const slot of definition.slots) {
    if (!slot.id.trim()) throw new Error("Component slot id is required");
    if (slotIds.has(slot.id)) throw new Error(`Duplicate component slot id ${slot.id}`);
    slotIds.add(slot.id);
    const target = index.get(slot.targetElementId);
    if (!target) throw new Error(`Slot ${slot.id} targets missing element ${slot.targetElementId}`);
    if (slot.kind === "text" && target.type !== "text") throw new Error(`Text slot ${slot.id} must target a text element`);
    if (slot.kind === "image" && target.type !== "image") throw new Error(`Image slot ${slot.id} must target an image element`);
    if (slot.kind === "fill" && target.type !== "shape" && target.type !== "frame") throw new Error(`Fill slot ${slot.id} must target a shape or frame`);
    if (slot.kind === "stroke" && target.type !== "shape" && target.type !== "line") throw new Error(`Stroke slot ${slot.id} must target a shape or line`);
  }
}

function normalizedTransform(transform: ComponentInstanceTransform): Required<ComponentInstanceTransform> {
  const x = finite(transform.x, "instance x");
  const y = finite(transform.y, "instance y");
  const scaleX = positive(transform.scaleX ?? 1, "instance scaleX");
  const scaleY = positive(transform.scaleY ?? 1, "instance scaleY");
  return { x, y, scaleX, scaleY };
}

function createIdMap(definition: ComponentDefinition, instanceId: string): Record<string, string> {
  return Object.fromEntries(definition.elements.map((element) => [element.id, `${instanceId}_${element.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`]));
}

function cloneElement(element: SceneElement, idMap: Record<string, string>, instanceId: string, transform: Required<ComponentInstanceTransform>): SceneElement {
  const cloned: any = structuredClone(element);
  cloned.id = idMap[element.id];
  cloned.name = element.name ?? element.id;
  cloned.origin = "user";
  cloned.geometry = {
    ...element.geometry,
    x: transform.x + element.geometry.x * transform.scaleX,
    y: transform.y + element.geometry.y * transform.scaleY,
    width: element.geometry.width * transform.scaleX,
    height: element.geometry.height * transform.scaleY,
  };
  if (cloned.type === "frame" || cloned.type === "group") cloned.childIds = cloned.childIds.map((id: string) => idMap[id] ?? id);
  if (cloned.groupId) cloned.groupId = idMap[cloned.groupId] ?? cloned.groupId;
  cloned.tags = [...new Set([...(cloned.tags ?? []), `component:${instanceId}`])];
  return cloned as SceneElement;
}

function slotMap(definition: ComponentDefinition): Map<string, ComponentSlot> {
  return new Map(definition.slots.map((slot) => [slot.id, slot]));
}

function overrideMap(overrides: ComponentOverride[]): Map<string, ComponentOverrideValue> {
  const map = new Map<string, ComponentOverrideValue>();
  for (const override of overrides) {
    if (map.has(override.slotId)) throw new Error(`Duplicate component override for slot ${override.slotId}`);
    map.set(override.slotId, structuredClone(override.value));
  }
  return map;
}

function applyOverride(element: SceneElement, slot: ComponentSlot, value: ComponentOverrideValue): SceneElement {
  const next: any = structuredClone(element);
  if (slot.kind !== value.kind) throw new Error(`Override ${slot.id} expects ${slot.kind}, got ${value.kind}`);
  if (value.kind === "text") {
    if (next.type !== "text") throw new Error(`Text override ${slot.id} target is not text`);
    next.paragraphs = structuredClone(value.paragraphs);
  } else if (value.kind === "image") {
    if (next.type !== "image") throw new Error(`Image override ${slot.id} target is not image`);
    if (!value.assetId.trim()) throw new Error(`Image override ${slot.id} assetId is required`);
    next.assetId = value.assetId;
    if (value.alt !== undefined) next.alt = value.alt;
  } else if (value.kind === "fill") {
    if (next.type !== "shape" && next.type !== "frame") throw new Error(`Fill override ${slot.id} target cannot be filled`);
    next.fill = color(value.color, `Fill override ${slot.id}`);
  } else {
    if (next.type !== "shape" && next.type !== "line") throw new Error(`Stroke override ${slot.id} target has no stroke`);
    const current = next.stroke ?? { color: "#111111", widthDU: 1 };
    next.stroke = {
      ...current,
      color: color(value.color, `Stroke override ${slot.id}`),
      widthDU: value.widthDU === undefined ? current.widthDU : Math.max(0, finite(value.widthDU, `Stroke override ${slot.id} widthDU`)),
      dash: value.dash ?? current.dash,
    };
  }
  return next as SceneElement;
}

function applyOverrides(definition: ComponentDefinition, elements: SceneElement[], idMap: Record<string, string>, overrides: ComponentOverride[]): SceneElement[] {
  const slots = slotMap(definition);
  const values = overrideMap(overrides);
  for (const slotId of values.keys()) if (!slots.has(slotId)) throw new Error(`Unknown component slot override ${slotId}`);
  let result = elements;
  for (const [slotId, value] of values) {
    const slot = slots.get(slotId)!;
    const targetId = idMap[slot.targetElementId];
    result = result.map((element) => element.id === targetId ? applyOverride(element, slot, value) : element);
  }
  return result;
}

export function instantiateComponent(
  definition: ComponentDefinition,
  transform: ComponentInstanceTransform,
  overrides: ComponentOverride[] = [],
  instanceId = `instance_${randomUUID()}`,
): InstantiatedComponent {
  validateComponentDefinition(definition);
  if (!instanceId.trim()) throw new Error("Component instance id is required");
  const normalized = normalizedTransform(transform);
  const idMap = createIdMap(definition, instanceId);
  let elements = definition.elements.map((element) => cloneElement(element, idMap, instanceId, normalized));
  elements = applyOverrides(definition, elements, idMap, overrides);
  validateSceneHierarchy(elements);
  const instance: ComponentInstanceRecord = {
    schemaVersion: "0.1",
    id: instanceId,
    componentId: definition.id,
    elementIdMap: idMap,
    rootIds: definition.rootIds.map((id) => idMap[id]),
    transform: normalized,
    overrides: structuredClone(overrides),
  };
  return { instance, elements };
}

/** Rebuild an existing instance after its component definition changes while preserving stable instance element IDs. */
export function refreshComponentInstance(definition: ComponentDefinition, instance: ComponentInstanceRecord): InstantiatedComponent {
  validateComponentDefinition(definition);
  if (definition.id !== instance.componentId) throw new Error(`Instance ${instance.id} belongs to ${instance.componentId}, not ${definition.id}`);
  const normalized = normalizedTransform(instance.transform);
  const nextMap: Record<string, string> = {};
  for (const element of definition.elements) nextMap[element.id] = instance.elementIdMap[element.id] ?? `${instance.id}_${element.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const validSlots = new Set(definition.slots.map((slot) => slot.id));
  const overrides = instance.overrides.filter((override) => validSlots.has(override.slotId));
  let elements = definition.elements.map((element) => cloneElement(element, nextMap, instance.id, normalized));
  elements = applyOverrides(definition, elements, nextMap, overrides);
  validateSceneHierarchy(elements);
  return {
    instance: {
      ...structuredClone(instance),
      elementIdMap: nextMap,
      rootIds: definition.rootIds.map((id) => nextMap[id]),
      transform: normalized,
      overrides: structuredClone(overrides),
    },
    elements,
  };
}

export function detachComponentInstance(elements: SceneElement[], instanceId: string): SceneElement[] {
  return elements.map((element) => ({
    ...structuredClone(element),
    tags: element.tags?.filter((tag) => tag !== `component:${instanceId}`),
  }));
}
