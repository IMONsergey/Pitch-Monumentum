import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { parseSvgPathData } from "../packages/vector-path/src/index.js";

async function demoRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pitch-codex-vector-"));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  return root;
}

test("Codex edits the same structured vector object through the workspace command runtime", async () => {
  const root = await demoRoot();
  try {
    const service = new PitchWorkspaceService(root);
    const before = await service.state();
    const slide = before.deck.slides[0];
    const pathData = parseSvgPathData("M 0 0 C 30 0 70 100 100 100 L 140 100");

    const inserted = await service.editorCommand({
      command: "insertVector",
      slideId: slide.id,
      expectedDeckHash: before.deckHash,
      geometry: { x: 300, y: 240, width: 420, height: 220 },
      pathData,
      fill: "transparent",
      stroke: { color: "#111111", widthDU: 4 },
      name: "AI editable curve",
    });
    const vectorId = inserted.nextSelectionIds[0];
    assert(vectorId);
    const vectorBefore = inserted.deck.slides[0].scene.find((element) => element.id === vectorId);
    assert(vectorBefore && vectorBefore.type === "shape" && vectorBefore.shape === "custom" && vectorBefore.pathData);

    const result = await service.codexTool({
      name: "pitch_edit_vector",
      expectedDeckHash: inserted.deckHash,
      arguments: {
        slideId: slide.id,
        elementId: vectorId,
        operation: "moveAnchor",
        commandIndex: 1,
        handle: null,
        x: 125,
        y: 125,
        t: null,
        moveHandles: true,
        fitBounds: true,
      },
    });

    const vectorAfter = result.deck.slides[0].scene.find((element) => element.id === vectorId);
    assert(vectorAfter && vectorAfter.type === "shape" && vectorAfter.shape === "custom" && vectorAfter.pathData);
    assert.equal(vectorAfter.id, vectorId, "stable scene identity must survive Codex vector editing");
    assert.notDeepEqual(vectorAfter.pathData, vectorBefore.pathData);
    assert.equal(result.tool, "pitch_edit_vector");
    assert.deepEqual(result.nextSelectionIds, [vectorId]);

    const manifest = await service.store.readManifest();
    const branch = manifest.branches[manifest.activeBranchId];
    const head = Object.values(branch.heads).find((item) => item.kind === "deck");
    assert(head);
    const artifact = await service.store.read(head.id, head.version);
    assert.equal(artifact.producer.type, "codex");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
