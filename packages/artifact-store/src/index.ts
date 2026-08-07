import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stableStringify, type ArtifactEnvelope, type ArtifactProducer, type ArtifactRef, type ArtifactStatus } from "../../shared/src/index.js";

export interface BranchArtifactHead extends ArtifactRef { status: ArtifactStatus; }
export interface ProjectBranch {
  id: string;
  name: string;
  parentBranchId?: string;
  createdAt: string;
  heads: Record<string, BranchArtifactHead>;
}
export interface ProjectManifest {
  schemaVersion: "0.1";
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeBranchId: string;
  branches: Record<string, ProjectBranch>;
  artifacts: Record<string, { kind: string; latestVersion: number; latestHash: string; status: ArtifactStatus }>;
}

export interface WriteArtifactInput<T> {
  id?: string;
  kind: string;
  payload: T;
  producer: ArtifactProducer;
  inputs?: ArtifactRef[];
  status?: ArtifactStatus;
  schemaVersion?: string;
}

async function atomicJsonWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export class ArtifactStore {
  readonly root: string;
  constructor(root: string) { this.root = root; }
  private manifestPath(): string { return join(this.root, ".project", "manifest.json"); }
  private artifactPath(kind: string, id: string, version: number): string {
    return join(this.root, ".project", "artifacts", kind, id, `v${String(version).padStart(4, "0")}.json`);
  }

  async init(name: string, projectId = `project_${randomUUID()}`): Promise<ProjectManifest> {
    try { return await this.readManifest(); } catch {}
    const now = new Date().toISOString();
    const branchId = "branch_main";
    const manifest: ProjectManifest = {
      schemaVersion: "0.1", projectId, name, createdAt: now, updatedAt: now, activeBranchId: branchId,
      branches: { [branchId]: { id: branchId, name: "main", createdAt: now, heads: {} } }, artifacts: {}
    };
    await atomicJsonWrite(this.manifestPath(), manifest);
    return manifest;
  }

  private migrate(raw:any):ProjectManifest {
    for(const branch of Object.values(raw.branches ?? {}) as any[]){
      if(!branch.heads){
        branch.heads={};
        for(const id of branch.headArtifactIds ?? []){
          const meta=raw.artifacts?.[id]; if(meta) branch.heads[id]={id,kind:meta.kind,version:meta.latestVersion,contentHash:meta.latestHash,status:meta.status};
        }
        delete branch.headArtifactIds;
      }
    }
    return raw as ProjectManifest;
  }

  async readManifest(): Promise<ProjectManifest> {
    return this.migrate(JSON.parse(await readFile(this.manifestPath(), "utf8")));
  }

  async write<T>(input: WriteArtifactInput<T>): Promise<ArtifactEnvelope<T>> {
    const manifest = await this.readManifest();
    const id = input.id ?? `${input.kind}_${randomUUID()}`;
    const existing = manifest.artifacts[id];
    const version = existing ? existing.latestVersion + 1 : 1;
    const contentHash = createHash("sha256").update(stableStringify(input.payload)).digest("hex");
    const envelope: ArtifactEnvelope<T> = {
      id, kind: input.kind, schemaVersion: input.schemaVersion ?? "0.1", version, contentHash,
      createdAt: new Date().toISOString(), producer: input.producer, inputs: input.inputs ?? [], status: input.status ?? "ready", payload: input.payload
    };
    await atomicJsonWrite(this.artifactPath(input.kind, id, version), envelope);
    manifest.artifacts[id] = { kind: input.kind, latestVersion: version, latestHash: contentHash, status: envelope.status };
    const branch = manifest.branches[manifest.activeBranchId];
    branch.heads[id] = { id, kind: input.kind, version, contentHash, status: envelope.status };
    manifest.updatedAt = new Date().toISOString();
    await atomicJsonWrite(this.manifestPath(), manifest);
    return envelope;
  }

  async read<T>(id: string, version?: number): Promise<ArtifactEnvelope<T>> {
    const manifest = await this.readManifest();
    const meta = manifest.artifacts[id];
    if (!meta) throw new Error(`Unknown artifact: ${id}`);
    const branchHead = manifest.branches[manifest.activeBranchId]?.heads[id];
    const targetVersion = version ?? branchHead?.version ?? meta.latestVersion;
    return JSON.parse(await readFile(this.artifactPath(meta.kind, id, targetVersion), "utf8")) as ArtifactEnvelope<T>;
  }

  async getHead(id:string,branchId?:string):Promise<BranchArtifactHead|undefined>{
    const manifest=await this.readManifest(); return manifest.branches[branchId??manifest.activeBranchId]?.heads[id];
  }

  async setStatus(id: string, status: ArtifactStatus, producer:ArtifactProducer={type:"deterministic"}): Promise<ArtifactEnvelope<unknown>> {
    const current=await this.read<unknown>(id);
    return this.write({id,kind:current.kind,payload:current.payload,producer,inputs:current.inputs,status,schemaVersion:current.schemaVersion});
  }

  async forkBranch(name: string, parentBranchId?: string): Promise<string> {
    const manifest = await this.readManifest();
    const parentId = parentBranchId ?? manifest.activeBranchId;
    const parent = manifest.branches[parentId];
    if (!parent) throw new Error(`Unknown parent branch: ${parentId}`);
    const id = `branch_${randomUUID()}`;
    manifest.branches[id] = { id, name, parentBranchId: parentId, createdAt: new Date().toISOString(), heads: structuredClone(parent.heads) };
    manifest.activeBranchId = id;
    manifest.updatedAt = new Date().toISOString();
    await atomicJsonWrite(this.manifestPath(), manifest);
    return id;
  }

  async checkoutBranch(branchId:string):Promise<void>{
    const manifest=await this.readManifest(); if(!manifest.branches[branchId])throw new Error(`Unknown branch: ${branchId}`);manifest.activeBranchId=branchId;manifest.updatedAt=new Date().toISOString();await atomicJsonWrite(this.manifestPath(),manifest);
  }
}
