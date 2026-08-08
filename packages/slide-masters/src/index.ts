import { randomUUID } from "node:crypto";
import type { SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import { validateSceneHierarchy } from "../../mutations/src/index.js";

export type SlidePlaceholderKind = "title" | "subtitle" | "body" | "image" | "chart" | "table" | "metric" | "footer" | "other";

export interface SlideMasterPlaceholder {
  id: string;
  name: string;
  kind: SlidePlaceholderKind;
  targetElementId: string;
  required?: boolean;
}

export interface SlideMasterDefinition {
  schemaVersion: "0.1";
  id: string;
  name: string;
  description?: string;
  widthDU: number;
  heightDU: number;
  elements: SceneElement[];
  placeholders: SlideMasterPlaceholder[];
}

export interface SlideMasterInstanceRecord {
  schemaVersion: "0.1";
  id: string;
  masterId: string;
  sourceElementMap: Record<string, string>;
  placeholderElementMap: Record<string, string>;
  appliedAt: string;
}

export interface ApplySlideMasterOptions {
  instanceId?: string;
  preserveUnmatched?: boolean;
}

export interface AppliedSlideMaster {
  slide: SlideDocument;
  instance: SlideMasterInstanceRecord;
  preservedElementIds: string[];
  removedMasterElementIds: string[];
  affectedElementIds: string[];
}

export interface MasterRecommendation {
  masterId: string;
  masterName: string;
  score: number;
  matchedPlaceholders: number;
  requiredMissing: number;
  unmatchedContent: number;
  reasons: string[];
}

function finitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and greater than zero`);
}
function id(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}
function masterTag(masterId: string): string { return `slide-master:${masterId}`; }
function masterSourceTag(sourceId: string): string { return `slide-master-source:${sourceId}`; }
function placeholderTag(placeholderId: string): string { return `slide-placeholder:${placeholderId}`; }
function tagValue(element: SceneElement, prefix: string): string | undefined { return element.tags?.find((tag) => tag.startsWith(prefix))?.slice(prefix.length); }
export function slideMasterId(element: SceneElement): string | undefined { return tagValue(element, "slide-master:"); }
export function slidePlaceholderId(element: SceneElement): string | undefined { return tagValue(element, "slide-placeholder:"); }
export function slideMasterSourceId(element: SceneElement): string | undefined { return tagValue(element, "slide-master-source:"); }

function compatible(element: SceneElement, kind: SlidePlaceholderKind): boolean {
  if (kind === "image") return element.type === "image";
  if (kind === "chart") return element.type === "chart";
  if (kind === "table") return element.type === "table";
  if (kind === "other") return true;
  return element.type === "text";
}

function semanticScore(element: SceneElement, kind: SlidePlaceholderKind): number {
  if (!compatible(element, kind)) return -100;
  if (kind === "title" && element.semanticRole === "title") return 12;
  if (kind === "subtitle" && element.semanticRole === "subtitle") return 12;
  if (kind === "body" && element.semanticRole === "body") return 12;
  if (kind === "metric" && element.semanticRole === "metric") return 12;
  if (kind === "footer" && element.semanticRole === "footer") return 12;
  if (kind === "image" && element.type === "image") return element.semanticRole === "visual" ? 11 : 9;
  if (kind === "chart" && element.type === "chart") return 11;
  if (kind === "table" && element.type === "table") return 11;
  if (kind === "other") return 2;
  return element.type === "text" ? 4 : -100;
}

function autoKind(element: SceneElement): SlidePlaceholderKind | undefined {
  if (element.semanticRole === "title" && element.type === "text") return "title";
  if (element.semanticRole === "subtitle" && element.type === "text") return "subtitle";
  if (element.semanticRole === "body" && element.type === "text") return "body";
  if (element.semanticRole === "metric" && element.type === "text") return "metric";
  if (element.semanticRole === "footer" && element.type === "text") return "footer";
  if (element.type === "image") return "image";
  if (element.type === "chart") return "chart";
  if (element.type === "table") return "table";
  return undefined;
}

function stripInstanceTags(element: SceneElement): SceneElement {
  const next: any = structuredClone(element);
  next.tags = next.tags?.filter((tag: string) => !tag.startsWith("slide-master:") && !tag.startsWith("slide-master-source:") && !tag.startsWith("slide-placeholder:"));
  if (!next.tags?.length) next.tags = undefined;
  return next as SceneElement;
}

export function validateSlideMaster(definition: SlideMasterDefinition): void {
  if (definition.schemaVersion !== "0.1") throw new Error(`Unsupported slide master schema: ${definition.schemaVersion}`);
  id(definition.id, "Slide master id"); id(definition.name, "Slide master name");
  finitePositive(definition.widthDU, "Slide master widthDU"); finitePositive(definition.heightDU, "Slide master heightDU");
  if (!definition.elements.length) throw new Error("Slide master must contain at least one element");
  validateSceneHierarchy(definition.elements);
  const index = new Map(definition.elements.map((element) => [element.id, element]));
  const placeholderIds = new Set<string>(); const targets = new Set<string>();
  for (const placeholder of definition.placeholders) {
    id(placeholder.id, "Placeholder id"); id(placeholder.name, "Placeholder name");
    if (placeholderIds.has(placeholder.id)) throw new Error(`Duplicate placeholder id ${placeholder.id}`); placeholderIds.add(placeholder.id);
    if (targets.has(placeholder.targetElementId)) throw new Error(`Multiple placeholders target ${placeholder.targetElementId}`); targets.add(placeholder.targetElementId);
    const target = index.get(placeholder.targetElementId);
    if (!target) throw new Error(`Placeholder ${placeholder.id} targets missing element ${placeholder.targetElementId}`);
    if (!compatible(target, placeholder.kind)) throw new Error(`Placeholder ${placeholder.id} kind ${placeholder.kind} is incompatible with ${target.type}`);
  }
}

export function createSlideMasterFromSlide(input: {
  slide: SlideDocument;
  widthDU: number;
  heightDU: number;
  name: string;
  masterId?: string;
  description?: string;
  placeholders?: Array<{ elementId: string; kind: SlidePlaceholderKind; name?: string; required?: boolean }>;
  autoDetectPlaceholders?: boolean;
}): SlideMasterDefinition {
  const elements = input.slide.scene.map(stripInstanceTags);
  const explicit = input.placeholders ?? [];
  const placeholderByElement = new Map(explicit.map((item) => [item.elementId, item]));
  if (input.autoDetectPlaceholders !== false) for (const element of elements) if (!placeholderByElement.has(element.id)) {
    const kind = autoKind(element); if (kind) placeholderByElement.set(element.id, { elementId: element.id, kind, name: element.name || kind, required: kind === "title" });
  }
  const placeholders: SlideMasterPlaceholder[] = [...placeholderByElement.values()].map((item) => {
    if (!elements.some((element) => element.id === item.elementId)) throw new Error(`Cannot create placeholder for missing element ${item.elementId}`);
    return { id: `placeholder_${item.elementId}`, name: item.name?.trim() || item.kind, kind: item.kind, targetElementId: item.elementId, required: item.required };
  });
  const definition: SlideMasterDefinition = { schemaVersion: "0.1", id: input.masterId?.trim() || `slide_master_${randomUUID()}`, name: input.name.trim(), description: input.description?.trim() || undefined, widthDU: input.widthDU, heightDU: input.heightDU, elements, placeholders };
  validateSlideMaster(definition); return definition;
}

function copyContent(prototype: SceneElement, current: SceneElement): SceneElement {
  const next: any = structuredClone(prototype);
  if (prototype.type === "text" && current.type === "text") {
    next.paragraphs = structuredClone(current.paragraphs);
    next.fitPolicy = current.fitPolicy ?? prototype.fitPolicy;
  } else if (prototype.type === "image" && current.type === "image") {
    next.assetId = current.assetId; next.alt = current.alt;
    next.crop = current.crop ? structuredClone(current.crop) : undefined;
    next.focalPoint = (current as any).focalPoint ? structuredClone((current as any).focalPoint) : undefined;
  } else if (prototype.type === "chart" && current.type === "chart") next.chart = structuredClone(current.chart);
  else if (prototype.type === "table" && current.type === "table") { next.rows = structuredClone(current.rows); next.columnWidths = current.columnWidths ? [...current.columnWidths] : prototype.columnWidths; }
  else if (prototype.type === "video" && current.type === "video") { next.assetId = current.assetId; next.posterAssetId = current.posterAssetId; }
  return next as SceneElement;
}

function chooseContent(placeholder: SlideMasterPlaceholder, existing: SceneElement[], used: Set<string>): SceneElement | undefined {
  const direct = existing.find((element) => !used.has(element.id) && slidePlaceholderId(element) === placeholder.id && compatible(element, placeholder.kind));
  if (direct) return direct;
  let best: { element: SceneElement; score: number } | undefined;
  for (const element of existing) {
    if (used.has(element.id) || slideMasterId(element)) continue;
    const score = semanticScore(element, placeholder.kind);
    if (score < 0) continue;
    if (!best || score > best.score || (score === best.score && element.zIndex > best.element.zIndex)) best = { element, score };
  }
  return best?.element;
}

function remapHierarchy(element: SceneElement, idMap: Record<string, string>): SceneElement {
  const next: any = structuredClone(element);
  if (next.groupId) next.groupId = idMap[next.groupId] ?? next.groupId;
  if (next.type === "frame" || next.type === "group") next.childIds = next.childIds.map((id: string) => idMap[id] ?? id);
  return next as SceneElement;
}

export function applySlideMaster(slide: SlideDocument, definition: SlideMasterDefinition, options: ApplySlideMasterOptions = {}): AppliedSlideMaster {
  validateSlideMaster(definition);
  const instanceId = options.instanceId?.trim() || `master_instance_${randomUUID()}`;
  const oldMasterElements = slide.scene.filter((element) => Boolean(slideMasterId(element)));
  const oldMasterIds = new Set(oldMasterElements.map((element) => element.id));
  const existing = slide.scene;
  const usedContent = new Set<string>();
  const placeholderByTarget = new Map(definition.placeholders.map((placeholder) => [placeholder.targetElementId, placeholder]));
  const idMap: Record<string, string> = Object.fromEntries(definition.elements.map((element) => [element.id, `${instanceId}_${element.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`]));
  const placeholderElementMap: Record<string, string> = {};

  let instantiated = definition.elements.map((prototype) => {
    const placeholder = placeholderByTarget.get(prototype.id);
    const current = placeholder ? chooseContent(placeholder, existing, usedContent) : undefined;
    if (current) usedContent.add(current.id);
    let next = current ? copyContent(prototype, current) : structuredClone(prototype);
    next = remapHierarchy(next, idMap);
    (next as any).id = idMap[prototype.id];
    const tags = (next.tags ?? []).filter((tag) => !tag.startsWith("slide-master:") && !tag.startsWith("slide-master-source:") && !tag.startsWith("slide-placeholder:"));
    (next as any).tags = [...new Set([...tags, masterTag(definition.id), masterSourceTag(prototype.id), ...(placeholder ? [placeholderTag(placeholder.id)] : [])])];
    if (placeholder) placeholderElementMap[placeholder.id] = next.id;
    return next;
  });
  validateSceneHierarchy(instantiated);

  const preserveUnmatched = options.preserveUnmatched !== false;
  const preserved = preserveUnmatched ? existing.filter((element) => !oldMasterIds.has(element.id) && !usedContent.has(element.id)) : [];
  const scene = [...instantiated, ...preserved];
  const nextSlide: SlideDocument = { ...slide, scene, status: "draft" };
  const instance: SlideMasterInstanceRecord = { schemaVersion: "0.1", id: instanceId, masterId: definition.id, sourceElementMap: idMap, placeholderElementMap, appliedAt: new Date().toISOString() };
  return { slide: nextSlide, instance, preservedElementIds: preserved.map((element) => element.id), removedMasterElementIds: [...oldMasterIds], affectedElementIds: [...new Set([...oldMasterIds, ...usedContent, ...instantiated.map((element) => element.id)])] };
}

function slideContentElements(slide: SlideDocument): SceneElement[] { return slide.scene.filter((element) => !slideMasterId(element) && element.semanticRole !== "decoration"); }

export function recommendSlideMasters(slide: SlideDocument, definitions: SlideMasterDefinition[]): MasterRecommendation[] {
  const content = slideContentElements(slide);
  return definitions.map((definition) => {
    validateSlideMaster(definition);
    const used = new Set<string>(); let matchedPlaceholders = 0; let requiredMissing = 0; const reasons: string[] = [];
    for (const placeholder of definition.placeholders) {
      const match = chooseContent(placeholder, content, used);
      if (match) { used.add(match.id); matchedPlaceholders += 1; reasons.push(`${placeholder.kind} ← ${match.id}`); }
      else if (placeholder.required) { requiredMissing += 1; reasons.push(`missing required ${placeholder.kind}`); }
    }
    const unmatchedContent = content.filter((element) => !used.has(element.id)).length;
    const denominator = Math.max(1, definition.placeholders.length + content.length);
    const raw = (matchedPlaceholders * 2 - requiredMissing * 3 - unmatchedContent * .75 + 1) / denominator;
    const score = Math.max(0, Math.min(1, raw));
    return { masterId: definition.id, masterName: definition.name, score, matchedPlaceholders, requiredMissing, unmatchedContent, reasons };
  }).sort((a, b) => b.score - a.score || a.masterName.localeCompare(b.masterName));
}
