import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export interface FilesystemArtifactInspection {
  path: string;
  kind: "file" | "directory";
  bytes: number;
  fileCount: number;
  sha256: string;
}

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function directoryFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Delivery artifact packages cannot contain symbolic links: ${normalizedRelative(root, path)}`);
    if (entry.isDirectory()) files.push(...await directoryFiles(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported filesystem entry in delivery artifact: ${normalizedRelative(root, path)}`);
  }
  return files;
}

export async function inspectFilesystemArtifact(inputPath: string): Promise<FilesystemArtifactInspection> {
  const path = resolve(inputPath);
  const info = await stat(path);
  if (info.isFile()) {
    const bytes = await readFile(path);
    return { path, kind: "file", bytes: bytes.length, fileCount: 1, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  if (!info.isDirectory()) throw new Error(`Unsupported delivery artifact type: ${path}`);

  const hash = createHash("sha256");
  let bytes = 0;
  const files = await directoryFiles(path);
  for (const file of files) {
    const relativePath = normalizedRelative(path, file);
    const data = await readFile(file);
    bytes += data.length;
    const nameBytes = Buffer.from(relativePath, "utf8");
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(data.length));
    hash.update(Buffer.from([0x50, 0x49, 0x54, 0x43, 0x48]));
    hash.update(nameBytes);
    hash.update(Buffer.from([0]));
    hash.update(length);
    hash.update(data);
  }
  return { path, kind: "directory", bytes, fileCount: files.length, sha256: hash.digest("hex") };
}
