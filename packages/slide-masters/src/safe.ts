import type { SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import { validateSceneHierarchy } from "../../mutations/src/index.js";
import { applySlideMaster, slideMasterId, slidePlaceholderId, type AppliedSlideMaster, type ApplySlideMasterOptions, type SlideMasterDefinition } from "./index.js";

function sanitizeHierarchy(elements: SceneElement[]): SceneElement[] {
  const ids = new Set(elements.map((element) => element.id));
  const result = elements.map((element) => {
    const next: any = structuredClone(element);
    if (next.groupId && !ids.has(next.groupId)) delete next.groupId;
    if (next.type === "frame" || next.type === "group") next.childIds = next.childIds.filter((id: string) => ids.has(id));
    return next as SceneElement;
  });
  validateSceneHierarchy(result);
  return result;
}

function stripMasterIdentity(element: SceneElement): SceneElement {
  const next: any = structuredClone(element);
  next.tags = next.tags?.filter((tag: string) => !tag.startsWith("slide-master:") && !tag.startsWith("slide-master-source:") && !tag.startsWith("slide-placeholder:"));
  if (!next.tags?.length) delete next.tags;
  return next as SceneElement;
}

/** Final hierarchy-safe application for a slide that does not already carry another master. */
export function applySlideMasterSafely(slide: SlideDocument, definition: SlideMasterDefinition, options: ApplySlideMasterOptions = {}): AppliedSlideMaster {
  const result = applySlideMaster(slide, definition, options);
  const scene = sanitizeHierarchy(result.slide.scene);
  return { ...result, slide: { ...result.slide, scene } };
}

/**
 * Switch/reapply layout while preserving content from old master placeholders.
 * Old master decoration is removed, but placeholder content is promoted into a
 * temporary ordinary-content pool so semantic matching can map it into the new master.
 */
export function switchSlideMaster(slide: SlideDocument, definition: SlideMasterDefinition, options: ApplySlideMasterOptions = {}): AppliedSlideMaster {
  const hasMaster = slide.scene.some((element) => Boolean(slideMasterId(element)));
  if (!hasMaster) return applySlideMasterSafely(slide, definition, options);

  const promoted: SceneElement[] = [];
  const freeform: SceneElement[] = [];
  for (const element of slide.scene) {
    if (!slideMasterId(element)) freeform.push(structuredClone(element));
    else if (slidePlaceholderId(element)) promoted.push(stripMasterIdentity(element));
  }
  const temporary: SlideDocument = { ...slide, scene: sanitizeHierarchy([...promoted, ...freeform]) };
  const result = applySlideMaster(temporary, definition, options);
  const scene = sanitizeHierarchy(result.slide.scene);
  return { ...result, slide: { ...result.slide, scene }, removedMasterElementIds: slide.scene.filter((element) => Boolean(slideMasterId(element))).map((element) => element.id) };
}
