import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { runProjectDoctor } from "../packages/project-doctor/src/index.js";

function deck(id = "doctor_deck"): DeckDocument {
  return {
    schemaVersion: "0.1", id, title: "Doctor",
    canvas: { widthDU: 1200, heightDU: 750, duPerInch: 120, aspectRatio: "custom" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Doctor", archetype: "freeform", semantic: { purpose: "test", takeaway: "Healthy", questionAnswered: "?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-project-doctor-"));
  const store = new ArtifactStore(root);
  await store.init("Doctor", "doctor_project");
  await store.write({ id: "deck", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
  return { root, store, async close() { await rm(root, { recursive: true, force: true }); } };
}

function codes(report: Awaited<ReturnType<typeof runProjectDoctor>>) { return report.issues.map((item) => item.code); }

test("healthy minimal project has no Project Doctor blockers", async () => {
  const h = await setup();
  try {
    const report = await runProjectDoctor(h.root);
    assert.equal(report.projectId, "doctor_project");
    assert.equal(report.activeBranchId, "branch_main");
    assert.equal(report.branchCount, 1);
    assert.equal(report.artifactCount, 1);
    assert.equal(report.summary.blocker, 0);
    assert.equal(report.summary.healthy, true);
  } finally { await h.close(); }
});

test("tampered artifact payload is detected by recomputing content hash", async () => {
  const h = await setup();
  try {
    const path = join(h.root, ".project", "artifacts", "deck", "deck", "v0001.json");
    const envelope = JSON.parse(await readFile(path, "utf8"));
    envelope.payload.title = "Tampered outside ArtifactStore";
    await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    const report = await runProjectDoctor(h.root);
    assert(report.summary.blocker > 0);
    assert(codes(report).includes("head-content-hash-mismatch"));
  } finally { await h.close(); }
});

test("ambiguous multiple deck heads and branch parent cycles are blockers", async () => {
  const h = await setup();
  try {
    await h.store.write({ id: "deck_second", kind: "deck", payload: deck("doctor_deck_second"), producer: { type: "user" } });
    const manifestPath = join(h.root, ".project", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.branches.branch_a = { id: "branch_a", name: "A", parentBranchId: "branch_b", createdAt: new Date().toISOString(), heads: structuredClone(manifest.branches.branch_main.heads) };
    manifest.branches.branch_b = { id: "branch_b", name: "B", parentBranchId: "branch_a", createdAt: new Date().toISOString(), heads: structuredClone(manifest.branches.branch_main.heads) };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const report = await runProjectDoctor(h.root);
    assert(codes(report).includes("branch-multiple-deck-heads"));
    assert(codes(report).includes("branch-parent-cycle"));
  } finally { await h.close(); }
});

test("invalid VersionJournal cursor and missing historical heads are blockers", async () => {
  const h = await setup();
  try {
    const journalPath = join(h.root, ".project", "version-journal.json");
    await writeFile(journalPath, `${JSON.stringify({ schemaVersion: "0.1", branches: { branch_main: { deck: { entries: [{ id: "deck", kind: "deck", version: 99, contentHash: "missing", status: "ready" }], cursor: 5 } } } }, null, 2)}\n`, "utf8");
    const report = await runProjectDoctor(h.root);
    assert(codes(report).includes("journal-cursor-invalid"));
    assert(codes(report).includes("journal-head-missing"));
    assert.equal(report.summary.healthy, false);
  } finally { await h.close(); }
});
