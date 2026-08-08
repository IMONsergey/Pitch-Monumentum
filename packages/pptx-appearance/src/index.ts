import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { DeckDocument, FrameElement, Paint, SceneElement, VisualEffect } from "../../deck-model/src/index.js";
import { compileDeckWithVectors } from "../../pptx-vector/src/index.js";
import type { RichAssetMap } from "../../pptx-rich/src/index.js";
import { readZipMap, writeZipMap } from "../../source-ingest/src/zip.js";

const EMU_PER_DU = 914400 / 144;
const FRAME_PROMOTION_FILL = "#FFFFFF";

function hex(color: string): string {
  const normalized = color.replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : "000000";
}

function alpha(opacity = 1): number {
  return Math.round(Math.max(0, Math.min(1, opacity)) * 100000);
}

function paintXml(paint: Paint): string {
  if (paint.kind === "none") return "<a:noFill/>";
  if (paint.kind === "solid") {
    const opacity = paint.opacity ?? 1;
    return `<a:solidFill><a:srgbClr val="${hex(paint.color)}">${opacity < 1 ? `<a:alpha val="${alpha(opacity)}"/>` : ""}</a:srgbClr></a:solidFill>`;
  }
  const stops = paint.stops.map((stop) => `<a:gs pos="${Math.round(Math.max(0, Math.min(1, stop.position)) * 100000)}"><a:srgbClr val="${hex(stop.color)}">${(stop.opacity ?? 1) < 1 ? `<a:alpha val="${alpha(stop.opacity ?? 1)}"/>` : ""}</a:srgbClr></a:gs>`).join("");
  // Pitch uses CSS-like angles (0° up, 90° right). DrawingML's 0° vector
  // points right and rotates clockwise, hence the -90° conversion.
  const drawingAngle = ((paint.angleDeg - 90) % 360 + 360) % 360;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${Math.round(drawingAngle * 60000)}" scaled="1"/></a:gradFill>`;
}

function firstShadow(effects: VisualEffect[] | undefined): Extract<VisualEffect, { kind: "dropShadow" }> | undefined {
  return effects?.find((effect): effect is Extract<VisualEffect, { kind: "dropShadow" }> => effect.kind === "dropShadow");
}

function shadowXml(effect: Extract<VisualEffect, { kind: "dropShadow" }> | undefined): string {
  if (!effect) return "";
  const distance = Math.sqrt(effect.offsetXDU ** 2 + effect.offsetYDU ** 2);
  const degrees = ((Math.atan2(effect.offsetYDU, effect.offsetXDU) * 180 / Math.PI) % 360 + 360) % 360;
  return `<a:effectLst><a:outerShdw blurRad="${Math.max(0, Math.round(effect.blurDU * EMU_PER_DU))}" dist="${Math.max(0, Math.round(distance * EMU_PER_DU))}" dir="${Math.round(degrees * 60000)}" algn="ctr" rotWithShape="0"><a:srgbClr val="${hex(effect.color)}"><a:alpha val="${alpha(effect.opacity)}"/></a:srgbClr></a:outerShdw></a:effectLst>`;
}

function replaceFill(spPr: string, paint: Paint | undefined): string {
  if (!paint) return spPr;
  const geometryEnd = spPr.search(/<\/a:prstGeom>/);
  if (geometryEnd < 0) return spPr;
  const end = geometryEnd + "</a:prstGeom>".length;
  const before = spPr.slice(0, end);
  let after = spPr.slice(end);
  after = after.replace(/^(?:<a:noFill\s*\/>|<a:solidFill>[\s\S]*?<\/a:solidFill>|<a:gradFill(?:\s[^>]*)?>[\s\S]*?<\/a:gradFill>)/, "");
  return `${before}${paintXml(paint)}${after}`;
}

function replaceEffect(spPr: string, effects: VisualEffect[] | undefined): string {
  const without = spPr.replace(/<a:effectLst>[\s\S]*?<\/a:effectLst>/g, "");
  const effect = shadowXml(firstShadow(effects));
  return effect ? `${without}${effect}` : without;
}

function mutateSpPr(block: string, paint: Paint | undefined, effects: VisualEffect[] | undefined): string {
  return block.replace(/<p:spPr>([\s\S]*?)<\/p:spPr>/, (_, body: string) => `<p:spPr>${replaceEffect(replaceFill(body, paint), effects)}</p:spPr>`);
}

function mutateBlocks(source: string, regex: RegExp, mutator: (block: string, index: number) => string): string {
  let cursor = 0;
  let index = 0;
  let output = "";
  for (const match of source.matchAll(regex)) {
    const start = match.index ?? 0;
    output += source.slice(cursor, start);
    output += mutator(match[0], index++);
    cursor = start + match[0].length;
  }
  output += source.slice(cursor);
  return output;
}

function appearanceMakesFrameVisual(frame: FrameElement): boolean {
  return Boolean(
    frame.fill
    || frame.stroke
    || (frame.fillPaint && frame.fillPaint.kind !== "none")
    || firstShadow(frame.effects),
  );
}

function appearanceOnlyFrame(frame: FrameElement): boolean {
  return !frame.fill && !frame.stroke && appearanceMakesFrameVisual(frame);
}

