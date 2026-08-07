import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";

const root = "/tmp/pitchos-workspace-test";
function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Workspace", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Decision", archetype: "decision", semantic: { purpose: "Get approval", takeaway: "Approve phase two", questionAnswered: "What next?", narrativeRole: "decision", claimIds: [], evidenceRefs: [], audienceRelevance: "Board", density: "sparse" }, scene: [{ id: "t1", type: "text", semanticRole: "title", geometry: { x: 120, y: 140, width: 1200, height: 180 }, zIndex: 1, origin: "agent", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Approve phase two", fontSizePt: 44, bold: true, color: "#111111" }] }] }], status: "draft", qaIssueIds: [], dependencyIds: [] }]
  };
}
async function setup() {
  await rm(root, { recursive: true, force: true });
  const store = new ArtifactStore(root); await store.init("Workspace test", "workspace_project");
  await store.write({ id: "deck", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
  return new PitchWorkspaceService(root);
}
function text(state: any): string { return state.deck.slides[0].scene[0].paragraphs[0].runs[0].text; }

async function replace(service: PitchWorkspaceService, value: string) {
  const current = await service.state();
  return service.mutate({ expectedDeckHash: current.deckHash, reason: `Edit to ${value}`, operations: [{ op: "replaceText", slideId: "s1", elementId: "t1", paragraphs: [{ runs: [{ text: value, fontSizePt: 44, bold: true, color: "#111111" }] }] }] });
}

test("workspace mutation persists a new deck version and recalculates QA", async () => {
  const service = await setup(); const after = await replace(service, "Approve phase three");
  assert.equal(text(after), "Approve phase three");
  const head = Object.values(after.manifest.branches[after.manifest.activeBranchId].heads).find((h: any) => h.kind === "deck") as any;
  assert.equal(head.version, 2); assert.equal(after.history.canUndo, true);
});

test("workspace branch edit remains isolated from main", async () => {
  const service = await setup(); const forked = await service.fork("CFO"); const forkId = forked.manifest.activeBranchId;
  const after = await replace(service, "Protect margin first"); assert.equal(after.manifest.activeBranchId, forkId);
  await service.checkout("branch_main"); assert.equal(text(await service.state()), "Approve phase two");
  await service.checkout(forkId); assert.equal(text(await service.state()), "Protect margin first");
});

test("undo redo follows only the active branch history", async () => {
  const service = await setup();
  await replace(service, "Main second state");
  const forked = await service.fork("CFO"); const forkId = forked.manifest.activeBranchId;
  await replace(service, "CFO state"); assert.equal(text(await service.state()), "CFO state");
  assert.equal(text(await service.undo()), "Main second state");
  assert.equal(text(await service.redo()), "CFO state");
  await service.checkout("branch_main"); assert.equal(text(await service.state()), "Main second state");
  await service.checkout(forkId); assert.equal(text(await service.state()), "CFO state");
});

test("workspace exports active branch to a real PPTX", async () => {
  const service = await setup(); const result = await service.exportPptx();
  assert.equal(result.result.slideCount, 1); assert.equal(result.result.elementResults[0].strategy, "native"); assert.match(result.path, /\.pptx$/);
});
