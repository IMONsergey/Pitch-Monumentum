import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArtifactStore, type BranchArtifactHead, type ProjectManifest } from "../../artifact-store/src/index.js";
import { stableStringify, type ArtifactEnvelope, type ArtifactRef } from "../../shared/src/index.js";

export type ProjectDoctorSeverity = "info" | "warning" | "blocker";
export type ProjectDoctorCode =
  | "manifest-active-branch-missing"
  | "branch-parent-missing"
  | "branch-parent-cycle"
  | "branch-name-duplicate"
  | "branch-multiple-deck-heads"
  | "head-artifact-missing"
  | "head-envelope-mismatch"
  | "head-content-hash-mismatch"
  | "manifest-latest-artifact-missing"
  | "manifest-latest-hash-mismatch"
  | "input-artifact-missing"
  | "input-content-hash-mismatch"
  | "base-head-artifact-missing"
  | "journal-branch-missing"
  | "journal-artifact-missing"
  | "journal-head-missing"
  | "journal-head-hash-mismatch"
  | "journal-cursor-invalid"
  | "journal-json-invalid";

export interface ProjectDoctorIssue {
  code: ProjectDoctorCode;
  severity: ProjectDoctorSeverity;
  message: string;
  branchId?: string;
  artifactId?: string;
  version?: number;
  details?: Record<string, unknown>;
}

export interface ProjectDoctorReport {
  schemaVersion: "0.1";
  checkedAt: string;
  projectRoot: string;
  projectId?: string;
  activeBranchId?: string;
  branchCount: number;
  artifactCount: number;
  checkedHeads: number;
  checkedInputs: number;
  checkedJournalEntries: number;
  issues: ProjectDoctorIssue[];
  summary: {
    blocker: number;
    warning: number;
    info: number;
    healthy: boolean;
  };
}

interface JournalHistory {
  entries: BranchArtifactHead[];
  cursor: number;
}
interface JournalFile {
  schemaVersion?: string;
  branches?: Record<string, Record<string, JournalHistory>>;
}

function payloadHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
function sameRef(a: ArtifactRef, b: ArtifactRef): boolean {
  return a.id === b.id && a.kind === b.kind && a.version === b.version && a.contentHash === b.contentHash;
}
function issue(code: ProjectDoctorCode, severity: ProjectDoctorSeverity, message: string, details: Omit<ProjectDoctorIssue, "code" | "severity" | "message"> = {}): ProjectDoctorIssue {
  return { code, severity, message, ...details };
}
function count(issues: ProjectDoctorIssue[], severity: ProjectDoctorSeverity): number { return issues.filter((item) => item.severity === severity).length; }

async function readEnvelope(store: ArtifactStore, ref: ArtifactRef): Promise<ArtifactEnvelope<unknown> | undefined> {
  try { return await store.read<unknown>(ref.id, ref.version); }
  catch { return undefined; }
}

function branchParentCycles(manifest: ProjectManifest): string[][] {
  const cycles: string[][] = [];
  const emitted = new Set<string>();
  for (const branchId of Object.keys(manifest.branches)) {
    const seen = new Map<string, number>();
    const path: string[] = [];
    let current: string | undefined = branchId;
    while (current && manifest.branches[current]) {
      const existing = seen.get(current);
      if (existing !== undefined) {
        const cycle = path.slice(existing).concat(current);
        const key = [...new Set(cycle)].sort().join("|");
        if (!emitted.has(key)) { emitted.add(key); cycles.push(cycle); }
        break;
      }
      seen.set(current, path.length);
      path.push(current);
      current = manifest.branches[current].parentBranchId;
    }
  }
  return cycles;
}

async function validateRef(store: ArtifactStore, ref: ArtifactRef, context: { branchId?: string; label: string }, issues: ProjectDoctorIssue[], counters: { inputs: number }) {
  counters.inputs += 1;
  const envelope = await readEnvelope(store, ref);
  if (!envelope) {
    issues.push(issue("input-artifact-missing", "blocker", `${context.label} references missing artifact ${ref.id} v${ref.version}`, { branchId: context.branchId, artifactId: ref.id, version: ref.version }));
    return;
  }
  if (envelope.contentHash !== ref.contentHash) issues.push(issue("input-content-hash-mismatch", "blocker", `${context.label} expects ${ref.id} v${ref.version} hash ${ref.contentHash}, stored envelope reports ${envelope.contentHash}`, { branchId: context.branchId, artifactId: ref.id, version: ref.version }));
  const computed = payloadHash(envelope.payload);
  if (computed !== envelope.contentHash) issues.push(issue("head-content-hash-mismatch", "blocker", `Artifact ${ref.id} v${ref.version} payload hash ${computed} does not match envelope ${envelope.contentHash}`, { branchId: context.branchId, artifactId: ref.id, version: ref.version }));
}

