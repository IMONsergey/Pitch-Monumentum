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

function positiveDimension(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) throw new Error("Asset dimensions must be positive finite numbers");
  return Math.round(value);
}

export class ProjectAssetStore {
  readonly root: string;
  constructor(root: string) { this.root = root; }

  private baseDir(): string { return join(this.root, ".project", "assets"); }
  private assetDir(id: string): string { return join(this.baseDir(), id); }
  private metadataPath(id: string): string { return join(this.assetDir(id), "asset.json"); }

  async importImage(input: ImportImageAssetInput): Promise<PitchAssetMetadata> {
    if (!supportedMime(input.mimeType)) throw new Error(`Unsupported image type: ${input.mimeType}. Pitch Desktop Preview currently accepts PNG and JPEG.`);
    const data = Buffer.from(input.dataBase64, "base64");
    if (!data.length) throw new Error("Image asset is empty");
    if (data.length > 40 * 1024 * 1024) throw new Error("Image asset exceeds the 40 MB preview limit");
    const sha256 = createHash("sha256").update(data).digest("hex");
    const extension = extensionFor(input.mimeType);
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
      mimeType: input.mimeType,
      extension,
      bytes: data.length,
      sha256,
      width: positiveDimension(input.width),
      height: positiveDimension(input.height),
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
      const references = deck.slides.flatMap(slide => slide.scene.filter(element =>
        (element.type === "image" || element.type === "icon" || element.type === "video") && element.assetId === id,
      ).map(element => `${slide.id}:${element.id}`));
      if (references.length) throw new Error(`Asset ${id} is still used by ${references.length} scene object(s)`);
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
        result[id] = { path, mimeType: metadata.mimeType };
      } catch {}
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
