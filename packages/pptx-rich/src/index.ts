import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import type {
  DeckDocument,
  FrameElement,
  ImageElement,
  ShapeElement,
  TableElement,
} from "../../deck-model/src/index.js";
import {
  containGeometryForImage,
  coverCropForImage,
  cropToPercent,
  effectiveImageClipShape,
  normalizedImageCrop,
} from "../../image-layout/src/index.js";
import { compileDeckToPptx, type PptxCompileResult } from "../../pptx/src/index.js";

export interface RichAsset {
  path: string;
  mimeType?: "image/png" | "image/jpeg";
  width?: number;
  height?: number;
}

export type RichAssetMap = Record<string, RichAsset>;

export interface RichCompileOptions {
  assets: RichAssetMap;
}

export interface RichPptxCompileResult extends PptxCompileResult {
  richElementResults: Array<{
    elementId: string;
    strategy: "native";
    kind: "image" | "table" | "frame";
    warnings: string[];
  }>;
}

const DU_TO_EMU = 914400 / 144;

function emu(value: number): number {
  return Math.round(value * DU_TO_EMU);
}

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function u16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function u32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function readZip(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (u32(buffer, index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP EOCD not found");

  const count = u16(buffer, eocd + 10);
  let offset = u32(buffer, eocd + 16);
  const result = new Map<string, Buffer>();

  for (let index = 0; index < count; index += 1) {
    if (u32(buffer, offset) !== 0x02014b50) throw new Error("Invalid ZIP central directory");
    const method = u16(buffer, offset + 10);
    const compressedSize = u32(buffer, offset + 20);
    const nameLength = u16(buffer, offset + 28);
    const extraLength = u16(buffer, offset + 30);
    const commentLength = u16(buffer, offset + 32);
    const localOffset = u32(buffer, offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    if (u32(buffer, localOffset) !== 0x04034b50) throw new Error(`Invalid local ZIP header ${name}`);
    const localNameLength = u16(buffer, localOffset + 26);
    const localExtraLength = u16(buffer, localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);

    if (method === 0) result.set(name, Buffer.from(compressed));
    else if (method === 8) result.set(name, inflateRawSync(compressed));
    else throw new Error(`Unsupported ZIP compression ${method}`);

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

let crcTable: Uint32Array | undefined;
function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeZip(entries: Map<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBuffer = Buffer.from(name);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += 30 + nameBuffer.length + data.length;
  }

  const centralData = Buffer.concat(centrals);
  const localData = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.size, 8);
  eocd.writeUInt16LE(entries.size, 10);
  eocd.writeUInt32LE(centralData.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localData, centralData, eocd]);
}

function ensureContentType(content: string, extension: string, mime: string): string {
  if (new RegExp(`<Default[^>]+Extension=[\"']${extension}[\"']`, "i").test(content)) return content;
  return content.replace("</Types>", `<Default Extension="${extension}" ContentType="${mime}"/></Types>`);
}

function relationshipsRoot(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
}

function addImageRelationship(rels: string, id: string, target: string): string {
  return rels.replace(
    "</Relationships>",
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${xml(target)}"/></Relationships>`,
  );
}

function dimensions(asset: RichAsset): { width: number; height: number } | undefined {
  if (!Number.isFinite(asset.width) || !Number.isFinite(asset.height) || (asset.width ?? 0) <= 0 || (asset.height ?? 0) <= 0) return undefined;
  return { width: asset.width!, height: asset.height! };
}

function cropRect(image: ImageElement, asset: RichAsset): string {
  const size = dimensions(asset);
  const crop = size && image.fit === "cover" ? coverCropForImage(image, size) : normalizedImageCrop(image.crop);
  if (crop.left <= 0 && crop.top <= 0 && crop.right <= 0 && crop.bottom <= 0) return "";
  const percent = cropToPercent(crop);
  return `<a:srcRect l="${percent.left}" t="${percent.top}" r="${percent.right}" b="${percent.bottom}"/>`;
}

function pictureGeometry(image: ImageElement, asset: RichAsset) {
  const size = dimensions(asset);
  return size ? containGeometryForImage(image, size) : image.geometry;
}

function picturePreset(image: ImageElement): "rect" | "roundRect" | "ellipse" {
  return effectiveImageClipShape(image);
}

function pictureXml(image: ImageElement, asset: RichAsset, relationshipId: string, shapeId: number, name: string): string {
  const geometry = pictureGeometry(image, asset);
  const preset = picturePreset(image);
  return `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId}" name="${xml(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relationshipId}"/>${cropRect(image, asset)}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(geometry.x)}" y="${emu(geometry.y)}"/><a:ext cx="${emu(geometry.width)}" cy="${emu(geometry.height)}"/></a:xfrm><a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function imageWarnings(image: ImageElement, asset: RichAsset): string[] {
  const warnings: string[] = [];
  if (!dimensions(asset) && (image.fit !== "stretch" || image.focalPoint)) warnings.push("Asset dimensions are unavailable; PowerPoint fit/focal fidelity may be approximate");
  if (picturePreset(image) === "roundRect" && (image.cornerRadiusDU ?? 0) > 0) warnings.push("PowerPoint uses a native roundRect preset; exact authored image corner radius is approximate");
  return warnings;
}

function cellXml(text: string): string {
  return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${xml(text)}</a:t></a:r><a:endParaRPr lang="en-US" sz="1800"/></a:p></a:txBody><a:tcPr/></a:tc>`;
}

function tableXml(table: TableElement, shapeId: number): string {
  const geometry = table.geometry;
  const rows = table.rows.length || 1;
  const columns = Math.max(1, ...table.rows.map((row) => row.length));
  const widths = table.columnWidths?.length === columns
    ? table.columnWidths
    : Array.from({ length: columns }, () => 1 / columns);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) || 1;
  const gridXml = widths.map((width) => `<a:gridCol w="${Math.round(emu(geometry.width) * (width / totalWidth))}"/>`).join("");
  const rowHeight = Math.round(emu(geometry.height) / rows);
  const rowsXml = table.rows.map((row) => `<a:tr h="${rowHeight}">${Array.from({ length: columns }, (_, index) => cellXml(row[index]?.text ?? "")).join("")}</a:tr>`).join("");
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="${xml(table.name || table.id)}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(geometry.x)}" y="${emu(geometry.y)}"/><a:ext cx="${emu(geometry.width)}" cy="${emu(geometry.height)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid>${gridXml}</a:tblGrid>${rowsXml}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function injectIntoShapeTree(slideXml: string, fragment: string): string {
  if (!slideXml.includes("</p:spTree>")) throw new Error("Slide spTree not found");
  return slideXml.replace("</p:spTree>", `${fragment}</p:spTree>`);
}

function mimeFor(asset: RichAsset): { mime: string; extension: string } {
  if (asset.mimeType === "image/png") return { mime: "image/png", extension: "png" };
  if (asset.mimeType === "image/jpeg") return { mime: "image/jpeg", extension: "jpg" };
  const extension = extname(asset.path).toLowerCase();
  if (extension === ".png") return { mime: "image/png", extension: "png" };
  if (extension === ".jpg" || extension === ".jpeg") return { mime: "image/jpeg", extension: "jpg" };
  throw new Error(`Unsupported image asset: ${asset.path}`);
}

function frameAsShape(frame: FrameElement): ShapeElement | null {
  if (!frame.fill && !frame.stroke) return null;
  return {
    id: frame.id,
    type: "shape",
    name: frame.name,
    semanticRole: frame.semanticRole,
    geometry: frame.geometry,
    zIndex: frame.zIndex,
    locked: frame.locked,
    groupId: frame.groupId,
    layoutItem: frame.layoutItem,
    opacity: frame.opacity,
    origin: frame.origin,
    exportStrategy: "native",
    dependencies: frame.dependencies,
    tags: frame.tags,
    shape: frame.radiusDU ? "roundRect" : "rect",
    fill: frame.fill,
    stroke: frame.stroke,
    radiusDU: frame.radiusDU,
  };
}

export async function compileRichDeckToPptx(
  deck: DeckDocument,
  outputPath: string,
  options: RichCompileOptions,
): Promise<RichPptxCompileResult> {
  const basePath = `${outputPath}.base-${Date.now()}.pptx`;
  const richBySlide = deck.slides.map((slide) => slide.scene.filter(
    (element): element is ImageElement | TableElement => element.type === "image" || element.type === "table",
  ));
  const structuralFrames = deck.slides.flatMap((slide) => slide.scene.filter(
    (element): element is FrameElement => element.type === "frame" && !element.fill && !element.stroke,
  ));

  const baseDeck: DeckDocument = {
    ...deck,
    slides: deck.slides.map((slide) => ({
      ...slide,
      scene: slide.scene.flatMap((element) => {
        if (element.type === "image" || element.type === "table") return [];
        if (element.type === "frame") {
          const shape = frameAsShape(element);
          return shape ? [shape] : [];
        }
        return [element];
      }),
    })),
  };

  const base = await compileDeckToPptx(baseDeck, basePath);
  const entries = readZip(await readFile(basePath));
  let contentTypes = entries.get("[Content_Types].xml")?.toString("utf8") ?? "";
  const richElementResults: RichPptxCompileResult["richElementResults"] = structuralFrames.map((frame) => ({
    elementId: frame.id,
    strategy: "native",
    kind: "frame",
    warnings: ["Structural auto-layout frame flattened to absolute child geometry for PowerPoint"],
  }));
  let mediaIndex = 1;

  for (let slideIndex = 0; slideIndex < deck.slides.length; slideIndex += 1) {
    const richElements = richBySlide[slideIndex];
    if (!richElements.length) continue;

    const slidePath = `ppt/slides/slide${slideIndex + 1}.xml`;
    const relsPath = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
    let slideXml = entries.get(slidePath)?.toString("utf8");
    if (!slideXml) throw new Error(`Missing ${slidePath}`);
    let relationships = entries.get(relsPath)?.toString("utf8") ?? relationshipsRoot();
    let relationshipIndex = 100;

    for (const element of richElements) {
      if (element.type === "image") {
        const asset = options.assets[element.assetId];
        if (!asset) throw new Error(`Missing image asset ${element.assetId}`);
        const { mime, extension } = mimeFor(asset);
        const mediaName = `image${mediaIndex++}.${extension}`;
        const mediaPath = `ppt/media/${mediaName}`;
        const relationshipId = `rIdRich${relationshipIndex++}`;
        entries.set(mediaPath, await readFile(asset.path));
        contentTypes = ensureContentType(contentTypes, extension, mime);
        relationships = addImageRelationship(relationships, relationshipId, `../media/${mediaName}`);
        slideXml = injectIntoShapeTree(slideXml, pictureXml(element, asset, relationshipId, 2000 + relationshipIndex, element.name || element.id));
        richElementResults.push({ elementId: element.id, strategy: "native", kind: "image", warnings: imageWarnings(element, asset) });
      } else {
        slideXml = injectIntoShapeTree(slideXml, tableXml(element, 3000 + relationshipIndex++));
        richElementResults.push({ elementId: element.id, strategy: "native", kind: "table", warnings: [] });
      }
    }

    entries.set(slidePath, Buffer.from(slideXml, "utf8"));
    entries.set(relsPath, Buffer.from(relationships, "utf8"));
  }

  entries.set("[Content_Types].xml", Buffer.from(contentTypes, "utf8"));
  const output = writeZip(entries);
  await writeFile(outputPath, output);
  await rm(basePath, { force: true });

  return {
    ...base,
    outputPath,
    contentHash: createHash("sha256").update(output).digest("hex"),
    elementResults: [
      ...base.elementResults,
      ...richElementResults.map((result) => ({
        elementId: result.elementId,
        strategy: result.strategy,
        warnings: result.warnings,
      })),
    ],
    richElementResults,
  };
}
