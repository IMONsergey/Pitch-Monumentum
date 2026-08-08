import type { DeckDocument, SceneElement } from "../../deck-model/src/index.js";
import { slideMasterId, slideMasterSourceId, slidePlaceholderId, validateSlideMaster, type SlideMasterDefinition } from "../../slide-masters/src/index.js";
import type { MasteredDeckDocument } from "../../slide-master-commands/src/index.js";

export type SlideMasterQACode =
  | "invalid-master-definition"
  | "unknown-master"
  | "missing-source-tag"
  | "unknown-source"
  | "unknown-placeholder"
  | "placeholder-source-mismatch"
  | "mixed-master-instance"
  | "duplicate-source-in-instance"
  | "missing-required-placeholder"
  | "master-geometry-drift"
  | "master-style-drift";

export interface SlideMasterQAIssue {
  code: SlideMasterQACode;
  severity: "minor" | "major" | "critical";
  slideId?: string;
  masterId?: string;
  instanceId?: string;
  elementId?: string;
  sourceElementId?: string;
  placeholderId?: string;
  message: string;
}

export interface SlideMasterQAReport {
  masterCount: number;
  linkedSlideCount: number;
  instanceCount: number;
  issues: SlideMasterQAIssue[];
  ready: boolean;
}

function instanceId(element: SceneElement): string | undefined {
  return element.tags?.find((tag) => tag.startsWith("slide-master-instance:"))?.slice("slide-master-instance:".length);
}

function normalizedMasterStyle(element: SceneElement): unknown {
  if (element.type === "text") return {
    semanticRole: element.semanticRole,
    fitPolicy: element.fitPolicy,
    verticalAlign: element.verticalAlign,
    insetsDU: element.insetsDU,
    paragraphs: element.paragraphs.map((paragraph) => ({
      align: paragraph.align,
      lineSpacing: paragraph.lineSpacing,
      spaceBeforePt: paragraph.spaceBeforePt,
      spaceAfterPt: paragraph.spaceAfterPt,
      runs: paragraph.runs.map((run) => ({ fontFamily: run.fontFamily, fontSizePt: run.fontSizePt, color: run.color, letterSpacingPt: run.letterSpacingPt, bold: run.bold, italic: run.italic, underline: run.underline })),
    })),
  };
  if (element.type === "shape") return { semanticRole: element.semanticRole, shape: element.shape, fill: element.fill, fillPaint: element.fillPaint, stroke: element.stroke, radiusDU: element.radiusDU, effects: element.effects, opacity: element.opacity };
  if (element.type === "frame") return { semanticRole: element.semanticRole, fill: element.fill, fillPaint: element.fillPaint, stroke: element.stroke, radiusDU: element.radiusDU, clipContent: element.clipContent, layout: element.layout, effects: element.effects, opacity: element.opacity };
  if (element.type === "image") return { semanticRole: element.semanticRole, fit: element.fit, clipShape: (element as any).clipShape, cornerRadiusDU: element.cornerRadiusDU, effects: element.effects, opacity: element.opacity };
  if (element.type === "line") return { semanticRole: element.semanticRole, stroke: element.stroke, startMarker: element.startMarker, endMarker: element.endMarker, effects: element.effects, opacity: element.opacity };
  return { semanticRole: element.semanticRole, opacity: element.opacity, effects: element.effects };
}

function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function masterMap(deck: DeckDocument): Record<string, SlideMasterDefinition> { return (deck as MasteredDeckDocument).slideMasters ?? {}; }

