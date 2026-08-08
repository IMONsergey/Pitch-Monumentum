import type { DeckDocument } from "../../deck-model/src/index.js";
import { restyleMasterPlaceholders } from "../../slide-masters/src/content-style.js";
import { slideMasterId } from "../../slide-masters/src/index.js";
import { executeSlideMasterCommand, type MasteredDeckDocument, type SlideMasterCommand, type SlideMasterCommandResult } from "./index.js";

function currentMasterId(slide: DeckDocument["slides"][number]): string | undefined { return slide.scene.map(slideMasterId).find(Boolean); }

export function executeProductionSlideMasterCommand(deck: DeckDocument, input: SlideMasterCommand): SlideMasterCommandResult {
  const result = executeSlideMasterCommand(deck, input);
  if (!result.changed || !result.affectedSlideIds.length) return result;
  const mastered = result.deck as MasteredDeckDocument;
  const affected = new Set(result.affectedSlideIds);
  const slides = mastered.slides.map((slide) => {
    if (!affected.has(slide.id)) return slide;
    const masterId = currentMasterId(slide);
    const definition = masterId ? mastered.slideMasters?.[masterId] : undefined;
    if (!definition) return slide;
    return { ...slide, scene: restyleMasterPlaceholders(slide.scene, definition) };
  });
  return { ...result, deck: { ...mastered, slides } };
}
