import type { ChartElement, DeckDocument, TableElement } from "../../deck-model/src/index.js";
import { executeChartCommand, type ChartCommand } from "../../chart-editor/src/index.js";
import { executeTableCommand, type TableCommand } from "../../table-editor/src/index.js";

export type DataObjectCommand =
  | { command: "chart"; slideId: string; elementId: string; edit: ChartCommand }
  | { command: "table"; slideId: string; elementId: string; edit: TableCommand };

export interface DataObjectCommandResult {
  deck: DeckDocument;
  changed: boolean;
  slideId: string;
  elementId: string;
  reason: string;
  impact: {
    affectedSlideIds: string[];
    affectedElementIds: string[];
    staleArtifacts: Array<"qa:visual" | "qa:readability" | "qa:evidence" | "export">;
    evidenceRisk: boolean;
  };
  warnings: string[];
}

function replaceElement(deck: DeckDocument, slideId: string, elementId: string, replacement: ChartElement | TableElement): DeckDocument {
  const slide = deck.slides.find((item) => item.id === slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const existing = slide.scene.find((item) => item.id === elementId);
  if (!existing) throw new Error(`Unknown element ${elementId} on slide ${slideId}`);
  if (existing.type !== replacement.type || replacement.id !== existing.id) throw new Error("Data object command cannot change stable id or element type");
  return {
    ...deck,
    updatedAt: new Date().toISOString(),
    slides: deck.slides.map((item) => item.id === slideId ? {
      ...item,
      status: "draft",
      scene: item.scene.map((element) => element.id === elementId ? replacement : element),
    } : item),
  };
}

function evidenceRisk(element: ChartElement | TableElement): boolean {
  if (element.dependencies.some((dependency) => dependency.kind === "claim" || dependency.kind === "evidence" || dependency.kind === "dataset")) return true;
  if (element.type === "chart" && element.chart.dataSourceRefs.length) return true;
  return false;
}

export function executeDataObjectCommand(deck: DeckDocument, input: DataObjectCommand): DataObjectCommandResult {
  const slide = deck.slides.find((item) => item.id === input.slideId);
  if (!slide) throw new Error(`Unknown slide: ${input.slideId}`);
  const element = slide.scene.find((item) => item.id === input.elementId);
  if (!element) throw new Error(`Unknown element ${input.elementId} on slide ${input.slideId}`);

  if (input.command === "chart") {
    if (element.type !== "chart") throw new Error(`Element ${input.elementId} is not a chart`);
    const edited = executeChartCommand(element, input.edit);
    const replacement: ChartElement = { ...element, chart: edited.chart, origin: "user" };
    const risk = evidenceRisk(replacement);
    return {
      deck: edited.changed ? replaceElement(deck, input.slideId, input.elementId, replacement) : deck,
      changed: edited.changed,
      slideId: input.slideId,
      elementId: input.elementId,
      reason: `Edit chart ${input.elementId}: ${input.edit.command}`,
      impact: {
        affectedSlideIds: [input.slideId],
        affectedElementIds: [input.elementId],
        staleArtifacts: risk ? ["qa:visual", "qa:readability", "qa:evidence", "export"] : ["qa:visual", "qa:readability", "export"],
        evidenceRisk: risk,
      },
      warnings: edited.warnings,
    };
  }

  if (element.type !== "table") throw new Error(`Element ${input.elementId} is not a table`);
  const edited = executeTableCommand(element, input.edit);
  const replacement: TableElement = { ...element, ...edited.table, id: element.id, type: "table", origin: "user" };
  const risk = evidenceRisk(replacement);
  return {
    deck: edited.changed ? replaceElement(deck, input.slideId, input.elementId, replacement) : deck,
    changed: edited.changed,
    slideId: input.slideId,
    elementId: input.elementId,
    reason: `Edit table ${input.elementId}: ${input.edit.command}`,
    impact: {
      affectedSlideIds: [input.slideId],
      affectedElementIds: [input.elementId],
      staleArtifacts: risk ? ["qa:visual", "qa:readability", "qa:evidence", "export"] : ["qa:visual", "qa:readability", "export"],
      evidenceRisk: risk,
    },
    warnings: [],
  };
}
