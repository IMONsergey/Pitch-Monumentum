import { readFile } from "node:fs/promises";
import type { DeckDocument, Paint, SceneElement, VisualEffect } from "../../deck-model/src/index.js";
import { readZipMap } from "../../source-ingest/src/zip.js";
import type { RoundTripIssue } from "../../pptx-roundtrip/src/index.js";

const EMU_PER_DU = 914400 / 144;

type Shadow = Extract<VisualEffect, { kind: "dropShadow" }>;

interface InspectedPaint {
  kind: "none" | "solid" | "linearGradient";
  color?: string;
  opacity?: number;
  angleDeg?: number;
  stops?: Array<{ position: number; color: string; opacity: number }>;
}

interface InspectedShadow {
  color: string;
  opacity: number;
  blurDU: number;
  offsetXDU: number;
  offsetYDU: number;
}

function attr(source: string, name: string): string | undefined {
  return source.match(new RegExp(`(?:^|\\s)${name}="([^"]+)"`))?.[1];
}

function colorAndOpacity(body: string): { color: string; opacity: number } | undefined {
  const color = body.match(/<a:srgbClr\s+[^>]*val="([0-9A-Fa-f]{6})"[^>]*>([\s\S]*?)<\/a:srgbClr>|<a:srgbClr\s+[^>]*val="([0-9A-Fa-f]{6})"\s*\/>/);
  if (!color) return undefined;
  const value = (color[1] ?? color[3]).toUpperCase();
  const alpha = (color[2] ?? "").match(/<a:alpha\s+[^>]*val="(\d+)"/)?.[1];
  return { color: `#${value}`, opacity: alpha ? Number(alpha) / 100000 : 1 };
}

function inspectPaint(spPr: string): InspectedPaint | undefined {
  const fillSection = spPr.split(/<a:ln(?:\s|>)/)[0];
  const gradient = fillSection.match(/<a:gradFill(?:\s[^>]*)?>([\s\S]*?)<\/a:gradFill>/)?.[1];
  if (gradient) {
    const stops = [...gradient.matchAll(/<a:gs\s+[^>]*pos="(\d+)"[^>]*>([\s\S]*?)<\/a:gs>/g)].flatMap((match) => {
      const parsed = colorAndOpacity(match[2]);
      return parsed ? [{ position: Number(match[1]) / 100000, ...parsed }] : [];
    });
    const opening = gradient.match(/<a:lin\s+([^>]*)\/>/)?.[1] ?? "";
    const drawingAngle = Number(attr(opening, "ang") ?? 0) / 60000;
    return { kind: "linearGradient", angleDeg: (drawingAngle + 90) % 360, stops };
  }
  const solid = fillSection.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/)?.[1];
  if (solid) {
    const parsed = colorAndOpacity(solid);
    if (parsed) return { kind: "solid", ...parsed };
  }
  if (/<a:noFill\s*\/>/.test(fillSection)) return { kind: "none" };
  return undefined;
}

function inspectShadow(spPr: string): InspectedShadow | undefined {
  const match = spPr.match(/<a:outerShdw\s+([^>]*)>([\s\S]*?)<\/a:outerShdw>/);
  if (!match) return undefined;
  const parsed = colorAndOpacity(match[2]);
  if (!parsed) return undefined;
  const blurDU = Number(attr(match[1], "blurRad") ?? 0) / EMU_PER_DU;
  const distanceDU = Number(attr(match[1], "dist") ?? 0) / EMU_PER_DU;
  const degrees = Number(attr(match[1], "dir") ?? 0) / 60000;
  const radians = degrees * Math.PI / 180;
  return {
    color: parsed.color,
    opacity: parsed.opacity,
    blurDU,
    offsetXDU: Math.cos(radians) * distanceDU,
    offsetYDU: Math.sin(radians) * distanceDU,
  };
}

function spPr(block: string): string {
  return block.match(/<p:spPr>([\s\S]*?)<\/p:spPr>/)?.[1] ?? "";
}

function blocks(source: string, regex: RegExp): string[] {
  return [...source.matchAll(regex)].map((match) => match[0]);
}

function visualShapes(slide: DeckDocument["slides"][number]): SceneElement[] {
  return [...slide.scene]
    .sort((a, b) => a.zIndex - b.zIndex)
    .filter((element) => (element.type === "shape" && element.shape !== "custom") || (element.type === "frame" && Boolean(element.fill || element.stroke || element.fillPaint)));
}

function textElements(slide: DeckDocument["slides"][number]): SceneElement[] {
  return [...slide.scene].sort((a, b) => a.zIndex - b.zIndex).filter((element) => element.type === "text");
}

function lineElements(slide: DeckDocument["slides"][number]): SceneElement[] {
  return [...slide.scene].sort((a, b) => a.zIndex - b.zIndex).filter((element) => element.type === "line");
}

function pictureName(block: string): string | undefined {
  return block.match(/<p:cNvPr\s+[^>]*name="([^"]*)"/)?.[1];
}

function firstShadow(effects: VisualEffect[] | undefined): Shadow | undefined {
  return effects?.find((effect): effect is Shadow => effect.kind === "dropShadow");
}

function close(a: number | undefined, b: number | undefined, tolerance = 0.06): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return Math.abs(a - b) <= tolerance;
}

function color(value: string | undefined): string | undefined {
  return value?.toUpperCase();
}

