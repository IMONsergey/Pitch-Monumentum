import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PitchWorkspaceService, createWorkspaceServer } from "../apps/workspace/src/server.js";

async function demoRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  execFileSync(process.execPath, ["dist/apps/cli/src/index.js", "demo", root], { stdio: "ignore" });
  return root;
}

test("Workspace Codex tool creates a canonical deck artifact produced by codex", async () => {
  const root = await demoRoot("pitch-codex-workspace-");
  try {
    const service = new PitchWorkspaceService(root);
    const before = await service.state();
    const target = before.deck.slides[0].scene.find((element) => !element.locked && element.geometry.x + element.geometry.width + 24 < before.deck.canvas.widthDU);
    assert(target, "Demo needs one movable object");

    const result = await service.codexTool({
      name: "pitch_editor_command",
      expectedDeckHash: before.deckHash,
      arguments: { command: "nudge", slideId: before.deck.slides[0].id, elementIds: [target.id], dx: 24, dy: 0 },
    });

    const moved = result.deck.slides[0].scene.find((element) => element.id === target.id);
    assert(moved);
    assert.equal(moved.geometry.x, target.geometry.x + 24);
    assert.notEqual(result.deckHash, before.deckHash);
    assert.deepEqual(result.nextSelectionIds, [target.id]);

    const manifest = await service.store.readManifest();
    const branch = manifest.branches[manifest.activeBranchId];
    const deckHead = Object.values(branch.heads).find((head) => head.kind === "deck");
    assert(deckHead);
    const artifact = await service.store.read(deckHead.id, deckHead.version);
    assert.equal(artifact.producer.type, "codex");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace exposes the bounded Codex tool registry over HTTP", async () => {
  const root = await demoRoot("pitch-codex-registry-");
  const { server } = createWorkspaceServer(root);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/codex/tools`);
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.equal(payload.tools.length, 1);
    assert.equal(payload.tools[0].name, "pitch_editor_command");
    assert.equal(payload.tools[0].strict, true);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
