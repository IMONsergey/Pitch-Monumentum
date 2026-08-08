import type { DeckDocument, SceneElement, SlideDocument, TextElement, TextRun } from "../../deck-model/src/index.js";

export interface AdvancedVisualQAOptions {
  safeMarginDU?: number;
  minimumBodyFontPt?: number;
  minimumCaptionFontPt?: number;
  overlapThreshold?: number;
  titleDriftToleranceDU?: number;
  titleSizeTolerancePt?: number;
  denseCharacterThreshold?: number;
}

export interface AdvancedVisualIssue {
  id: string;
  category: "edge" | "readability" | "overlap" | "hierarchy" | "contrast" | "density" | "consistency";
  severity: "minor" | "major" | "critical";
  slideId: string;
  elementIds: string[];
  message: string;
  suggestedAction: string;
  autoFixSafe: boolean;
}

const DEFAULTS: Required<AdvancedVisualQAOptions> = {
  safeMarginDU: 48,
  minimumBodyFontPt: 14,
  minimumCaptionFontPt: 10,
  overlapThreshold: 0.12,
  titleDriftToleranceDU: 28,
  titleSizeTolerancePt: 4,
  denseCharacterThreshold: 900,
};

function options(input: AdvancedVisualQAOptions): Required<AdvancedVisualQAOptions> {
  return { ...DEFAULTS, ...input };
}

function issue(slideId: string, category: AdvancedVisualIssue["category"], severity: AdvancedVisualIssue["severity"], elementIds: string[], message: string, suggestedAction: string, autoFixSafe = false): AdvancedVisualIssue {
  return { id: `visual:${category}:${slideId}:${elementIds.join("+") || "slide"}:${message.slice(0, 24)}`, category, severity, slideId, elementIds, message, suggestedAction, autoFixSafe };
}

function isContent(element: SceneElement): boolean {
  return !["decoration", "footer", "source"].includes(element.semanticRole) && element.type !== "group" && element.type !== "frame";
}

function firstRun(element: TextElement): TextRun | undefined {
  return element.paragraphs.flatMap((paragraph) => paragraph.runs)[0];
}

function textLength(element: TextElement): number {
  return element.paragraphs.flatMap((paragraph) => paragraph.runs).reduce((sum, run) => sum + run.text.length, 0);
}

function minFontSize(element: TextElement): number | undefined {
  const sizes = element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.fontSizePt).filter((size): size is number => typeof size === "number"));
  return sizes.length ? Math.min(...sizes) : undefined;
}

function maxFontSize(element: TextElement): number | undefined {
  const sizes = element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.fontSizePt).filter((size): size is number => typeof size === "number"));
  return sizes.length ? Math.max(...sizes) : undefined;
}

function area(element: SceneElement): number {
  return Math.max(0, element.geometry.width) * Math.max(0, element.geometry.height);
}