function paintDiff(expected: Paint | undefined, actual: InspectedPaint | undefined): string[] {
  if (!expected) return [];
  const differences: string[] = [];
  if (!actual) return ["paint missing after export"];
  if (expected.kind !== actual.kind) return [`paint kind expected=${expected.kind} actual=${actual.kind}`];
  if (expected.kind === "solid" && actual.kind === "solid") {
    if (color(expected.color) !== color(actual.color)) differences.push(`color expected=${expected.color} actual=${actual.color}`);
    if (!close(expected.opacity ?? 1, actual.opacity ?? 1, .001)) differences.push(`opacity expected=${expected.opacity ?? 1} actual=${actual.opacity}`);
  }
  if (expected.kind === "linearGradient" && actual.kind === "linearGradient") {
    const normalizedExpected = ((expected.angleDeg % 360) + 360) % 360;
    if (!close(normalizedExpected, actual.angleDeg, .02)) differences.push(`angle expected=${normalizedExpected} actual=${actual.angleDeg}`);
    if (expected.stops.length !== actual.stops?.length) differences.push(`stops expected=${expected.stops.length} actual=${actual.stops?.length ?? 0}`);
    for (let index = 0; index < Math.min(expected.stops.length, actual.stops?.length ?? 0); index += 1) {
      const a = expected.stops[index];
      const b = actual.stops![index];
      if (!close(a.position, b.position, .001)) differences.push(`stop${index}.position expected=${a.position} actual=${b.position}`);
      if (color(a.color) !== color(b.color)) differences.push(`stop${index}.color expected=${a.color} actual=${b.color}`);
      if (!close(a.opacity ?? 1, b.opacity ?? 1, .001)) differences.push(`stop${index}.opacity expected=${a.opacity ?? 1} actual=${b.opacity}`);
    }
  }
  return differences;
}

function shadowDiff(expected: Shadow | undefined, actual: InspectedShadow | undefined): string[] {
  if (!expected && !actual) return [];
  if (expected && !actual) return ["drop shadow missing after export"];
  if (!expected && actual) return ["unexpected drop shadow after export"];
  const differences: string[] = [];
  if (color(expected!.color) !== color(actual!.color)) differences.push(`shadow color expected=${expected!.color} actual=${actual!.color}`);
  if (!close(expected!.opacity, actual!.opacity, .001)) differences.push(`shadow opacity expected=${expected!.opacity} actual=${actual!.opacity}`);
  if (!close(expected!.blurDU, actual!.blurDU, .08)) differences.push(`shadow blurDU expected=${expected!.blurDU} actual=${actual!.blurDU}`);
  if (!close(expected!.offsetXDU, actual!.offsetXDU, .08)) differences.push(`shadow x expected=${expected!.offsetXDU} actual=${actual!.offsetXDU}`);
  if (!close(expected!.offsetYDU, actual!.offsetYDU, .08)) differences.push(`shadow y expected=${expected!.offsetYDU} actual=${actual!.offsetYDU}`);
  return differences;
}

function issue(slideId: string, elementId: string, differences: string[]): RoundTripIssue | undefined {
  if (!differences.length) return undefined;
  return { severity: "major", kind: "shapeStyle", slideId, elementId, message: `Native Appearance drift: ${differences.join("; ")}` };
}

export async function validatePptxAppearance(deck: DeckDocument, path: string): Promise<RoundTripIssue[]> {
  const entries = readZipMap(await readFile(path));
  const issues: RoundTripIssue[] = [];

  for (let slideIndex = 0; slideIndex < deck.slides.length; slideIndex += 1) {
    const slide = deck.slides[slideIndex];
    const source = entries.get(`ppt/slides/slide${slideIndex + 1}.xml`)?.toString("utf8");
    if (!source) continue;
    const shapeBlocks = blocks(source, /<p:sp>[\s\S]*?<\/p:sp>/g);
    const textBlocks = shapeBlocks.filter((block) => /<p:txBody(?:\s|>)/.test(block));
    const nonTextBlocks = shapeBlocks.filter((block) => !/<p:txBody(?:\s|>)/.test(block));
    const lineBlocks = blocks(source, /<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g);
    const pictureBlocks = blocks(source, /<p:pic>[\s\S]*?<\/p:pic>/g);

    const shapes = visualShapes(slide);
    for (let index = 0; index < Math.min(shapes.length, nonTextBlocks.length); index += 1) {
      const element = shapes[index];
      const properties = spPr(nonTextBlocks[index]);
      const differences = [
        ...paintDiff((element.type === "shape" || element.type === "frame") ? element.fillPaint : undefined, inspectPaint(properties)),
        ...shadowDiff(firstShadow(element.effects), inspectShadow(properties)),
      ];
      const found = issue(slide.id, element.id, differences);
      if (found) issues.push(found);
    }

    const texts = textElements(slide);
    for (let index = 0; index < Math.min(texts.length, textBlocks.length); index += 1) {
      const differences = shadowDiff(firstShadow(texts[index].effects), inspectShadow(spPr(textBlocks[index])));
      const found = issue(slide.id, texts[index].id, differences);
      if (found) issues.push({ ...found, kind: "textStyle" });
    }

    const lines = lineElements(slide);
    for (let index = 0; index < Math.min(lines.length, lineBlocks.length); index += 1) {
      const differences = shadowDiff(firstShadow(lines[index].effects), inspectShadow(spPr(lineBlocks[index])));
      const found = issue(slide.id, lines[index].id, differences);
      if (found) issues.push({ ...found, kind: "lineStyle" });
    }

    for (const image of slide.scene.filter((element) => element.type === "image" && firstShadow(element.effects))) {
      const block = pictureBlocks.find((candidate) => pictureName(candidate) === (image.name || image.id));
      if (!block) continue;
      const differences = shadowDiff(firstShadow(image.effects), inspectShadow(spPr(block)));
      const found = issue(slide.id, image.id, differences);
      if (found) issues.push(found);
    }
  }
  return issues;
}
