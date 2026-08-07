import type {
  Claim,
  DeckDocument,
  DesignSystem,
  SceneElement,
  SlideDocument,
  TextElement,
  TextParagraph,
} from "../../deck-model/src/index.js";
import type { Storyboard, StoryboardSlide } from "../../pipeline/src/index.js";

export interface ComposeStoryboardInput {
  storyboard: Storyboard;
  designSystem: DesignSystem;
  briefId: string;
  narrativeId: string;
  sourceIds: string[];
  claims: Claim[];
  branchId: string;
  deckId?: string;
  now?: string;
}

function color(design: DesignSystem, key: string, fallback: string): string {
  return design.tokens.colors[key] ?? fallback;
}
function font(design: DesignSystem, key: string, fallback = "Aptos"): string {
  return design.tokens.fonts[key] ?? design.tokens.fonts.body ?? fallback;
}
function size(design: DesignSystem, key: string, fallback: number): number {
  return design.tokens.typeScalePt[key] ?? fallback;
}
function paragraph(text: string, fontFamily: string, fontSizePt: number, colorValue: string, bold = false): TextParagraph {
  return { runs: [{ text, fontFamily, fontSizePt, color: colorValue, bold }] };
}
function text(
  id: string,
  role: TextElement["semanticRole"],
  x: number,
  y: number,
  width: number,
  height: number,
  paragraphs: TextParagraph[],
  zIndex: number,
  dependencies: TextElement["dependencies"] = [],
): TextElement {
  return { id, type: "text", semanticRole: role, geometry: { x, y, width, height }, zIndex, origin: "deterministic", exportStrategy: "native", dependencies, paragraphs, fitPolicy: "shrinkText" };
}

function baseScene(slide: StoryboardSlide, design: DesignSystem): SceneElement[] {
  const canvas = color(design, "canvas", "#F7F7F3");
  const accent = color(design, "accent", "#1D4ED8");
  const primary = color(design, "primaryText", "#111111");
  const secondary = color(design, "secondaryText", "#565B65");
  const display = font(design, "display");
  const body = font(design, "body");
  return [
    { id: `${slide.id}:background`, type: "shape", semanticRole: "decoration", geometry: { x: 0, y: 0, width: 1920, height: 1080 }, zIndex: 0, origin: "deterministic", exportStrategy: "native", dependencies: [], shape: "rect", fill: canvas },
    { id: `${slide.id}:accent`, type: "shape", semanticRole: "decoration", geometry: { x: 144, y: 92, width: 66, height: 8 }, zIndex: 1, origin: "deterministic", exportStrategy: "native", dependencies: [], shape: "rect", fill: accent },
    text(`${slide.id}:title`, "title", 144, 132, 1540, 150, [paragraph(slide.title, display, size(design, "h1", 36), primary, true)], 2),
    text(`${slide.id}:takeaway`, "subtitle", 144, 280, 1490, 115, [paragraph(slide.semantic.takeaway, body, size(design, "bodyLarge", 22), secondary)], 3, slide.semantic.claimIds.map(id => ({ kind: "claim", id }))),
  ];
}

function numberFrom(textValue: string): { metric: string; remainder: string } | undefined {
  const match = textValue.match(/(?:[$€£₽]\s*)?[+-]?\d[\d\s,.]*(?:\s?%|\s?(?:k|m|bn|b|тыс\.?|млн|млрд))?/i);
  if (!match) return undefined;
  const metric = match[0].trim();
  if (!metric || !/\d/.test(metric)) return undefined;
  return { metric, remainder: textValue.replace(match[0], "").replace(/^\s*[-–—:,]\s*/, "").trim() };
}