/**
 * The legacy rich compiler decides whether a frame is visual using legacy fill/stroke.
 * Promote appearance-only frames in a compile-only clone so they get a native p:sp at
 * their real z-index. The marker is replaced by canonical Paint in the appearance pass.
 */
function prepareDeckForAppearanceCompile(deck: DeckDocument): DeckDocument {
  const prepared = structuredClone(deck);
  for (const slide of prepared.slides) {
    for (const element of slide.scene) {
      if (element.type === "frame" && appearanceOnlyFrame(element)) element.fill = FRAME_PROMOTION_FILL;
    }
  }
  return prepared;
}

function framePaintForExport(frame: FrameElement): Paint | undefined {
  if (frame.fillPaint) return frame.fillPaint;
  if (appearanceOnlyFrame(frame)) return { kind: "none" };
  return undefined;
}

function shapeTargets(slide: DeckDocument["slides"][number]): SceneElement[] {
  return [...slide.scene]
    .sort((a, b) => a.zIndex - b.zIndex)
    .filter((element) => (
      element.type === "shape" && element.shape !== "custom"
    ) || (
      element.type === "frame" && appearanceMakesFrameVisual(element)
    ));
}

function textTargets(slide: DeckDocument["slides"][number]): SceneElement[] {
  return [...slide.scene].sort((a, b) => a.zIndex - b.zIndex).filter((element) => element.type === "text");
}

function lineTargets(slide: DeckDocument["slides"][number]): SceneElement[] {
  return [...slide.scene].sort((a, b) => a.zIndex - b.zIndex).filter((element) => element.type === "line");
}

function pictureName(block: string): string | undefined {
  return block.match(/<p:cNvPr\s+[^>]*name="([^"]*)"/)?.[1]
    ?.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function applySlideAppearance(slideXml: string, slide: DeckDocument["slides"][number]): string {
  const shapes = shapeTargets(slide);
  const texts = textTargets(slide);
  const lines = lineTargets(slide);
  let shapeIndex = 0;
  let textIndex = 0;

  let result = mutateBlocks(slideXml, /<p:sp>[\s\S]*?<\/p:sp>/g, (block) => {
    const isText = /<p:txBody(?:\s|>)/.test(block);
    const element = isText ? texts[textIndex++] : shapes[shapeIndex++];
    if (!element) return block;
    const paint = element.type === "shape"
      ? element.fillPaint
      : element.type === "frame"
        ? framePaintForExport(element)
        : undefined;
    return mutateSpPr(block, paint, element.effects);
  });

  result = mutateBlocks(result, /<p:cxnSp>[\s\S]*?<\/p:cxnSp>/g, (block, index) => {
    const element = lines[index];
    return element ? mutateSpPr(block, undefined, element.effects) : block;
  });

  const images = slide.scene.filter((element) => element.type === "image");
  if (images.some((image) => image.effects?.length)) {
    result = mutateBlocks(result, /<p:pic>[\s\S]*?<\/p:pic>/g, (block) => {
      const name = pictureName(block);
      const image = images.find((element) => (element.name || element.id) === name);
      return image ? mutateSpPr(block, undefined, image.effects) : block;
    });
  }
  return result;
}

export interface AppearanceCompileWarning {
  elementId: string;
  message: string;
}

function appearanceWarnings(deck: DeckDocument): AppearanceCompileWarning[] {
  const warnings: AppearanceCompileWarning[] = [];
  for (const slide of deck.slides) {
    for (const element of slide.scene) {
      if (element.effects && element.effects.filter((effect) => effect.kind === "dropShadow").length > 1) {
        warnings.push({ elementId: element.id, message: "PowerPoint supports one native outer shadow in the current Pitch appearance pass; only the first drop shadow is exported" });
      }
      if (element.type === "shape" && element.shape === "custom" && (element.fillPaint || element.effects?.length)) {
        warnings.push({ elementId: element.id, message: "Appearance on custom SVG vector is not injected after SVG vector conversion yet" });
      }
    }
  }
  return warnings;
}

export async function compileDeckWithAppearance(deck: DeckDocument, outputPath: string, assets: RichAssetMap = {}) {
  const prepared = prepareDeckForAppearanceCompile(deck);
  const compiled = await compileDeckWithVectors(prepared, outputPath, assets);
  const entries = readZipMap(await readFile(outputPath));
  for (let index = 0; index < deck.slides.length; index += 1) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    const source = entries.get(path)?.toString("utf8");
    if (!source) throw new Error(`Missing ${path} during appearance pass`);
    entries.set(path, Buffer.from(applySlideAppearance(source, deck.slides[index]), "utf8"));
  }
  const buffer = writeZipMap(entries);
  await writeFile(outputPath, buffer);
  const extraWarnings = appearanceWarnings(deck);
  return {
    ...compiled,
    outputPath,
    warnings: [...compiled.warnings, ...extraWarnings.map((warning) => `${warning.elementId}: ${warning.message}`)],
    contentHash: createHash("sha256").update(buffer).digest("hex"),
    appearanceWarnings: extraWarnings,
  };
}
