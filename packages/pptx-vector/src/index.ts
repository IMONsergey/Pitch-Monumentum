import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { DeckDocument, ShapeElement } from "../../deck-model/src/index.js";
import { compileDeckWithNativeCharts, type ChartCompileResult } from "../../pptx-charts/src/index.js";
import type { RichAssetMap } from "../../pptx-rich/src/index.js";
import { readZipMap, writeZipMap } from "../../source-ingest/src/zip.js";
import { effectiveVectorSvgPath } from "../../vector-engine/src/index.js";
import { vectorPathBounds } from "../../vector-engine/src/path-utils.js";

const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

interface CustomPathRef {
  slideIndex: number;
  element: ShapeElement;
  marker: string;
  svgPath: string;
  viewBox: { left: number; top: number; width: number; height: number };
}

function xml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markerFor(elementId: string): string {
  return `__pitch_custom_vector_${elementId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function customPaths(deck: DeckDocument): CustomPathRef[] {
  const result: CustomPathRef[] = [];
  deck.slides.forEach((slide, slideIndex) => {
    slide.scene.forEach((element) => {
      if (element.type !== "shape" || element.shape !== "custom") return;
      const svgPath = effectiveVectorSvgPath(element)?.trim();
      if (!svgPath) throw new Error(`Custom shape ${element.id} is missing pathData/svgPath`);
      const intrinsic = element.pathData
        ? vectorPathBounds(element.pathData)
        : { left: 0, top: 0, width: Math.max(0.01, element.geometry.width), height: Math.max(0.01, element.geometry.height) };
      result.push({
        slideIndex,
        element,
        marker: markerFor(element.id),
        svgPath,
        viewBox: { left: intrinsic.left, top: intrinsic.top, width: intrinsic.width, height: intrinsic.height },
      });
    });
  });
  return result;
}

function svgFor(vector: CustomPathRef): string {
  const element = vector.element;
  const width = Math.max(0.01, element.geometry.width);
  const height = Math.max(0.01, element.geometry.height);
  const fill = element.fill && element.fill.toLowerCase() !== "transparent" ? element.fill : "none";
  const stroke = element.stroke?.color ?? "none";
  const strokeWidth = element.stroke?.widthDU ?? 0;
  const dash = element.stroke?.dash === "dash"
    ? `${Math.max(1, strokeWidth * 4)} ${Math.max(1, strokeWidth * 2)}`
    : element.stroke?.dash === "dot"
      ? `${Math.max(1, strokeWidth)} ${Math.max(1, strokeWidth * 1.5)}`
      : undefined;
  const box = vector.viewBox;
  const fillRule = element.pathData?.fillRule ?? "nonzero";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${box.left} ${box.top} ${box.width} ${box.height}" preserveAspectRatio="none"><path d="${xml(vector.svgPath)}" fill="${xml(fill)}" fill-rule="${fillRule}" stroke="${xml(stroke)}" stroke-width="${strokeWidth}"${dash ? ` stroke-dasharray="${xml(dash)}"` : ""} vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function nextRelationshipId(xmlText: string): string {
  const ids = [...xmlText.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  return `rId${Math.max(0, ...ids) + 1}`;
}

function addRelationship(existing: Buffer | undefined, relationshipId: string, target: string): Buffer {
  const relation = `<Relationship Id="${relationshipId}" Type="${IMAGE_REL}" Target="${xml(target)}"/>`;
  if (!existing) return Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL_NS}">${relation}</Relationships>`, "utf8");
  return Buffer.from(existing.toString("utf8").replace("</Relationships>", `${relation}</Relationships>`), "utf8");
}

function ensureSvgContentType(entries: Map<string, Buffer>): void {
  const key = "[Content_Types].xml";
  const source = entries.get(key)?.toString("utf8");
  if (!source) throw new Error("PPTX package is missing [Content_Types].xml");
  if (source.includes('Extension="svg"')) return;
  entries.set(key, Buffer.from(source.replace("</Types>", '<Default Extension="svg" ContentType="image/svg+xml"/></Types>'), "utf8"));
}