export function runSlideMasterQA(deck: DeckDocument): SlideMasterQAReport {
  const masters = masterMap(deck);
  const issues: SlideMasterQAIssue[] = [];
  for (const [masterId, master] of Object.entries(masters)) {
    try { validateSlideMaster(master); }
    catch (error) { issues.push({ code: "invalid-master-definition", severity: "critical", masterId, message: error instanceof Error ? error.message : String(error) }); }
  }

  const linkedSlides = new Set<string>();
  const instanceKeys = new Set<string>();
  for (const slide of deck.slides) {
    const linked = slide.scene.filter((element) => Boolean(slideMasterId(element)));
    if (!linked.length) continue;
    linkedSlides.add(slide.id);
    const byInstance = new Map<string, SceneElement[]>();
    for (const element of linked) {
      const masterId = slideMasterId(element)!;
      const master = masters[masterId];
      if (!master) {
        issues.push({ code: "unknown-master", severity: "critical", slideId: slide.id, masterId, elementId: element.id, message: `Element ${element.id} references missing slide master ${masterId}` });
        continue;
      }
      const sourceId = slideMasterSourceId(element);
      if (!sourceId) issues.push({ code: "missing-source-tag", severity: "major", slideId: slide.id, masterId, elementId: element.id, message: `Master-owned element ${element.id} has no source identity` });
      else if (!master.elements.some((source) => source.id === sourceId)) issues.push({ code: "unknown-source", severity: "critical", slideId: slide.id, masterId, elementId: element.id, sourceElementId: sourceId, message: `Master-owned element ${element.id} references missing source ${sourceId}` });

      const placeholderId = slidePlaceholderId(element);
      if (placeholderId) {
        const placeholder = master.placeholders.find((item) => item.id === placeholderId);
        if (!placeholder) issues.push({ code: "unknown-placeholder", severity: "critical", slideId: slide.id, masterId, elementId: element.id, placeholderId, message: `Element ${element.id} references missing placeholder ${placeholderId}` });
        else if (sourceId && placeholder.targetElementId !== sourceId) issues.push({ code: "placeholder-source-mismatch", severity: "critical", slideId: slide.id, masterId, elementId: element.id, sourceElementId: sourceId, placeholderId, message: `Placeholder ${placeholderId} expects source ${placeholder.targetElementId}, got ${sourceId}` });
      }
      const instance = instanceId(element);
      if (instance) {
        const key = `${slide.id}:${instance}`; instanceKeys.add(key);
        const bucket = byInstance.get(instance) ?? []; bucket.push(element); byInstance.set(instance, bucket);
      }
    }

    for (const [instance, elements] of byInstance) {
      const masterIds = [...new Set(elements.map(slideMasterId).filter((value): value is string => Boolean(value)))];
      if (masterIds.length > 1) issues.push({ code: "mixed-master-instance", severity: "critical", slideId: slide.id, instanceId: instance, message: `Master instance ${instance} mixes definitions ${masterIds.join(", ")}` });
      const sourceIds = elements.map(slideMasterSourceId).filter((value): value is string => Boolean(value));
      const duplicateSources = [...new Set(sourceIds.filter((value, index) => sourceIds.indexOf(value) !== index))];
      for (const sourceId of duplicateSources) issues.push({ code: "duplicate-source-in-instance", severity: "critical", slideId: slide.id, instanceId: instance, masterId: masterIds[0], sourceElementId: sourceId, message: `Master instance ${instance} contains duplicate source ${sourceId}` });
      const master = masters[masterIds[0] ?? ""];
      if (!master) continue;
      for (const placeholder of master.placeholders.filter((item) => item.required)) {
        if (!elements.some((element) => slidePlaceholderId(element) === placeholder.id)) issues.push({ code: "missing-required-placeholder", severity: "major", slideId: slide.id, instanceId: instance, masterId: master.id, placeholderId: placeholder.id, message: `Required placeholder ${placeholder.name} is missing from instance ${instance}` });
      }
      const sourceById = new Map(master.elements.map((element) => [element.id, element]));
      for (const element of elements) {
        const sourceId = slideMasterSourceId(element); if (!sourceId) continue;
        const source = sourceById.get(sourceId); if (!source) continue;
        if (!equal(element.geometry, source.geometry)) issues.push({ code: "master-geometry-drift", severity: "minor", slideId: slide.id, instanceId: instance, masterId: master.id, elementId: element.id, sourceElementId: sourceId, message: `Element ${element.id} geometry differs from master source ${sourceId}; Update Master or Reapply if intentional` });
        if (!equal(normalizedMasterStyle(element), normalizedMasterStyle(source))) issues.push({ code: "master-style-drift", severity: "minor", slideId: slide.id, instanceId: instance, masterId: master.id, elementId: element.id, sourceElementId: sourceId, message: `Element ${element.id} styling differs from master source ${sourceId}; Update Master or Reapply if intentional` });
      }
    }
  }

  return { masterCount: Object.keys(masters).length, linkedSlideCount: linkedSlides.size, instanceCount: instanceKeys.size, issues, ready: !issues.some((issue) => issue.severity === "critical") };
}