function composeHeroMetric(slide: StoryboardSlide, design: DesignSystem): SceneElement[] {
  const scene = baseScene(slide, design);
  const primary = color(design, "primaryText", "#111111");
  const accent = color(design, "accent", "#1D4ED8");
  const body = font(design, "body");
  const display = font(design, "display");
  const metric = numberFrom(slide.semantic.takeaway);
  if (metric) {
    scene.push(text(`${slide.id}:metric`, "metric", 144, 470, 900, 280, [paragraph(metric.metric, display, size(design, "metric", 92), accent, true)], 4, slide.semantic.claimIds.map(id => ({ kind: "claim", id }))));
    if (metric.remainder) scene.push(text(`${slide.id}:metric-context`, "body", 150, 748, 980, 120, [paragraph(metric.remainder, body, size(design, "body", 24), primary)], 5));
  } else {
    scene.push(text(`${slide.id}:statement`, "body", 144, 500, 1450, 250, [paragraph(slide.semantic.takeaway, display, size(design, "display", 48), primary, true)], 4));
  }
  return scene;
}

function composeDecision(slide: StoryboardSlide, design: DesignSystem): SceneElement[] {
  const scene = baseScene(slide, design);
  const surface = color(design, "surface", "#FFFFFF");
  const border = color(design, "border", "#D9DCE1");
  const primary = color(design, "primaryText", "#111111");
  const accent = color(design, "accent", "#1D4ED8");
  const display = font(design, "display");
  scene.push({ id: `${slide.id}:decision-card`, type: "shape", semanticRole: "visual", geometry: { x: 144, y: 485, width: 1632, height: 350 }, zIndex: 4, origin: "deterministic", exportStrategy: "native", dependencies: [], shape: "roundRect", fill: surface, stroke: { color: border, widthDU: 1 }, radiusDU: 28 });
  scene.push(text(`${slide.id}:decision`, "body", 210, 555, 1350, 180, [paragraph(slide.semantic.takeaway, display, size(design, "display", 44), primary, true)], 5));
  scene.push({ id: `${slide.id}:decision-mark`, type: "shape", semanticRole: "decoration", geometry: { x: 1600, y: 570, width: 92, height: 92 }, zIndex: 6, origin: "deterministic", exportStrategy: "native", dependencies: [], shape: "ellipse", fill: accent });
  return scene;
}

function composeGeneric(slide: StoryboardSlide, design: DesignSystem): SceneElement[] {
  const scene = baseScene(slide, design);
  const primary = color(design, "primaryText", "#111111");
  const muted = color(design, "secondaryText", "#565B65");
  const body = font(design, "body");
  scene.push(text(`${slide.id}:purpose`, "label", 144, 490, 260, 60, [paragraph("WHY THIS SLIDE", body, 13, muted, true)], 4));
  scene.push(text(`${slide.id}:purpose-value`, "body", 144, 555, 1450, 180, [paragraph(slide.semantic.purpose, body, size(design, "body", 25), primary)], 5));
  if (slide.visualIntent) scene.push(text(`${slide.id}:visual-intent`, "caption", 144, 900, 1450, 60, [paragraph(slide.visualIntent, body, 14, muted)], 6));
  return scene;
}

export function composeSlide(slide: StoryboardSlide, design: DesignSystem): SlideDocument {
  let scene: SceneElement[];
  if (slide.archetype === "heroMetric") scene = composeHeroMetric(slide, design);
  else if (slide.archetype === "decision" || slide.archetype === "ask" || slide.archetype === "closing") scene = composeDecision(slide, design);
  else scene = composeGeneric(slide, design);
  return { id: slide.id, order: slide.order, sectionId: slide.sectionId, title: slide.title, archetype: slide.archetype, semantic: slide.semantic, scene, status: "draft", qaIssueIds: [], dependencyIds: [...new Set([...slide.semantic.claimIds, ...slide.semantic.evidenceRefs])] };
}

export function composeStoryboardToDeck(input: ComposeStoryboardInput): DeckDocument {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: "0.1",
    id: input.deckId ?? `deck_${input.storyboard.id}`,
    title: input.storyboard.deckTitle,
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: input.briefId,
    narrativeId: input.narrativeId,
    designSystemId: input.designSystem.id,
    slides: input.storyboard.slides.map(slide => composeSlide(slide, input.designSystem)),
    sourceIds: input.sourceIds,
    claimIds: input.claims.map(claim => claim.id),
    activeBranchId: input.branchId,
    createdAt: now,
    updatedAt: now,
  };
}
