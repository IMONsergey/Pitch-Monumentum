import type { DeckDocument, SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import { createSlideMasterFromSlide, recommendSlideMasters, slideMasterId, slideMasterSourceId, slidePlaceholderId, type AppliedSlideMaster, type MasterRecommendation, type SlideMasterDefinition, type SlideMasterPlaceholder } from "../../slide-masters/src/index.js";
import { applySlideMasterSafely, switchSlideMaster } from "../../slide-masters/src/safe.js";
import { validateSceneHierarchy } from "../../mutations/src/index.js";

export type MasteredDeckDocument = DeckDocument & { slideMasters?: Record<string, SlideMasterDefinition> };

export type SlideMasterCommand =
  | { command: "createMaster"; slideId: string; name: string; masterId?: string; description?: string; autoDetectPlaceholders?: boolean }
  | { command: "applyMaster"; slideId: string; masterId: string; preserveUnmatched?: boolean; instanceId?: string }
  | { command: "updateMasterFromSlide"; slideId: string; masterId: string; name?: string; description?: string }
  | { command: "deleteMaster"; masterId: string }
  | { command: "detachMaster"; slideId: string };

export interface SlideMasterCommandResult {
  deck: DeckDocument;
  changed: boolean;
  reason: string;
  master?: SlideMasterDefinition;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  nextSelectionIds: string[];
}

function masterInstanceTag(id: string): string { return `slide-master-instance:${id}`; }
function tagValue(element: SceneElement, prefix: string): string | undefined { return element.tags?.find((tag) => tag.startsWith(prefix))?.slice(prefix.length); }
function currentInstanceId(slide: SlideDocument): string | undefined { return slide.scene.map((element) => tagValue(element, "slide-master-instance:")).find(Boolean); }
function currentMasterId(slide: SlideDocument): string | undefined { return slide.scene.map(slideMasterId).find(Boolean); }

function tagInstance(result: AppliedSlideMaster): AppliedSlideMaster {
  const scene = result.slide.scene.map((element) => {
    if (slideMasterId(element) !== result.instance.masterId) return element;
    const next: any = structuredClone(element);
    next.tags = [...new Set([...(next.tags ?? []).filter((tag: string) => !tag.startsWith("slide-master-instance:")), masterInstanceTag(result.instance.id)])];
    return next as SceneElement;
  });
  return { ...result, slide: { ...result.slide, scene } };
}

function stripMasterTags(element: SceneElement): SceneElement {
  const next: any = structuredClone(element);
  next.tags = next.tags?.filter((tag: string) => !tag.startsWith("slide-master:") && !tag.startsWith("slide-master-source:") && !tag.startsWith("slide-placeholder:") && !tag.startsWith("slide-master-instance:"));
  if (!next.tags?.length) delete next.tags;
  return next as SceneElement;
}

function masterAuthoringSlide(slide: SlideDocument, masterId: string): SlideDocument {
  const owned = slide.scene.filter((element) => slideMasterId(element) === masterId);
  if (!owned.length) throw new Error(`Slide ${slide.id} is not using master ${masterId}`);
  const idMap = new Map(owned.map((element) => [element.id, slideMasterSourceId(element) ?? element.id]));
  const elements = owned.map((element) => {
    const next: any = stripMasterTags(element);
    next.id = idMap.get(element.id)!;
    if (next.groupId) next.groupId = idMap.get(next.groupId) ?? next.groupId;
    if (next.type === "frame" || next.type === "group") next.childIds = next.childIds.map((id: string) => idMap.get(id) ?? id).filter((id: string) => [...idMap.values()].includes(id));
    return next as SceneElement;
  });
  validateSceneHierarchy(elements);
  return { ...slide, scene: elements };
}

function placeholderKindMap(definition: SlideMasterDefinition): Map<string, SlideMasterPlaceholder> { return new Map(definition.placeholders.map((placeholder) => [placeholder.id, placeholder])); }

function preservePlaceholderIds(before: SlideDocument, previousDefinition: SlideMasterDefinition | undefined, nextDefinition: SlideMasterDefinition, applied: AppliedSlideMaster): AppliedSlideMaster {
  if (!previousDefinition) return applied;
  const oldPlaceholders = placeholderKindMap(previousDefinition);
  const oldCandidates = before.scene.map((element) => {
    const placeholderId = slidePlaceholderId(element); const placeholder = placeholderId ? oldPlaceholders.get(placeholderId) : undefined;
    return placeholder ? { element, placeholder } : undefined;
  }).filter((item): item is { element: SceneElement; placeholder: SlideMasterPlaceholder } => Boolean(item));
  if (!oldCandidates.length) return applied;

  const usedOld = new Set<string>();
  const rename = new Map<string, string>();
  for (const placeholder of nextDefinition.placeholders) {
    const newElementId = applied.instance.placeholderElementMap[placeholder.id];
    if (!newElementId) continue;
    const exact = oldCandidates.find((item) => !usedOld.has(item.element.id) && item.placeholder.kind === placeholder.kind && item.placeholder.name.toLowerCase() === placeholder.name.toLowerCase());
    const fallback = exact ?? oldCandidates.find((item) => !usedOld.has(item.element.id) && item.placeholder.kind === placeholder.kind);
    if (!fallback || fallback.element.id === newElementId) continue;
    if (applied.slide.scene.some((element) => element.id === fallback.element.id && element.id !== newElementId)) continue;
    usedOld.add(fallback.element.id); rename.set(newElementId, fallback.element.id);
  }
  if (!rename.size) return applied;
  const scene = applied.slide.scene.map((element) => {
    const next: any = structuredClone(element);
    next.id = rename.get(element.id) ?? element.id;
    if (next.groupId) next.groupId = rename.get(next.groupId) ?? next.groupId;
    if (next.type === "frame" || next.type === "group") next.childIds = next.childIds.map((id: string) => rename.get(id) ?? id);
    return next as SceneElement;
  });
  validateSceneHierarchy(scene);
  const sourceElementMap = Object.fromEntries(Object.entries(applied.instance.sourceElementMap).map(([sourceId, elementId]) => [sourceId, rename.get(elementId) ?? elementId]));
  const placeholderElementMap = Object.fromEntries(Object.entries(applied.instance.placeholderElementMap).map(([placeholderId, elementId]) => [placeholderId, rename.get(elementId) ?? elementId]));
  return { ...applied, slide: { ...applied.slide, scene }, instance: { ...applied.instance, sourceElementMap, placeholderElementMap }, affectedElementIds: [...new Set([...applied.affectedElementIds.map((id) => rename.get(id) ?? id), ...rename.values()])] };
}

function applyToSlide(slide: SlideDocument, previousDefinition: SlideMasterDefinition | undefined, definition: SlideMasterDefinition, options: { preserveUnmatched?: boolean; instanceId?: string } = {}): AppliedSlideMaster {
  const instanceId = options.instanceId ?? currentInstanceId(slide);
  const base = currentMasterId(slide) ? switchSlideMaster(slide, definition, { preserveUnmatched: options.preserveUnmatched, instanceId }) : applySlideMasterSafely(slide, definition, { preserveUnmatched: options.preserveUnmatched, instanceId });
  return tagInstance(preservePlaceholderIds(slide, previousDefinition, definition, base));
}

function masterMap(deck: DeckDocument): Record<string, SlideMasterDefinition> { return structuredClone((deck as MasteredDeckDocument).slideMasters ?? {}); }
function slide(deck: DeckDocument, id: string): SlideDocument { const found = deck.slides.find((item) => item.id === id); if (!found) throw new Error(`Unknown slide: ${id}`); return found; }

export function recommendMastersForSlide(deck: DeckDocument, slideId: string): MasterRecommendation[] {
  return recommendSlideMasters(slide(deck, slideId), Object.values((deck as MasteredDeckDocument).slideMasters ?? {}));
}

export function executeSlideMasterCommand(deck: DeckDocument, input: SlideMasterCommand): SlideMasterCommandResult {
  const masters = masterMap(deck);
  let next = structuredClone(deck) as MasteredDeckDocument;
  let reason = "Slide master edit";
  const affectedSlideIds: string[] = [];
  const affectedElementIds: string[] = [];
  let nextSelectionIds: string[] = [];
  let master: SlideMasterDefinition | undefined;

  if (input.command === "createMaster") {
    const source = slide(deck, input.slideId);
    master = createSlideMasterFromSlide({ slide: source, widthDU: deck.canvas.widthDU, heightDU: deck.canvas.heightDU, name: input.name, masterId: input.masterId, description: input.description, autoDetectPlaceholders: input.autoDetectPlaceholders });
    if (masters[master.id]) throw new Error(`Slide master already exists: ${master.id}`);
    masters[master.id] = master; next.slideMasters = masters; reason = `Create slide master ${master.name}`;
  } else if (input.command === "applyMaster") {
    master = masters[input.masterId]; if (!master) throw new Error(`Unknown slide master: ${input.masterId}`);
    const source = slide(deck, input.slideId); const previous = currentMasterId(source) ? masters[currentMasterId(source)!] : undefined;
    const applied = applyToSlide(source, previous, master, { preserveUnmatched: input.preserveUnmatched, instanceId: input.instanceId });
    next.slides = next.slides.map((item) => item.id === source.id ? applied.slide : item);
    affectedSlideIds.push(source.id); affectedElementIds.push(...applied.affectedElementIds); nextSelectionIds = Object.values(applied.instance.placeholderElementMap); reason = `Apply slide master ${master.name}`;
  } else if (input.command === "updateMasterFromSlide") {
    const previous = masters[input.masterId]; if (!previous) throw new Error(`Unknown slide master: ${input.masterId}`);
    const authoringSource = masterAuthoringSlide(slide(deck, input.slideId), input.masterId);
    master = createSlideMasterFromSlide({ slide: authoringSource, widthDU: deck.canvas.widthDU, heightDU: deck.canvas.heightDU, name: input.name?.trim() || previous.name, masterId: previous.id, description: input.description === undefined ? previous.description : input.description, autoDetectPlaceholders: true });
    masters[master.id] = master; next.slideMasters = masters;
    next.slides = next.slides.map((item) => {
      if (currentMasterId(item) !== master!.id) return item;
      const applied = applyToSlide(item, previous, master!);
      affectedSlideIds.push(item.id); affectedElementIds.push(...applied.affectedElementIds);
      if (item.id === input.slideId) nextSelectionIds = Object.values(applied.instance.placeholderElementMap);
      return applied.slide;
    });
    reason = `Update slide master ${master.name} and refresh ${affectedSlideIds.length} slide(s)`;
  } else if (input.command === "deleteMaster") {
    master = masters[input.masterId]; if (!master) throw new Error(`Unknown slide master: ${input.masterId}`);
    const usedBy = deck.slides.filter((item) => currentMasterId(item) === input.masterId).map((item) => item.id);
    if (usedBy.length) throw new Error(`Cannot delete slide master ${input.masterId}: used by ${usedBy.join(", ")}`);
    delete masters[input.masterId]; next.slideMasters = masters; reason = `Delete slide master ${master.name}`;
  } else {
    const source = slide(deck, input.slideId); const masterId = currentMasterId(source); if (!masterId) throw new Error(`Slide ${source.id} has no master to detach`);
    const scene = source.scene.map((element) => {
      if (slideMasterId(element) !== masterId) return element;
      const nextElement: any = stripMasterTags(element); return nextElement as SceneElement;
    });
    validateSceneHierarchy(scene);
    next.slides = next.slides.map((item) => item.id === source.id ? { ...item, scene, status: "draft" } : item);
    affectedSlideIds.push(source.id); affectedElementIds.push(...scene.filter((element) => !slideMasterId(element)).map((element) => element.id)); reason = `Detach slide master ${masterId}`;
  }

  const changed = JSON.stringify(deck) !== JSON.stringify(next);
  if (changed) next.updatedAt = new Date().toISOString();
  return { deck: changed ? next : deck, changed, reason, master, affectedSlideIds: [...new Set(affectedSlideIds)], affectedElementIds: [...new Set(affectedElementIds)], nextSelectionIds: [...new Set(nextSelectionIds)] };
}
