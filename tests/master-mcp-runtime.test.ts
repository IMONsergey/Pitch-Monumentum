import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { executeWorkspaceSlideMasterCommand } from "../apps/workspace/src/master-runtime.js";
import { readMasterToolState } from "../apps/master-mcp/src/server.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pitch-master-mcp-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  return { root, service: new PitchWorkspaceService(root) };
}

test("Master MCP state exposes deck masters recommendations and integrity QA", async () => {
  const { root, service } = await fixture();
  try {
    let project = await service.state();
    let state = await readMasterToolState(service, project.deck.slides[0].id);
    assert.equal(state.masters.length, 0);
    assert.equal(state.currentMasterId, null);
    assert.equal(state.qa.ready, true);

    project = await executeWorkspaceSlideMasterCommand(service, { command: "createMaster", slideId: project.deck.slides[0].id, name: "Demo Layout", masterId: "master_demo", expectedDeckHash: project.deckHash });
    state = await readMasterToolState(service, project.deck.slides[0].id);
    assert.equal(state.masters.length, 1);
    assert.equal(state.masters[0].id, "master_demo");
    assert.equal(state.recommendations[0].masterId, "master_demo");

    project = await executeWorkspaceSlideMasterCommand(service, { command: "applyMaster", slideId: project.deck.slides[0].id, masterId: "master_demo", instanceId: "instance_demo", expectedDeckHash: project.deckHash });
    state = await readMasterToolState(service, project.deck.slides[0].id);
    assert.equal(state.currentMasterId, "master_demo");
    assert.equal(state.qa.linkedSlideCount, 1);
    assert.equal(state.qa.instanceCount, 1);
    assert.equal(state.qa.ready, true);

    const undo = await service.undo();
    const afterUndo = await readMasterToolState(service, undo.deck.slides[0].id);
    assert.equal(afterUndo.currentMasterId, null);
    assert.equal(afterUndo.masters.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
