import type { CreativeRunAuditRecord } from "../../../packages/creative-director/src/audit.js";
import { PitchWorkspaceService } from "../../workspace/src/server.js";

export interface CreativeRunSummary {
  id: string;
  requestId: string;
  createdAt: string;
  branchId: string;
  inherited: boolean;
  effectiveMode: "currentBranch" | "previewBranch";
  actionCount: number;
  successfulActions: number;
  accepted?: boolean;
  error?: string;
  beforeScore: number;
  afterScore?: number;
}

export async function listCreativeRuns(service: PitchWorkspaceService, branchId?: string): Promise<CreativeRunSummary[]> {
  const manifest = await service.store.readManifest();
  const id = branchId ?? manifest.activeBranchId;
  const branch = manifest.branches[id];
  if (!branch) throw new Error(`Unknown branch ${id}`);
  const base = branch.baseHeads ?? {};
  const heads = Object.values(branch.heads).filter((head) => head.kind === "creativeRun");
  const summaries: CreativeRunSummary[] = [];
  for (const head of heads) {
    try {
      const record = (await service.store.read<CreativeRunAuditRecord>(head.id, head.version)).payload;
      summaries.push({
        id: record.id,
        requestId: record.requestId,
        createdAt: record.createdAt,
        branchId: id,
        inherited: Boolean(base[head.id] && base[head.id].version === head.version && base[head.id].contentHash === head.contentHash),
        effectiveMode: record.effectiveMode,
        actionCount: record.actions.length,
        successfulActions: record.traces.filter((trace) => trace.ok).length,
        accepted: record.accepted,
        error: record.error,
        beforeScore: record.plan.before.score,
        afterScore: record.review?.after.score,
      });
    } catch {}
  }
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readCreativeRun(service: PitchWorkspaceService, runId: string, branchId?: string): Promise<CreativeRunAuditRecord> {
  const manifest = await service.store.readManifest();
  const id = branchId ?? manifest.activeBranchId;
  const branch = manifest.branches[id];
  if (!branch) throw new Error(`Unknown branch ${id}`);
  const head = branch.heads[runId];
  if (!head || head.kind !== "creativeRun") throw new Error(`Creative run ${runId} is not present on branch ${id}`);
  return (await service.store.read<CreativeRunAuditRecord>(head.id, head.version)).payload;
}
