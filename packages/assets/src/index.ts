import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

export type ImageMimeType = "image/png" | "image/jpeg";
export type AssetSourceKind = "import" | "generated" | "clipboard" | "web";

export interface AssetProvenance {
  source: AssetSourceKind;
  label?: string;
  prompt?: string;
  model?: string;
  sourceUrl?: string;
  requestId?: string;
}

export interface ImageAssetRecord {
  id: string;
  kind: "image";
  contentHash: string;
  mimeType: ImageMimeType;
  originalName: string;
  byteLength: number;
  width: number;
  height: number;
  relativePath: string;
  createdAt: string;
  provenance: AssetProvenance[];
}

export interface AssetIndex {
  schemaVersion: "0.1";
  assets: Record<string, ImageAssetRecord>;
}

export interface RegisterImageInput {
  bytes: Buffer;
  originalName: string;
  mimeType?: ImageMimeType;
  provenance: AssetProvenance;
}

export interface RichAssetReference {
  path: string;
  mimeType: ImageMimeType;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof && length >= 7) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function detectMime(bytes: Buffer, fileName: string, requested?: ImageMimeType): ImageMimeType {
  if (requested) return requested;
  if (pngDimensions(bytes)) return "image/png";
  if (jpegDimensions(bytes)) return "image/jpeg";
  const extension = extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  throw new Error("Only PNG and JPEG assets are supported");
}

function imageDimensions(bytes: Buffer, mimeType: ImageMimeType): { width: number; height: number } {
  const result = mimeType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (!result || result.width <= 0 || result.height <= 0) throw new Error(`Invalid ${mimeType} image bytes`);
  return result;
}

function extensionFor(mimeType: ImageMimeType): string {
  return mimeType === "image/png" ? "png" : "jpg";
}

function sameProvenance(a: AssetProvenance, b: AssetProvenance): boolean {
  return a.source === b.source
    && a.label === b.label
    && a.prompt === b.prompt
    && a.model === b.model
    && a.sourceUrl === b.sourceUrl
    && a.requestId === b.requestId;
}

export class AssetRegistry {
  readonly projectRoot: string;
  readonly assetsRoot: string;
  readonly blobsRoot: string;
  readonly indexPath: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.assetsRoot = join(this.projectRoot, ".project", "assets");
    this.blobsRoot = join(this.assetsRoot, "blobs");
    this.indexPath = join(this.assetsRoot, "index.json");
  }

  async init(): Promise<void> {
    await mkdir(this.blobsRoot, { recursive: true });
    try {
      await stat(this.indexPath);
    } catch {
      await this.writeIndex({ schemaVersion: "0.1", assets: {} });
    }
  }

  async readIndex(): Promise<AssetIndex> {
    await this.init();
    const parsed = JSON.parse(await readFile(this.indexPath, "utf8")) as AssetIndex;
    if (parsed.schemaVersion !== "0.1" || !parsed.assets || typeof parsed.assets !== "object") {
      throw new Error("Invalid Pitch asset registry index");
    }
    return parsed;
  }

  private async writeIndex(index: AssetIndex): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true });
    const temp = `${this.indexPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await rename(temp, this.indexPath);
  }

  async registerImage(input: RegisterImageInput): Promise<ImageAssetRecord> {
    if (!input.bytes.length) throw new Error("Cannot register an empty image asset");
    const mimeType = detectMime(input.bytes, input.originalName, input.mimeType);
    const dimensions = imageDimensions(input.bytes, mimeType);
    const contentHash = sha256(input.bytes);
    const id = `asset_sha256_${contentHash}`;
    const relativePath = join("blobs", `${contentHash}.${extensionFor(mimeType)}`);
    const absolutePath = join(this.assetsRoot, relativePath);
    const index = await this.readIndex();
    const existing = index.assets[id];

    if (existing) {
      const onDisk = await readFile(join(this.assetsRoot, existing.relativePath));
      if (!onDisk.equals(input.bytes)) throw new Error(`Asset hash collision for ${id}`);
      if (!existing.provenance.some((item) => sameProvenance(item, input.provenance))) {
        existing.provenance.push(input.provenance);
        await this.writeIndex(index);
      }
      return existing;
    }

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.bytes);
    const written = await readFile(absolutePath);
    if (!written.equals(input.bytes)) throw new Error(`Asset integrity verification failed for ${id}`);

    const record: ImageAssetRecord = {
      id,
      kind: "image",
      contentHash,
      mimeType,
      originalName: input.originalName,
      byteLength: input.bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      relativePath,
      createdAt: new Date().toISOString(),
      provenance: [input.provenance],
    };
    index.assets[id] = record;
    await this.writeIndex(index);
    return record;
  }

  async get(assetId: string): Promise<ImageAssetRecord> {
    const record = (await this.readIndex()).assets[assetId];
    if (!record) throw new Error(`Unknown asset: ${assetId}`);
    return record;
  }

  async list(): Promise<ImageAssetRecord[]> {
    const index = await this.readIndex();
    return Object.values(index.assets).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async readBytes(assetId: string): Promise<Buffer> {
    const record = await this.get(assetId);
    const bytes = await readFile(join(this.assetsRoot, record.relativePath));
    if (sha256(bytes) !== record.contentHash) throw new Error(`Asset integrity mismatch: ${assetId}`);
    return bytes;
  }

  async absolutePath(assetId: string): Promise<string> {
    const record = await this.get(assetId);
    return join(this.assetsRoot, record.relativePath);
  }

  async resolveRichAssets(assetIds?: Iterable<string>): Promise<Record<string, RichAssetReference>> {
    const index = await this.readIndex();
    const requested = assetIds ? new Set(assetIds) : null;
    const result: Record<string, RichAssetReference> = {};
    for (const record of Object.values(index.assets)) {
      if (requested && !requested.has(record.id)) continue;
      result[record.id] = { path: join(this.assetsRoot, record.relativePath), mimeType: record.mimeType };
    }
    if (requested) {
      for (const id of requested) if (!result[id]) throw new Error(`Unknown asset: ${id}`);
    }
    return result;
  }
}
