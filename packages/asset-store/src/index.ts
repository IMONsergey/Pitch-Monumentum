import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { DeckDocument } from "../../deck-model/src/index.js";
import type { RichAsset } from "../../pptx-rich/src/index.js";

export type PitchAssetSource = "upload" | "import" | "generated" | "clipboard";
export type PitchAssetMime = "image/png" | "image/jpeg";

export interface PitchAssetMetadata {
  schemaVersion: "0.1";
  id: string;
  kind: "image";
  filename: string;
  mimeType: PitchAssetMime;
  extension: "png" | "jpg";
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
  source: PitchAssetSource;
  createdAt: string;
}

export interface ImportImageAssetInput {
  filename: string;
  mimeType: string;
  dataBase64: string;
  /** Client dimensions are accepted for protocol compatibility but canonical dimensions are decoded from image bytes. */
  width?: number;
  height?: number;
  source?: PitchAssetSource;
}

function supportedMime(value: string): value is PitchAssetMime {
  return value === "image/png" || value === "image/jpeg";
}

function extensionFor(mimeType: PitchAssetMime): "png" | "jpg" {
  return mimeType === "image/png" ? "png" : "jpg";
}

function safeName(value: string, extension: string): string {
  const base = value.trim().replace(/[^a-zA-Z0-9._ -]+/g, "_").replace(/^\.+/, "").slice(0, 160) || `image.${extension}`;
  const current = extname(base).toLowerCase();
  if (current === `.${extension}` || (extension === "jpg" && (current === ".jpeg" || current === ".jpg"))) return base;
  return `${base.replace(/\.[^.]+$/, "")}.${extension}`;
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized) throw new Error("Image asset is empty");
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error("Image asset contains invalid base64 data");
  const data = Buffer.from(normalized, "base64");
  if (!data.length) throw new Error("Image asset is empty");
  return data;
}

function decodePngDimensions(data: Buffer): { width: number; height: number } | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.length < 24 || !data.subarray(0, 8).equals(signature) || data.subarray(12, 16).toString("ascii") !== "IHDR") return undefined;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (!width || !height) throw new Error("PNG has invalid dimensions");
  return { width, height };
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function decodeJpegDimensions(data: Buffer): { width: number; height: number } | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) break;
    const marker = data[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= data.length) break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) throw new Error("JPEG has an invalid segment length");
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) throw new Error("JPEG SOF segment is invalid");
      const height = data.readUInt16BE(offset + 3);
      const width = data.readUInt16BE(offset + 5);
      if (!width || !height) throw new Error("JPEG has invalid dimensions");
      return { width, height };
    }
    offset += length;
  }
  throw new Error("JPEG dimensions could not be decoded");
}

function validateImageBytes(data: Buffer, claimedMime: PitchAssetMime): { mimeType: PitchAssetMime; width: number; height: number } {
  const png = decodePngDimensions(data);
  if (png) {
    if (claimedMime !== "image/png") throw new Error(`Image bytes are PNG but mimeType is ${claimedMime}`);
    return { mimeType: "image/png", ...png };
  }
  const jpeg = decodeJpegDimensions(data);
  if (jpeg) {
    if (claimedMime !== "image/jpeg") throw new Error(`Image bytes are JPEG but mimeType is ${claimedMime}`);
    return { mimeType: "image/jpeg", ...jpeg };
  }
  throw new Error("Image bytes are not a valid PNG or JPEG");
}

function sceneAssetReferences(deck: DeckDocument, assetId: string): string[] {
  const references: string[] = [];
  for (const slide of deck.slides) for (const element of slide.scene) {
    if ((element.type === "image" || element.type === "icon" || element.type === "video") && element.assetId === assetId) references.push(`${slide.id}:${element.id}`);
    if (element.type === "video" && element.posterAssetId === assetId) references.push(`${slide.id}:${element.id}:poster`);
  }
  return references;
}

export class ProjectAssetStore {
  readonly root: string;
  constructor(root: string) { this.root = root; }

