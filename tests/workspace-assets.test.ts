import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { inspectPptx } from "../packages/pptx-roundtrip/src/index.js";
import { createWorkspaceServer, PitchWorkspaceService } from "../apps/workspace/src/server.js";

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=",
  "base64",
);

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "asset_deck",
    title: "Asset deck",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief",
    narrativeId: "narrative",
    designSystemId: "design",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z",
    updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1",
      order: 0,
      title: "Image",
      archetype: "freeform",
      semantic: {
        purpose: "Show image",
        takeaway: "Original asset remains editable",
        questionAnswered: "Does upload work?",
        narrativeRole: "evidence",
        claimIds: [],
        evidenceRefs: [],
        audienceRelevance: "test",
        density: "sparse",
      },
      scene: [],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

async function setup(root: string): Promise<void> {
  const store = new ArtifactStore(root);
  await store.init("Asset workspace", "asset_project");
  await store.write({ id: "asset_deck", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
}

test("workspace upload stores original bytes, inserts ImageElement and exports a native PPTX picture", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-workspace-assets-"));
  try {
    await setup(root);
    const service = new PitchWorkspaceService(root);
    const before = await service.state();
    const uploaded = await service.uploadImage({
      bytesBase64: ONE_PX_PNG.toString("base64"),
      originalName: "hero.png",
      slideId: "s1",
      expectedDeckHash: before.deckHash,
    });

    const inserted = uploaded.deck.slides[0].scene.find((element: any) => element.id === uploaded.insertedElementId);
    assert(inserted);
    assert.equal(inserted.type, "image");
    assert.equal(inserted.assetId, uploaded.asset.id);
    assert.equal(uploaded.asset.width, 1);
    assert.equal(uploaded.asset.height, 1);
    assert((await service.assets.readBytes(uploaded.asset.id)).equals(ONE_PX_PNG));

    const exported = await service.exportPptx();
    assert.equal(exported.manifest.ready, true);
    assert.equal(exported.manifest.editability.unsupported, 0);
    const inspection = await inspectPptx(exported.path);
    assert.equal(inspection.slides[0].pictureCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace asset endpoint serves the exact original bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-workspace-asset-http-"));
  let server: ReturnType<typeof createWorkspaceServer>["server"] | undefined;
  try {
    await setup(root);
    const created = createWorkspaceServer(root);
    server = created.server;
    const state = await created.service.state();
    const uploaded = await created.service.uploadImage({
      bytesBase64: ONE_PX_PNG.toString("base64"),
      originalName: "served.png",
      expectedDeckHash: state.deckHash,
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/assets/${encodeURIComponent(uploaded.asset.id)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(bytes.equals(ONE_PX_PNG));
  } finally {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
