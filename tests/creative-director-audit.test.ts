import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { CreativeDirectorRuntime } from "../apps/creative-director/src/runtime.js";
import { listCreativeRuns, readCreativeRun } from "../apps/creative-director/src/audit-runtime.js";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-director-audit-"));
  const store = new ArtifactStore(root);
  await store.init("Director audit", "audit_project");
  const deck: DeckDocument = {
    schemaVersion: "0.1", id: "deck_audit", title: "Audit",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{ id: "s1", order: 0, title: "Audit", archetype: "freeform", semantic: { purpose: "test", takeaway: "Keep", questionAnswered: "What?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [{ id: "img", type: "image", assetId: "missing", fit: "cover", semanticRole: "visual", geometry: { x: 100, y: 100, width: 640, height: 420 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] }], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
  await store.write({ id: "deck", kind: "deck", payload: deck, producer: { type: "deterministic" } });
  return { root, runtime: new CreativeDirectorRuntime(root), async close() { await rm(root, { recursive: true, force: true }); } };
}

test("executed Director run creates readable branch-local immutable audit record", async () => {
  const h = await setup();
  try {
    const prepared = await h.runtime.prepare({ id: "audit_req", instruction: "Contain this image", intent: ["media"], scope: { kind: "selection", slideIds: ["s1"], elementIds: ["img"] } });
    const executed = await h.runtime.execute(prepared.plan, { schemaVersion: "0.1", requestId: "audit_req", deckId: "deck_audit", mode: "currentBranch", actions: [{ id: "a1", stepId: "edit_media", tool: "pitch_media_command", args: { command: "setImageFit", slideId: "s1", elementId: "img", fit: "contain" } }] });
    assert(executed.auditArtifact);
    const runs = await listCreativeRuns(h.runtime.service);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].requestId, "audit_req");
    assert.equal(runs[0].actionCount, 1);
    assert.equal(runs[0].successfulActions, 1);
    const record = await readCreativeRun(h.runtime.service, executed.auditArtifact!.id);
    assert.equal(record.requestId, "audit_req");
    assert.equal(record.actions[0].tool, "pitch_media_command");
    assert.equal(record.traces[0].beforeDeckHash, prepared.deckHash);
    assert.notEqual(record.traces[0].afterDeckHash, prepared.deckHash);
  } finally { await h.close(); }
});
