import type { SceneElement, TextParagraph, TextRun } from "../../deck-model/src/index.js";
import { slideMasterSourceId, slidePlaceholderId, type SlideMasterDefinition } from "./index.js";

function styledRun(content: TextRun, prototype: TextRun | undefined): TextRun {
  if (!prototype) return structuredClone(content);
  return {
    ...structuredClone(content),
    fontFamily: prototype.fontFamily,
    fontSizePt: prototype.fontSizePt,
    color: prototype.color,
    letterSpacingPt: prototype.letterSpacingPt,
    bold: content.bold ?? prototype.bold,
    italic: content.italic ?? prototype.italic,
    underline: content.underline ?? prototype.underline,
  };
}

function styledParagraph(content: TextParagraph, prototype: TextParagraph | undefined, fallbackRun: TextRun | undefined): TextParagraph {
  if (!prototype) return { ...structuredClone(content), runs: content.runs.map((run) => styledRun(run, fallbackRun)) };
  return {
    ...structuredClone(content),
    align: prototype.align ?? content.align,
    lineSpacing: prototype.lineSpacing ?? content.lineSpacing,
    spaceBeforePt: prototype.spaceBeforePt ?? content.spaceBeforePt,
    spaceAfterPt: prototype.spaceAfterPt ?? content.spaceAfterPt,
    bullet: content.bullet ? structuredClone(content.bullet) : prototype.bullet ? structuredClone(prototype.bullet) : undefined,
    runs: content.runs.map((run, index) => styledRun(run, prototype.runs[index] ?? prototype.runs[0] ?? fallbackRun)),
  };
}

export function applyMasterTextStyling(element: SceneElement, prototype: SceneElement): SceneElement {
  if (element.type !== "text" || prototype.type !== "text") return element;
  const fallbackRun = prototype.paragraphs.flatMap((paragraph) => paragraph.runs)[0];
  const next: any = structuredClone(element);
  next.paragraphs = element.paragraphs.map((paragraph, index) => styledParagraph(paragraph, prototype.paragraphs[index] ?? prototype.paragraphs[0], fallbackRun));
  next.verticalAlign = prototype.verticalAlign;
  next.insetsDU = prototype.insetsDU ? [...prototype.insetsDU] : undefined;
  next.fitPolicy = prototype.fitPolicy;
  return next as SceneElement;
}

/** Re-applies master-owned text styling after placeholder content has been preserved. */
export function restyleMasterPlaceholders(elements: SceneElement[], definition: SlideMasterDefinition): SceneElement[] {
  const prototypeBySource = new Map(definition.elements.map((element) => [element.id, element]));
  const placeholderIds = new Set(definition.placeholders.map((placeholder) => placeholder.id));
  return elements.map((element) => {
    const placeholderId = slidePlaceholderId(element);
    if (!placeholderId || !placeholderIds.has(placeholderId)) return element;
    const sourceId = slideMasterSourceId(element);
    const prototype = sourceId ? prototypeBySource.get(sourceId) : undefined;
    return prototype ? applyMasterTextStyling(element, prototype) : element;
  });
}
