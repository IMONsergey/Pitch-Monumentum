import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { ensureDesktopPreviewProject } from "../packages/project-bootstrap/src/index.js";
import { runDeterministicQA } from "../packages/qa/src/index.js";

function deckHead(manifest: Awaited<ReturnType<ArtifactStore["readManifest"]>>) {
  return Object.values(manifest.branches[manifest.activeBranchId].heads).find((head) => head.kind === "deck");
}

test("desktop preview bootstrap creates an editable four-slide project and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-desktop-bootstrap-"));
  try {
    const first = await ensureDesktopPreviewProject(root);
    assert.equal(first.created, true);

    const store = new ArtifactStore(root);
    const manifest = await store.readManifest();
    const head = deckHead(manifest);
    assert(head, "desktop preview must create a deck head");
    const deck = (await store.read<DeckDocument>(head.id, head.version)).payload;
    assert.equal(deck.title, "Pitch Monumentum — Desktop Preview");
    assert.equal(deck.slides.length, 4);
    assert.deepEqual(deck.slides.map((slide) => slide.order), [0, 1, 2, 3]);
    assert(deck.slides.every((slide) => slide.scene.some((element) => element.type === "text")));
    assert.equal(runDeterministicQA(deck).some((issue) => issue.severity === "critical"), false);

    const beforeVersions = Object.fromEntries(Object.entries(manifest.artifacts).map(([id, meta]) => [id, meta.latestVersion]));
    const second = await ensureDesktopPreviewProject(root);
    assert.equal(second.created, false);
    const after = await store.readManifest();
    assert.deepEqual(Object.fromEntries(Object.entries(after.artifacts).map(([id, meta]) => [id, meta.latestVersion])), beforeVersions);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