function overlapArea(a: SceneElement, b: SceneElement): number {
  const left = Math.max(a.geometry.x, b.geometry.x);
  const top = Math.max(a.geometry.y, b.geometry.y);
  const right = Math.min(a.geometry.x + a.geometry.width, b.geometry.x + b.geometry.width);
  const bottom = Math.min(a.geometry.y + a.geometry.height, b.geometry.y + b.geometry.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function hexRgb(value?: string): [number, number, number] | undefined {
  if (!value || !/^#[0-9A-Fa-f]{6}$/.test(value)) return undefined;
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
}

function luminance(rgb: [number, number, number]): number {
  const c = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(foreground: string, background: string): number | undefined {
  const fg = hexRgb(foreground);
  const bg = hexRgb(background);
  if (!fg || !bg) return undefined;
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function slideBackground(slide: SlideDocument, canvasWidth: number, canvasHeight: number): string | undefined {
  const candidates = slide.scene.filter((element) => element.type === "shape" && element.fill && element.geometry.x <= 4 && element.geometry.y <= 4 && element.geometry.width >= canvasWidth - 8 && element.geometry.height >= canvasHeight - 8).sort((a, b) => a.zIndex - b.zIndex);
  return candidates[0]?.type === "shape" ? candidates[0].fill : undefined;
}

function safeEdgeIssues(deck: DeckDocument, slide: SlideDocument, o: Required<AdvancedVisualQAOptions>): AdvancedVisualIssue[] {
  const result: AdvancedVisualIssue[] = [];
  for (const element of slide.scene.filter(isContent)) {
    const g = element.geometry;
    const left = g.x;
    const top = g.y;
    const right = deck.canvas.widthDU - (g.x + g.width);
    const bottom = deck.canvas.heightDU - (g.y + g.height);
    const min = Math.min(left, top, right, bottom);
    if (min >= 0 && min < o.safeMarginDU) result.push(issue(slide.id, "edge", min < o.safeMarginDU / 2 ? "major" : "minor", [element.id], `Content object is only ${Math.round(min)} DU from the canvas edge.`, `Move the object inside the ${o.safeMarginDU} DU safe area.`, true));
  }
  return result;
}

function readabilityIssues(slide: SlideDocument, o: Required<AdvancedVisualQAOptions>): AdvancedVisualIssue[] {
  const result: AdvancedVisualIssue[] = [];
  for (const element of slide.scene) {
    if (element.type !== "text") continue;
    const size = minFontSize(element);
    if (size === undefined) continue;
    const threshold = ["caption", "source", "footer", "label"].includes(element.semanticRole) ? o.minimumCaptionFontPt : o.minimumBodyFontPt;
    if (size < threshold) result.push(issue(slide.id, "readability", size < threshold - 3 ? "major" : "minor", [element.id], `${element.semanticRole} text falls to ${size} pt.`, `Raise the smallest type to at least ${threshold} pt or reduce content density.`, false));
  }
  return result;
}

function overlapIssues(slide: SlideDocument, o: Required<AdvancedVisualQAOptions>): AdvancedVisualIssue[] {
  const result: AdvancedVisualIssue[] = [];
  const content = slide.scene.filter(isContent).filter((element) => !element.groupId);
  for (let i = 0; i < content.length; i += 1) {
    for (let j = i + 1; j < content.length; j += 1) {
      const a = content[i];
      const b = content[j];
      const overlap = overlapArea(a, b);
      if (!overlap) continue;
      const ratio = overlap / Math.max(1, Math.min(area(a), area(b)));
      if (ratio < o.overlapThreshold) continue;
      const textOverVisual = (a.type === "text" && ["shape", "image"].includes(b.type)) || (b.type === "text" && ["shape", "image"].includes(a.type));
      if (textOverVisual && (a.semanticRole === "label" || b.semanticRole === "label")) continue;
      result.push(issue(slide.id, "overlap", ratio > 0.5 ? "major" : "minor", [a.id, b.id], `Two independent content objects overlap by ${Math.round(ratio * 100)}% of the smaller object.`, "Separate, group intentionally, or explicitly mark one object as decoration/container.", false));
    }
  }
  return result;
}

function hierarchyIssues(slide: SlideDocument): AdvancedVisualIssue[] {
  const titles = slide.scene.filter((element): element is TextElement => element.type === "text" && element.semanticRole === "title");
  const body = slide.scene.filter((element): element is TextElement => element.type === "text" && ["body", "caption", "label"].includes(element.semanticRole));
  if (!titles.length) return [];
  const title = titles[0];
  const titleSize = maxFontSize(title);
  const biggestBody = Math.max(0, ...body.map((element) => maxFontSize(element) ?? 0));
  if (titleSize !== undefined && biggestBody > titleSize + 1) return [issue(slide.id, "hierarchy", "major", [title.id], `Body/label type (${biggestBody} pt) is larger than the main title (${titleSize} pt).`, "Restore a clear primary title hierarchy or intentionally change semantic roles.", false)];
  if (titles.length > 1) return [issue(slide.id, "hierarchy", "minor", titles.map((element) => element.id), "Slide contains more than one element marked as title.", "Keep one dominant slide title and demote secondary headings.", false)];
  return [];
}

function contrastIssues(deck: DeckDocument, slide: SlideDocument): AdvancedVisualIssue[] {
  const bg = slideBackground(slide, deck.canvas.widthDU, deck.canvas.heightDU);
  if (!bg) return [];
  const result: AdvancedVisualIssue[] = [];
  for (const element of slide.scene) {
    if (element.type !== "text" || element.groupId) continue;
    const run = firstRun(element);
    const ratio = contrastRatio(run?.color ?? "#111111", bg);
    if (ratio !== undefined && ratio < 3) result.push(issue(slide.id, "contrast", "major", [element.id], `Text/background contrast is ${ratio.toFixed(2)}:1.`, "Increase foreground/background contrast; aim for at least 3:1 for large text and 4.5:1 for normal body text.", false));
    else if (ratio !== undefined && ratio < 4.5 && !["title", "metric"].includes(element.semanticRole)) result.push(issue(slide.id, "contrast", "minor", [element.id], `Body text/background contrast is ${ratio.toFixed(2)}:1.`, "Increase contrast toward 4.5:1 or increase text size/weight.", false));
  }
  return result;
}

function densityIssues(deck: DeckDocument, slide: SlideDocument, o: Required<AdvancedVisualQAOptions>): AdvancedVisualIssue[] {
  const texts = slide.scene.filter((element): element is TextElement => element.type === "text");
  const chars = texts.reduce((sum, element) => sum + textLength(element), 0);
  const contentCount = slide.scene.filter(isContent).length;
  const contentArea = slide.scene.filter(isContent).reduce((sum, element) => sum + area(element), 0);
  const coverage = contentArea / Math.max(1, deck.canvas.widthDU * deck.canvas.heightDU);
  const result: AdvancedVisualIssue[] = [];
  if (chars > o.denseCharacterThreshold) result.push(issue(slide.id, "density", chars > o.denseCharacterThreshold * 1.6 ? "major" : "minor", texts.map((element) => element.id), `Slide contains ${chars} text characters.`, "Split the argument, shorten copy, or use a reader-led layout intentionally.", false));
  if (contentCount > 18) result.push(issue(slide.id, "density", "minor", [], `Slide contains ${contentCount} independent content objects.`, "Group related elements, simplify the visual grammar, or split the slide.", false));
  if (coverage > 1.5) result.push(issue(slide.id, "density", "minor", [], `Summed content area is ${coverage.toFixed(1)}× the slide area, indicating heavy overlap/density.`, "Reduce overlapping content or simplify the composition.", false));
  return result;
}

function deckConsistencyIssues(deck: DeckDocument, o: Required<AdvancedVisualQAOptions>): AdvancedVisualIssue[] {
  const titles = deck.slides.flatMap((slide) => slide.scene.filter((element): element is TextElement => element.type === "text" && element.semanticRole === "title").slice(0, 1).map((element) => ({ slide, element, size: maxFontSize(element) })));
  if (titles.length < 2) return [];
  const xValues = titles.map(({ element }) => element.geometry.x).sort((a, b) => a - b);
  const yValues = titles.map(({ element }) => element.geometry.y).sort((a, b) => a - b);
  const sizes = titles.map(({ size }) => size).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  const median = (values: number[]) => values[Math.floor(values.length / 2)];
  const baselineX = median(xValues);
  const baselineY = median(yValues);
  const baselineSize = sizes.length ? median(sizes) : undefined;
  const result: AdvancedVisualIssue[] = [];
  for (const { slide, element, size } of titles) {
    const drift = Math.max(Math.abs(element.geometry.x - baselineX), Math.abs(element.geometry.y - baselineY));
    if (drift > o.titleDriftToleranceDU) result.push(issue(slide.id, "consistency", "minor", [element.id], `Title position drifts ${Math.round(drift)} DU from the deck median.`, "Align the title to the deck grid unless this slide intentionally uses a different archetype.", true));
    if (baselineSize !== undefined && size !== undefined && Math.abs(size - baselineSize) > o.titleSizeTolerancePt) result.push(issue(slide.id, "consistency", "minor", [element.id], `Title size ${size} pt differs from the deck median ${baselineSize} pt.`, "Normalize title scale or explicitly use a hero/section archetype.", false));
  }
  return result;
}

export function runAdvancedVisualQA(deck: DeckDocument, input: AdvancedVisualQAOptions = {}): AdvancedVisualIssue[] {
  const o = options(input);
  const result: AdvancedVisualIssue[] = [];
  for (const slide of deck.slides) {
    result.push(...safeEdgeIssues(deck, slide, o));
    result.push(...readabilityIssues(slide, o));
    result.push(...overlapIssues(slide, o));
    result.push(...hierarchyIssues(slide));
    result.push(...contrastIssues(deck, slide));
    result.push(...densityIssues(deck, slide, o));
  }
  result.push(...deckConsistencyIssues(deck, o));
  return result;
}
