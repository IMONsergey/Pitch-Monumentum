import { inflateRawSync } from "node:zlib";

export interface ZipFileEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("ZIP end-of-central-directory record not found");
}

export function listZipEntries(buf: Buffer): ZipFileEntry[] {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  const entries: ZipFileEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Invalid ZIP central directory at ${cursor}`);
    const compression = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.push({ name, compression, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(buf: Buffer, entry: ZipFileEntry): Buffer {
  const offset = entry.localOffset;
  if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`Invalid ZIP local header for ${entry.name}`);
  const nameLength = buf.readUInt16LE(offset + 26);
  const extraLength = buf.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compression === 0) return Buffer.from(compressed);
  if (entry.compression === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression ${entry.compression} for ${entry.name}`);
}

export function readZipMap(buf: Buffer): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  for (const entry of listZipEntries(buf)) map.set(entry.name, readZipEntry(buf, entry));
  return map;
}
