import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BranchArtifactHead, ProjectManifest } from "../../artifact-store/src/index.js";

interface ArtifactHistory {
  entries: BranchArtifactHead[];
  cursor: number;
}
interface JournalFile {
  schemaVersion: "0.1";
  branches: Record<string, Record<string, ArtifactHistory>>;
}

async function atomicJsonWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}
function sameHead(a?: BranchArtifactHead, b?: BranchArtifactHead): boolean {
  return Boolean(a && b && a.id === b.id && a.version === b.version && a.contentHash === b.contentHash);
}
function clone<T>(value: T): T { return structuredClone(value); }

export class VersionJournal {
  readonly root: string;
  constructor(root: string) { this.root = root; }
  private path(): string { return join(this.root, ".project", "version-journal.json"); }
  private manifestPath(): string { return join(this.root, ".project", "manifest.json"); }

  private async read(): Promise<JournalFile> {
    try { return JSON.parse(await readFile(this.path(), "utf8")) as JournalFile; }
    catch { return { schemaVersion: "0.1", branches: {} }; }
  }
  private async write(value: JournalFile): Promise<void> { await atomicJsonWrite(this.path(), value); }

  async record(branchId: string, head: BranchArtifactHead): Promise<void> {
    const journal = await this.read();
    journal.branches[branchId] ??= {};
    let history = journal.branches[branchId][head.id];
    if (!history) history = journal.branches[branchId][head.id] = { entries: [], cursor: -1 };
    const current = history.entries[history.cursor];
    if (sameHead(current, head)) return;
    history.entries = history.entries.slice(0, history.cursor + 1);
    history.entries.push(clone(head));
    history.cursor = history.entries.length - 1;
    await this.write(journal);
  }

  async fork(parentBranchId: string, newBranchId: string): Promise<void> {
    const journal = await this.read();
    const parent = journal.branches[parentBranchId] ?? {};
    const next: Record<string, ArtifactHistory> = {};
    for (const [artifactId, history] of Object.entries(parent)) {
      const entries = history.entries.slice(0, history.cursor + 1).map(clone);
      next[artifactId] = { entries, cursor: entries.length - 1 };
    }
    journal.branches[newBranchId] = next;
    await this.write(journal);
  }

  async forkFromHeads(newBranchId: string, heads: Record<string, BranchArtifactHead>): Promise<void> {
    const journal = await this.read();
    const next: Record<string, ArtifactHistory> = {};
    for (const [artifactId, head] of Object.entries(heads)) next[artifactId] = { entries: [clone(head)], cursor: 0 };
    journal.branches[newBranchId] = next;
    await this.write(journal);
  }

  async undo(branchId: string, artifactId: string): Promise<BranchArtifactHead> {
    return this.move(branchId, artifactId, -1);
  }
  async redo(branchId: string, artifactId: string): Promise<BranchArtifactHead> {
    return this.move(branchId, artifactId, 1);
  }

  private async move(branchId: string, artifactId: string, delta: -1 | 1): Promise<BranchArtifactHead> {
    const journal = await this.read();
    const history = journal.branches[branchId]?.[artifactId];
    if (!history) throw new Error(`No history for artifact ${artifactId} on branch ${branchId}`);
    const nextCursor = history.cursor + delta;
    if (nextCursor < 0) throw new Error(`Nothing to undo for artifact ${artifactId} on branch ${branchId}`);
    if (nextCursor >= history.entries.length) throw new Error(`Nothing to redo for artifact ${artifactId} on branch ${branchId}`);
    history.cursor = nextCursor;
    const head = clone(history.entries[nextCursor]);

    const manifest = JSON.parse(await readFile(this.manifestPath(), "utf8")) as ProjectManifest;
    const branch = manifest.branches[branchId];
    if (!branch) throw new Error(`Unknown branch: ${branchId}`);
    branch.heads[artifactId] = head;
    manifest.updatedAt = new Date().toISOString();
    await atomicJsonWrite(this.manifestPath(), manifest);
    await this.write(journal);
    return head;
  }

  async status(branchId: string, artifactId: string): Promise<{ canUndo: boolean; canRedo: boolean; depth: number; cursor: number }> {
    const journal = await this.read();
    const history = journal.branches[branchId]?.[artifactId];
    if (!history) return { canUndo: false, canRedo: false, depth: 0, cursor: -1 };
    return { canUndo: history.cursor > 0, canRedo: history.cursor < history.entries.length - 1, depth: history.entries.length, cursor: history.cursor };
  }
}
