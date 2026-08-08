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

async function assertLatestDeckProducedByCodex(service: PitchWorkspaceService): Promise<void> {
  const manifest = await service.store.readManifest();
  const branch = manifest.branches[manifest.activeBranchId];
  const deckHead = Object.values(branch.heads).find((head) => head.kind === "deck");
  assert(deckHead);
  const artifact = await service.store.read(deckHead.id, deckHead.version);
  assert.equal(artifact.producer.type, "codex");
}

test("Workspace Codex editor tool creates a canonical deck artifact produced by codex", async () => {
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
    await assertLatestDeckProducedByCodex(service);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Workspace strict Codex appearance tool writes gradient and shadow with codex provenance", async () => {
  const root = await demoRoot("pitch-codex-appearance-");
  try {
    const service = new PitchWorkspaceService(root);
    const before = await service.state();
    let slide: any;
    let target: any;
    for (const candidate of before.deck.slides) {
      const found = candidate.scene.find((element) => element.type === "shape" && element.shape !== "custom");
      if (found) { slide = candidate; target = found; break; }
    }
    assert(slide && target, "Demo needs one native shape");
    const result = await service.codexTool({
      name: "pitch_set_appearance",
      expectedDeckHash: before.deckHash,
      arguments: {
        slideId: slide.id, elementId: target.id, fillKind: "linearGradient",
        solidColor: null, solidOpacity: null, gradientAngleDeg: 120,
        gradientStartColor: "#102030", gradientStartOpacity: 1,
        gradientEndColor: "#C7FF5E", gradientEndOpacity: 0.88,
        shadowEnabled: true, shadowColor: "#000000", shadowOpacity: 0.2,
        shadowBlurDU: 22, shadowOffsetXDU: 5, shadowOffsetYDU: 10,
      },
    });
    const changed = result.deck.slides.find((item) => item.id === slide.id)?.scene.find((element) => element.id === target.id);
    assert(changed && changed.type === "shape");
    if (!changed || changed.type !== "shape") throw new Error("Expected shape");
    assert.equal(changed.fillPaint?.kind, "linearGradient");
    assert.equal(changed.effects?.[0]?.kind, "dropShadow");
    assert.equal(result.tool, "pitch_set_appearance");
    assert.deepEqual(result.nextSelectionIds, [target.id]);
    await assertLatestDeckProducedByCodex(service);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Workspace exposes transitional and strict Codex tools over HTTP", async () => {
  const root = await demoRoot("pitch-codex-registry-");
  const { server } = createWorkspaceServer(root);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/codex/tools`);
    assert.equal(response.status, 200);
    const payload = await response.json() as any;
    assert.equal(payload.tools.length, 4);
    const byName = new Map(payload.tools.map((tool: any) => [tool.name, tool]));
    assert.equal(byName.get("pitch_editor_command")?.strict, false);
    assert.equal(byName.get("pitch_set_style")?.strict, true);
    assert.equal(byName.get("pitch_set_appearance")?.strict, true);
    assert.equal(byName.get("pitch_edit_vector")?.strict, true);
    assert.equal(byName.get("pitch_edit_vector")?.parameters?.additionalProperties, false);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