export async function runProjectDoctor(projectRoot: string): Promise<ProjectDoctorReport> {
  const root = resolve(projectRoot);
  const store = new ArtifactStore(root);
  const issues: ProjectDoctorIssue[] = [];
  const counters = { heads: 0, inputs: 0, journal: 0 };
  let manifest: ProjectManifest | undefined;
  try { manifest = await store.readManifest(); }
  catch (error) {
    issues.push(issue("manifest-active-branch-missing", "blocker", `Project manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`));
    return {
      schemaVersion: "0.1", checkedAt: new Date().toISOString(), projectRoot: root, branchCount: 0, artifactCount: 0,
      checkedHeads: 0, checkedInputs: 0, checkedJournalEntries: 0, issues,
      summary: { blocker: 1, warning: 0, info: 0, healthy: false },
    };
  }

  if (!manifest.branches[manifest.activeBranchId]) issues.push(issue("manifest-active-branch-missing", "blocker", `Active branch ${manifest.activeBranchId} does not exist`, { branchId: manifest.activeBranchId }));

  const names = new Map<string, string[]>();
  for (const branch of Object.values(manifest.branches)) {
    const key = branch.name.trim().toLowerCase();
    const values = names.get(key) ?? []; values.push(branch.id); names.set(key, values);
    if (branch.parentBranchId && !manifest.branches[branch.parentBranchId]) issues.push(issue("branch-parent-missing", "blocker", `Branch ${branch.id} references missing parent ${branch.parentBranchId}`, { branchId: branch.id, details: { parentBranchId: branch.parentBranchId } }));
    const deckHeads = Object.values(branch.heads).filter((head) => head.kind === "deck");
    if (deckHeads.length > 1) issues.push(issue("branch-multiple-deck-heads", "blocker", `Branch ${branch.id} has ${deckHeads.length} deck heads; active deck selection is ambiguous`, { branchId: branch.id, details: { deckHeads: deckHeads.map((head) => head.id) } }));

    for (const head of Object.values(branch.heads)) {
      counters.heads += 1;
      const envelope = await readEnvelope(store, head);
      if (!envelope) {
        issues.push(issue("head-artifact-missing", "blocker", `Branch ${branch.id} head ${head.id} v${head.version} cannot be read`, { branchId: branch.id, artifactId: head.id, version: head.version }));
        continue;
      }
      if (!sameRef(head, envelope)) issues.push(issue("head-envelope-mismatch", "blocker", `Branch ${branch.id} head metadata does not match stored envelope ${head.id} v${head.version}`, { branchId: branch.id, artifactId: head.id, version: head.version, details: { head, envelope: { id: envelope.id, kind: envelope.kind, version: envelope.version, contentHash: envelope.contentHash } } }));
      const computed = payloadHash(envelope.payload);
      if (computed !== envelope.contentHash) issues.push(issue("head-content-hash-mismatch", "blocker", `Artifact ${head.id} v${head.version} payload hash ${computed} does not match envelope ${envelope.contentHash}`, { branchId: branch.id, artifactId: head.id, version: head.version }));
      for (const input of envelope.inputs ?? []) await validateRef(store, input, { branchId: branch.id, label: `Artifact ${head.id} v${head.version} input` }, issues, counters);
    }

    for (const baseHead of Object.values(branch.baseHeads ?? {})) {
      const envelope = await readEnvelope(store, baseHead);
      if (!envelope) issues.push(issue("base-head-artifact-missing", "blocker", `Branch ${branch.id} base head ${baseHead.id} v${baseHead.version} cannot be read`, { branchId: branch.id, artifactId: baseHead.id, version: baseHead.version }));
      else if (payloadHash(envelope.payload) !== baseHead.contentHash) issues.push(issue("head-content-hash-mismatch", "blocker", `Branch ${branch.id} base head ${baseHead.id} hash no longer matches stored payload`, { branchId: branch.id, artifactId: baseHead.id, version: baseHead.version }));
    }
  }

  for (const [name, branchIds] of names) if (branchIds.length > 1) issues.push(issue("branch-name-duplicate", "warning", `Branch name ${name} is used by ${branchIds.length} branches`, { details: { branchIds } }));
  for (const cycle of branchParentCycles(manifest)) issues.push(issue("branch-parent-cycle", "blocker", `Branch parent cycle detected: ${cycle.join(" → ")}`, { details: { cycle } }));

  for (const [artifactId, meta] of Object.entries(manifest.artifacts)) {
    const ref: ArtifactRef = { id: artifactId, kind: meta.kind, version: meta.latestVersion, contentHash: meta.latestHash };
    const envelope = await readEnvelope(store, ref);
    if (!envelope) issues.push(issue("manifest-latest-artifact-missing", "blocker", `Manifest latest artifact ${artifactId} v${meta.latestVersion} cannot be read`, { artifactId, version: meta.latestVersion }));
    else {
      if (envelope.contentHash !== meta.latestHash) issues.push(issue("manifest-latest-hash-mismatch", "blocker", `Manifest latest hash for ${artifactId} is ${meta.latestHash}, envelope reports ${envelope.contentHash}`, { artifactId, version: meta.latestVersion }));
      const computed = payloadHash(envelope.payload);
      if (computed !== envelope.contentHash) issues.push(issue("head-content-hash-mismatch", "blocker", `Manifest latest artifact ${artifactId} v${meta.latestVersion} payload hash does not match envelope`, { artifactId, version: meta.latestVersion }));
    }
  }

  try {
    const raw = JSON.parse(await readFile(join(root, ".project", "version-journal.json"), "utf8")) as JournalFile;
    for (const [branchId, histories] of Object.entries(raw.branches ?? {})) {
      if (!manifest.branches[branchId]) issues.push(issue("journal-branch-missing", "warning", `Version journal contains history for missing branch ${branchId}`, { branchId }));
      for (const [artifactId, history] of Object.entries(histories ?? {})) {
        if (!Number.isInteger(history.cursor) || history.cursor < -1 || history.cursor >= history.entries.length) issues.push(issue("journal-cursor-invalid", "blocker", `Version journal cursor ${history.cursor} is invalid for ${branchId}/${artifactId} with ${history.entries.length} entries`, { branchId, artifactId }));
        for (const entry of history.entries) {
          counters.journal += 1;
          const envelope = await readEnvelope(store, entry);
          if (!envelope) issues.push(issue("journal-head-missing", "blocker", `Version journal references missing ${entry.id} v${entry.version}`, { branchId, artifactId: entry.id, version: entry.version }));
          else if (envelope.contentHash !== entry.contentHash || payloadHash(envelope.payload) !== entry.contentHash) issues.push(issue("journal-head-hash-mismatch", "blocker", `Version journal entry ${entry.id} v${entry.version} hash does not match stored payload`, { branchId, artifactId: entry.id, version: entry.version }));
        }
      }
    }
  } catch (error) {
    const code = error instanceof SyntaxError ? "journal-json-invalid" : "journal-artifact-missing";
    const severity: ProjectDoctorSeverity = error instanceof SyntaxError ? "blocker" : "info";
    issues.push(issue(code, severity, error instanceof SyntaxError ? `Version journal JSON is invalid: ${error.message}` : "Version journal is not present yet; histories will be created on first versioned edit."));
  }

  const blocker = count(issues, "blocker"), warning = count(issues, "warning"), info = count(issues, "info");
  return {
    schemaVersion: "0.1", checkedAt: new Date().toISOString(), projectRoot: root, projectId: manifest.projectId, activeBranchId: manifest.activeBranchId,
    branchCount: Object.keys(manifest.branches).length, artifactCount: Object.keys(manifest.artifacts).length,
    checkedHeads: counters.heads, checkedInputs: counters.inputs, checkedJournalEntries: counters.journal,
    issues,
    summary: { blocker, warning, info, healthy: blocker === 0 },
  };
}
