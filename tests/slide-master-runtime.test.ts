import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { executeWorkspaceSlideMasterCommand } from "../apps/workspace/src/master-runtime.js";
import { slideMasterSourceId } from "../packages/slide-masters/src/index.js";

function masterTitle(deck: any): any { return deck.slides[0].scene.find((element: any) => slideMasterSourceId(element) === "title"); }

test("master create/apply/update are normal deck versions and ordinary undo restores prior master", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-master-runtime-"));
  try {
    execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
    const service = new PitchWorkspaceService(root);
    let state = await service.state();
    state = await executeWorkspaceSlideMasterCommand(service, { command: "createMaster", slideId: "slide_01", name: "Demo master", masterId: "master_demo", expectedDeckHash: state.deckHash });
    assert((state.deck as any).slideMasters.master_demo);
    state = await executeWorkspaceSlideMasterCommand(service, { command: "applyMaster", slideId: "slide_01", masterId: "master_demo", instanceId: "layout_demo", expectedDeckHash: state.deckHash });
    const beforeEditMaster = structuredClone((state.deck as any).slideMasters.master_demo);
    const title = masterTitle(state.deck);
    assert(title);

    const edited = await service.editorCommand({ command: "setGeometry", slideId: "slide_01", elementId: title.id, geometry: { x: title.geometry.x + 80 }, expectedDeckHash: state.deckHash });
    const editedX = masterTitle(edited.deck).geometry.x;
    state = await executeWorkspaceSlideMasterCommand(service, { command: "updateMasterFromSlide", slideId: "slide_01", masterId: "master_demo", expectedDeckHash: edited.deckHash });
    assert.equal((state.deck as any).slideMasters.master_demo.elements.find((element: any) => element.id === "title").geometry.x, editedX);

    const undoMasterUpdate = await service.undo();
    assert.deepEqual((undoMasterUpdate.deck as any).slideMasters.master_demo, beforeEditMaster);
    assert.equal(masterTitle(undoMasterUpdate.deck).geometry.x, editedX);
    const undoManualGeometry = await service.undo();
    assert.notEqual(masterTitle(undoManualGeometry.deck).geometry.x, editedX);
  } finally { await rm(root, { recursive: true, force: true }); }
});