function nextMediaIndex(entries: Map<string, Buffer>): number {
  const indices = [...entries.keys()].flatMap((name) => {
    const match = name.match(/^ppt\/media\/image(\d+)\.[^.]+$/);
    return match ? [Number(match[1])] : [];
  });
  return Math.max(0, ...indices) + 1;
}

function pictureXml(element: ShapeElement, relationshipId: string, objectId: number): string {
  const g = element.geometry;
  const x = Math.round(g.x * 6350);
  const y = Math.round(g.y * 6350);
  const cx = Math.max(1, Math.round(g.width * 6350));
  const cy = Math.max(1, Math.round(g.height * 6350));
  const rotation = g.rotation ? ` rot="${Math.round(g.rotation * 60000)}"` : "";
  return `<p:pic><p:nvPicPr><p:cNvPr id="${objectId}" name="${xml(element.name || element.id)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm${rotation}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr></p:pic>`;
}

function replaceMarkerShape(slideXml: string, marker: string, replacement: (objectId: number) => string): string {
  const escaped = escapeRegex(xml(marker));
  const regex = new RegExp(`<p:sp>(?:(?!<p:sp>).)*?<p:cNvPr id="(\\d+)" name="${escaped}"\\/>(?:(?!<p:sp>).)*?<\\/p:sp>`, "s");
  const match = slideXml.match(regex);
  if (!match) throw new Error(`Could not locate custom vector marker ${marker} in compiled slide XML`);
  return slideXml.replace(regex, replacement(Number(match[1])));
}

export async function compileDeckWithVectors(deck: DeckDocument, outputPath: string, assets: RichAssetMap = {}): Promise<ChartCompileResult> {
  const vectors = customPaths(deck);
  if (!vectors.length) return compileDeckWithNativeCharts(deck, outputPath, assets);

  const marked = structuredClone(deck);
  for (const vector of vectors) {
    const element = marked.slides[vector.slideIndex].scene.find((item) => item.id === vector.element.id);
    if (!element || element.type !== "shape") throw new Error(`Custom vector ${vector.element.id} disappeared during compile preparation`);
    element.name = vector.marker;
  }

  const compiled = await compileDeckWithNativeCharts(marked, outputPath, assets);
  const entries = readZipMap(await readFile(outputPath));
  ensureSvgContentType(entries);
  let mediaIndex = nextMediaIndex(entries);

  for (const vector of vectors) {
    const slideNumber = vector.slideIndex + 1;
    const slidePath = `ppt/slides/slide${slideNumber}.xml`;
    const relsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
    const slideSource = entries.get(slidePath)?.toString("utf8");
    if (!slideSource) throw new Error(`Missing ${slidePath}`);
    const existingRels = entries.get(relsPath);
    const relationshipId = nextRelationshipId(existingRels?.toString("utf8") ?? "");
    const mediaName = `image${mediaIndex++}.svg`;
    entries.set(`ppt/media/${mediaName}`, Buffer.from(svgFor(vector), "utf8"));
    entries.set(relsPath, addRelationship(existingRels, relationshipId, `../media/${mediaName}`));
    entries.set(slidePath, Buffer.from(replaceMarkerShape(slideSource, vector.marker, (objectId) => pictureXml(vector.element, relationshipId, objectId)), "utf8"));
  }

  const buffer = writeZipMap(entries);
  await writeFile(outputPath, buffer);
  const vectorIds = new Set(vectors.map((vector) => vector.element.id));
  const elementResults = compiled.elementResults.map((result) => vectorIds.has(result.elementId)
    ? { elementId: result.elementId, strategy: "vector" as const, warnings: ["Custom path exported as editable vector SVG media; DrawingML custom geometry is not emitted yet"] }
    : result);
  const warnings = [
    ...compiled.warnings.filter((warning) => !vectors.some((vector) => warning.includes(vector.element.id))),
    ...vectors.map((vector) => `Custom vector ${vector.element.id} exported as SVG media from canonical pathData/svgPath`),
  ];
  return { ...compiled, outputPath, elementResults, warnings, contentHash: createHash("sha256").update(buffer).digest("hex") };
}
