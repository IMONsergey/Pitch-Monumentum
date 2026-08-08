import type { BranchArtifactHead, ProjectBranch } from "../../../packages/artifact-store/src/index.js";
import { CheckpointStore, type ProjectCheckpoint } from "../../../packages/checkpoints/src/index.js";
import type { DeckDocument } from "../../../packages/deck-model/src/index.js";
import { diffDecks } from "../../../packages/deck-diff/src/index.js";
import { deckHash as computeDeckHash } from "../../../packages/mutations/src/index.js";
import { PitchWorkspaceService } from "../../workspace/src/server.js";

export interface VersionBranchSummary {
  id: string;
  name: string;
  createdAt: string;
  parentBranchId?: string;
  active: boolean;
  baseTracked: boolean;
  artifactCount: number;
  deckHash?: string;
}

export interface VersionArtifactDiff {
  artifactId: string;
  kind: string;
  status: "added" | "removed" | "changed";
}

function sameHead(a?: BranchArtifactHead, b?: BranchArtifactHead): boolean {
  return Boolean(a && b && a.id === b.id && a.kind === b.kind && a.version === b.version && a.contentHash === b.contentHash);
}

function artifactDiff(before: Record<string, BranchArtifactHead>, after: Record<string, BranchArtifactHead>): VersionArtifactDiff[] {
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return ids.flatMap((id) => {
    const a = before[id]; const b = after[id];
    if (sameHead(a, b)) return [];
    return [{ artifactId: id, kind: b?.kind ?? a?.kind ?? "unknown", status: !a ? "added" as const : !b ? "removed" as const : "changed" as const }];
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.artifactId.localeCompare(b.artifactId));
}

function deckHead(branch: ProjectBranch): BranchArtifactHead | undefined {
  return Object.values(branch.heads).find((head) => head.kind === "deck");
}

export class VersionWorkspaceRuntime {
  readonly service: PitchWorkspaceService;
  readonly checkpoints: CheckpointStore;
  constructor(projectRoot: string) {
    this.service = new PitchWorkspaceService(projectRoot);
    this.checkpoints = new CheckpointStore(projectRoot);
  }

  private async branchDeck(branchId: string): Promise<{ branch: ProjectBranch; head: BranchArtifactHead; deck: DeckDocument; deckHash: string }> {
    const manifest = await this.service.store.readManifest();
    const branch = manifest.branches[branchId];
    if (!branch) throw new Error(`Unknown branch ${branchId}`);
    const head = deckHead(branch);
    if (!head) throw new Error(`Branch ${branchId} has no deck`);
    const stored = (await this.service.store.read<DeckDocument>(head.id, head.version)).payload;
    const deck = stored.activeBranchId === branch.id ? stored : { ...stored, activeBranchId: branch.id };
    return { branch, head, deck, deckHash: computeDeckHash(deck) };
  }

  async state() {
    const current = await this.service.state();
    const manifest = current.manifest;
    const branches: VersionBranchSummary[] = [];
    for (const branch of Object.values(manifest.branches)) {
      let hash: string | undefined;
      try { hash = (await this.branchDeck(branch.id)).deckHash; } catch {}
      branches.push({ id: branch.id, name: branch.name, createdAt: branch.createdAt, parentBranchId: branch.parentBranchId, active: branch.id === manifest.activeBranchId, baseTracked: Boolean(branch.baseHeads), artifactCount: Object.keys(branch.heads).length, deckHash: hash });
    }
    branches.sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt.localeCompare(a.createdAt));
    return { deckHash: current.deckHash, activeBranchId: manifest.activeBranchId, branches, checkpoints: await this.checkpoints.list() };
  }

  async createCheckpoint(name: string, description?: string): Promise<ProjectCheckpoint> {
    const current = await this.service.state();
    return this.checkpoints.create({ manifest: current.manifest, deckHash: current.deckHash, name, description });
  }

  async removeCheckpoint(checkpointId: string): Promise<void> {
    await this.checkpoints.remove(checkpointId);
  }

  async restoreCheckpoint(checkpointId: string, branchName?: string) {
    const checkpoint = await this.checkpoints.get(checkpointId);
    const manifest = await this.service.store.readManifest();
    if (!manifest.branches[checkpoint.sourceBranchId]) {
      throw new Error(`Checkpoint source branch no longer exists: ${checkpoint.sourceBranchId}`);
    }
    const newBranchId = await this.service.store.forkBranchFromSnapshot(
      branchName?.trim() || `Restore · ${checkpoint.name}`,
      checkpoint.heads,
      checkpoint.sourceBranchId,
    );
    await this.service.journal.forkFromHeads(newBranchId, checkpoint.heads);
    return { checkpoint, restoredBranchId: newBranchId, state: await this.service.state() };
  }

  async createBranch(name: string) {
    return this.service.fork(name);
  }

  async checkout(branchId: string) {
    return this.service.checkout(branchId);
  }

  async compareBranches(beforeBranchId: string, afterBranchId: string) {
    if (beforeBranchId === afterBranchId) throw new Error("Choose two different branches to compare");
    const before = await this.branchDeck(beforeBranchId);
    const after = await this.branchDeck(afterBranchId);
    return {
      before: { branchId: before.branch.id, name: before.branch.name, deckHash: before.deckHash },
      after: { branchId: after.branch.id, name: after.branch.name, deckHash: after.deckHash },
      artifactDiff: artifactDiff(before.branch.heads, after.branch.heads),
      deckDiff: diffDecks(before.deck, after.deck),
    };
  }

  async compareCheckpoint(checkpointId: string, branchId?: string) {
    const checkpoint = await this.checkpoints.get(checkpointId);
    const manifest = await this.service.store.readManifest();
    const targetId = branchId ?? manifest.activeBranchId;
    const target = await this.branchDeck(targetId);
    const checkpointDeckHead = Object.values(checkpoint.heads).find((head) => head.kind === "deck");
    if (!checkpointDeckHead) throw new Error(`Checkpoint ${checkpointId} has no deck head`);
    const stored = (await this.service.store.read<DeckDocument>(checkpointDeckHead.id, checkpointDeckHead.version)).payload;
    const checkpointDeck = stored.activeBranchId === checkpoint.sourceBranchId ? stored : { ...stored, activeBranchId: checkpoint.sourceBranchId };
    return {
      checkpoint: { id: checkpoint.id, name: checkpoint.name, createdAt: checkpoint.createdAt, deckHash: checkpoint.deckHash },
      target: { branchId: target.branch.id, name: target.branch.name, deckHash: target.deckHash },
      artifactDiff: artifactDiff(checkpoint.heads, target.branch.heads),
      deckDiff: diffDecks(checkpointDeck, target.deck),
    };
  }
}
