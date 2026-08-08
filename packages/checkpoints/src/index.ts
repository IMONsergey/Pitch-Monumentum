import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BranchArtifactHead, ProjectManifest } from "../../artifact-store/src/index.js";

export interface ProjectCheckpoint {
  schemaVersion: "0.1";
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  sourceBranchId: string;
  sourceBranchName: string;
  deckHash: string;
  heads: Record<string, BranchArtifactHead>;
}

interface CheckpointFile {
  schemaVersion: "0.1";
  checkpoints: ProjectCheckpoint[];
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export class CheckpointStore {
  readonly root: string;
  constructor(root: string) { this.root = root; }
  private path(): string { return join(this.root, ".project", "checkpoints.json"); }

  private async readFile(): Promise<CheckpointFile> {
    try {
      const value = JSON.parse(await readFile(this.path(), "utf8")) as CheckpointFile;
      return value?.schemaVersion === "0.1" && Array.isArray(value.checkpoints) ? value : { schemaVersion: "0.1", checkpoints: [] };
    } catch {
      return { schemaVersion: "0.1", checkpoints: [] };
    }
  }

  async list(): Promise<ProjectCheckpoint[]> {
    return (await this.readFile()).checkpoints.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((checkpoint) => structuredClone(checkpoint));
  }

  async get(id: string): Promise<ProjectCheckpoint> {
    const checkpoint = (await this.readFile()).checkpoints.find((item) => item.id === id);
    if (!checkpoint) throw new Error(`Unknown checkpoint ${id}`);
    return structuredClone(checkpoint);
  }

  async create(input: { manifest: ProjectManifest; deckHash: string; name: string; description?: string; checkpointId?: string }): Promise<ProjectCheckpoint> {
    if (!input.name.trim()) throw new Error("Checkpoint name is required");
    if (!input.deckHash.trim()) throw new Error("Checkpoint deckHash is required");
    const branch = input.manifest.branches[input.manifest.activeBranchId];
    if (!branch) throw new Error(`Unknown active branch ${input.manifest.activeBranchId}`);
    const file = await this.readFile();
    const id = input.checkpointId?.trim() || `checkpoint_${randomUUID()}`;
    if (file.checkpoints.some((checkpoint) => checkpoint.id === id)) throw new Error(`Checkpoint id already exists: ${id}`);
    const checkpoint: ProjectCheckpoint = {
      schemaVersion: "0.1",
      id,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      createdAt: new Date().toISOString(),
      sourceBranchId: branch.id,
      sourceBranchName: branch.name,
      deckHash: input.deckHash,
      heads: structuredClone(branch.heads),
    };
    file.checkpoints.push(checkpoint);
    await atomicWrite(this.path(), file);
    return structuredClone(checkpoint);
  }

  async remove(id: string): Promise<void> {
    const file = await this.readFile();
    const next = file.checkpoints.filter((checkpoint) => checkpoint.id !== id);
    if (next.length === file.checkpoints.length) throw new Error(`Unknown checkpoint ${id}`);
    file.checkpoints = next;
    await atomicWrite(this.path(), file);
  }
}
