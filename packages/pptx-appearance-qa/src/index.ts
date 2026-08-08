import { readFile } from "node:fs/promises";
import type { DeckDocument, Paint, SceneElement, VisualEffect } from "../../deck-model/src/index.js";
import { pitchIdFromDescription } from "../../pptx-identity/src/index.js";
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

function xmlDecode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
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

function blockPitchId(block: string): string | undefined {
  const encoded = block.match(/<p:cNvPr\s+[^>]*descr="([^"]*)"/)?.[1];
  return pitchIdFromDescription(encoded ? xmlDecode(encoded) : undefined);
}

function blocksByPitchId(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const block of [
    ...blocks(source, /<p:sp>[\s\S]*?<\/p:sp>/g),
    ...blocks(source, /<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g),
    ...blocks(source, /<p:pic>[\s\S]*?<\/p:pic>/g),
    ...blocks(source, /<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g),
  ]) {
    const id = blockPitchId(block);
    if (id) result.set(id, block);
  }
  return result;
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

function issue(slideId: string, elementId: string, kind: RoundTripIssue["kind"], differences: string[]): RoundTripIssue | undefined {
  if (!differences.length) return undefined;
  return { severity: "major", kind, slideId, elementId, message: `Native Appearance drift: ${differences.join("; ")}` };
}

function appearanceSupportedForPptx(element: SceneElement): boolean {
  if (element.type === "shape" && element.shape === "custom") return false;
  return ["shape", "frame", "text", "line", "image"].includes(element.type);
}

function expectedAppearance(element: SceneElement): boolean {
  return Boolean(
    ((element.type === "shape" || element.type === "frame") && element.fillPaint)
    || firstShadow(element.effects),
  );
}

export async function validatePptxAppearance(deck: DeckDocument, path: string): Promise<RoundTripIssue[]> {
  const entries = readZipMap(await readFile(path));
  const issues: RoundTripIssue[] = [];

  for (let slideIndex = 0; slideIndex < deck.slides.length; slideIndex += 1) {
    const slide = deck.slides[slideIndex];
    const source = entries.get(`ppt/slides/slide${slideIndex + 1}.xml`)?.toString("utf8");
    if (!source) continue;
    const exported = blocksByPitchId(source);

    for (const element of slide.scene) {
      if (!appearanceSupportedForPptx(element) || !expectedAppearance(element)) continue;
      const block = exported.get(element.id);
      if (!block) {
        issues.push({
          severity: "major",
          kind: "nativeStructure",
          slideId: slide.id,
          elementId: element.id,
          message: `PPTX object with stable Pitch identity ${element.id} is missing while validating Appearance`,
        });
        continue;
      }
      const properties = spPr(block);
      const differences: string[] = [];
      if (element.type === "shape" || element.type === "frame") differences.push(...paintDiff(element.fillPaint, inspectPaint(properties)));
      differences.push(...shadowDiff(firstShadow(element.effects), inspectShadow(properties)));
      const kind: RoundTripIssue["kind"] = element.type === "text" ? "textStyle" : element.type === "line" ? "lineStyle" : "shapeStyle";
      const found = issue(slide.id, element.id, kind, differences);
      if (found) issues.push(found);
    }
  }
  return issues;
}