  private baseDir(): string { return join(this.root, ".project", "assets"); }
  private assetDir(id: string): string { return join(this.baseDir(), id); }
  private metadataPath(id: string): string { return join(this.assetDir(id), "asset.json"); }

  async importImage(input: ImportImageAssetInput): Promise<PitchAssetMetadata> {
    if (!supportedMime(input.mimeType)) throw new Error(`Unsupported image type: ${input.mimeType}. Pitch Desktop Preview currently accepts PNG and JPEG.`);
    const data = decodeBase64(input.dataBase64);
    if (data.length > 40 * 1024 * 1024) throw new Error("Image asset exceeds the 40 MB preview limit");
    const decoded = validateImageBytes(data, input.mimeType);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const extension = extensionFor(decoded.mimeType);
    const id = `asset_${sha256.slice(0, 20)}`;
    const dir = this.assetDir(id);
    const existing = await this.read(id).catch(() => undefined);
    if (existing) return existing;
    await mkdir(dir, { recursive: true });
    const filename = safeName(input.filename, extension);
    const metadata: PitchAssetMetadata = {
      schemaVersion: "0.1",
      id,
      kind: "image",
      filename,
      mimeType: decoded.mimeType,
      extension,
      bytes: data.length,
      sha256,
      width: decoded.width,
      height: decoded.height,
      source: input.source ?? "upload",
      createdAt: new Date().toISOString(),
    };
    await writeFile(join(dir, `original.${extension}`), data);
    await writeFile(this.metadataPath(id), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    return metadata;
  }

  async read(id: string): Promise<PitchAssetMetadata> {
    if (!/^asset_[a-f0-9]{20}$/i.test(id)) throw new Error(`Invalid asset id: ${id}`);
    return JSON.parse(await readFile(this.metadataPath(id), "utf8")) as PitchAssetMetadata;
  }

  async list(): Promise<PitchAssetMetadata[]> {
    let ids: string[];
    try { ids = await readdir(this.baseDir()); } catch { return []; }
    const result: PitchAssetMetadata[] = [];
    for (const id of ids) {
      try { result.push(await this.read(id)); } catch {}
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async content(id: string): Promise<{ metadata: PitchAssetMetadata; path: string }> {
    const metadata = await this.read(id);
    const path = join(this.assetDir(id), `original.${metadata.extension}`);
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Asset content is missing: ${id}`);
    return { metadata, path };
  }

  async remove(id: string, deck?: DeckDocument): Promise<void> {
    if (deck) {
      const references = sceneAssetReferences(deck, id);
      if (references.length) throw new Error(`Asset ${id} is still used by ${references.length} scene object reference(s)`);
    }
    await rm(this.assetDir(id), { recursive: true, force: true });
  }

  async richAssetMapForDeck(deck: DeckDocument): Promise<Record<string, RichAsset>> {
    const ids = new Set<string>();
    for (const slide of deck.slides) for (const element of slide.scene) {
      if (element.type === "image") ids.add(element.assetId);
    }
    const result: Record<string, RichAsset> = {};
    for (const id of ids) {
      try {
        const { metadata, path } = await this.content(id);
        result[id] = { path, mimeType: metadata.mimeType, width: metadata.width, height: metadata.height };
      } catch (error) {
        throw new Error(`Deck references missing or unreadable image asset ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result;
  }

  async usage(deck: DeckDocument): Promise<Record<string, number>> {
    const usage: Record<string, number> = {};
    for (const slide of deck.slides) for (const element of slide.scene) {
      if (element.type === "image" || element.type === "icon" || element.type === "video") usage[element.assetId] = (usage[element.assetId] ?? 0) + 1;
      if (element.type === "video" && element.posterAssetId) usage[element.posterAssetId] = (usage[element.posterAssetId] ?? 0) + 1;
    }
    return usage;
  }
}

export function newAssetRequestId(): string { return `asset_request_${randomUUID()}`; }
