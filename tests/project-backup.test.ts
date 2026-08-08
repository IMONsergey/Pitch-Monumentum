import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { createProjectBackup, restoreProjectBackupAsClone } from "../packages/project-backup/src/index.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "backup_deck", title: "Backup",
    canvas: { widthDU: 1200, heightDU: 750, duPerInch: 120, aspectRatio: "custom" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Backup", archetype: "freeform", semantic: { purpose: "test", takeaway: "Safe", questionAnswered: "?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

async function setup() {
  const parent = await mkdtemp(join(tmpdir(), "pitch-backup-parent-"));
  const root = join(parent, "project"); await mkdir(root, { recursive: true });
  const store = new ArtifactStore(root);
  await store.init("Backup", "backup_project");
  await store.write({ id: "deck", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
  return { parent, root, store, backupRoot: join(parent, "backups"), async close() { await rm(parent, { recursive: true, force: true }); } };
}

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }

test("Project Recovery snapshot excludes derived exports and records Doctor/hash evidence", async () => {
  const h = await setup();
  try {
    const exports = join(h.root, ".project", "exports"); await mkdir(exports, { recursive: true }); await writeFile(join(exports, "stale.html"), "derived", "utf8");
    const backup = await createProjectBackup(h.root, { backupRoot: h.backupRoot, label: "before-risky-edit" });
    assert.equal(backup.metadata.source.projectId, "backup_project");
    assert.equal(backup.metadata.canonicalSnapshot.exportsExcluded, true);
    assert(backup.metadata.canonicalSnapshot.bytes > 0);
    assert(backup.metadata.canonicalSnapshot.fileCount > 0);
    assert.match(backup.metadata.canonicalSnapshot.sha256, /^[0-9a-f]{64}$/);
    assert.equal(backup.doctor.summary.healthy, true);
    assert.equal(await exists(join(backup.projectPath, ".project", "exports", "stale.html")), false);
    assert.equal(await exists(backup.metadataPath), true);
    assert.equal(await exists(backup.doctorPath), true);
  } finally { await h.close(); }
});

test("Project Recovery still snapshots a corrupted project and preserves Doctor evidence", async () => {
  const h = await setup();
  try {
    const artifact = join(h.root, ".project", "artifacts", "deck", "deck", "v0001.json");
    const envelope = JSON.parse(await readFile(artifact, "utf8")); envelope.payload.title = "corrupted"; await writeFile(artifact, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    const backup = await createProjectBackup(h.root, { backupRoot: h.backupRoot, label: "corrupt-evidence" });
    assert.equal(backup.metadata.doctor.healthy, false);
    assert(backup.metadata.doctor.blocker > 0);
    const report = JSON.parse(await readFile(backup.doctorPath, "utf8"));
    assert(report.issues.some((item: any) => item.code === "head-content-hash-mismatch"));
  } finally { await h.close(); }
});

test("restore always creates a new clone and verifies exact canonical snapshot bytes", async () => {
  const h = await setup();
  try {
    const backup = await createProjectBackup(h.root, { backupRoot: h.backupRoot });
    const destination = join(h.parent, "restored-clone");
    const restored = await restoreProjectBackupAsClone(backup.backupPath, destination);
    assert.equal(restored.metadata.canonicalSnapshot.sha256, backup.metadata.canonicalSnapshot.sha256);
    assert.equal(restored.doctor.summary.healthy, true);
    const manifest = JSON.parse(await readFile(join(destination, ".project", "manifest.json"), "utf8"));
    assert.equal(manifest.projectId, "backup_project");
    await assert.rejects(() => restoreProjectBackupAsClone(backup.backupPath, destination), /already contains \.project/);
  } finally { await h.close(); }
});
