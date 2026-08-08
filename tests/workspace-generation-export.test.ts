import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import type { ImageGenerator } from "../packages/image-generation/src/index.js";
import { createWorkspaceServer, PitchWorkspaceService } from "../apps/workspace/src/server.js";

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=",
  "base64",
);

class FakeGenerator implements ImageGenerator {
  readonly provider = "fake-workspace";
  calls: any[] = [];
  async generate(request: any) {
    this.calls.push(request);
    return {
      bytes: ONE_PX_PNG,
      mimeType: "image/png" as const,
      model: "fake-workspace-image-v1",
      requestId: "req_workspace",
    };
  }
}

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "workspace_gen", title: "Generation", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1", order: 0, title: "Generated", archetype: "freeform",
      semantic: { purpose: "test", takeaway: "Generated asset", questionAnswered: "works?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
      scene: [], status: "draft", qaIssueIds: [], dependencyIds: [],
    }],
  };
}

async function setup(root: string): Promise<void> {
  const store = new ArtifactStore(root);
  await store.init("Generation workspace", "workspace_generation_project");
  await store.write({ id: "workspace_gen", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
}

test("workspace AI generation creates a generated-provenance asset and ordinary agent ImageElement", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-workspace-generation-"));
  try {
    await setup(root);
    const generator = new FakeGenerator();
    const service = new PitchWorkspaceService(root, { imageGenerator: generator });
    const before = await service.state();
    const result = await service.generateImage({
      prompt: "calm editorial research station",
      aspectRatio: "landscape",
      quality: "high",
      slideId: "s1",
      expectedDeckHash: before.deckHash,
    });

    assert.equal(generator.calls.length, 1);
    assert.notEqual(result.deckHash, before.deckHash);
    assert.equal(result.generation.model, "fake-workspace-image-v1");
    const element = result.deck.slides[0].scene.find((item: any) => item.id === result.insertedElementId);
    assert(element && element.type === "image");
    assert.equal(element.origin, "agent");
    assert.equal(element.assetId, result.asset.id);
    const asset = await service.assets.get(result.asset.id);
    assert.equal(asset.provenance[0].source, "generated");
    assert.equal(asset.provenance[0].prompt, "calm editorial research station");
    assert((await service.assets.readBytes(asset.id)).equals(ONE_PX_PNG));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Figma export endpoint writes a self-contained bundle and serves it through the safe export download route", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-workspace-figma-export-"));
  let server: ReturnType<typeof createWorkspaceServer>["server"] | undefined;
  try {
    await setup(root);
    const generator = new FakeGenerator();
    const created = createWorkspaceServer(root, { imageGenerator: generator });
    server = created.server;
    const before = await created.service.state();
    await created.service.generateImage({ prompt: "single pixel test image", slideId: "s1", expectedDeckHash: before.deckHash });
    const exported = await created.service.exportFigma();
    assert.match(exported.path, /\.pitch-figma\.json$/);
    assert.equal(exported.slideCount, 1);
    assert.equal(exported.assetCount, 1);
    const onDisk = await readFile(exported.path);

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}${exported.downloadUrl}`);
    assert.equal(response.status, 200);
    const downloaded = Buffer.from(await response.arrayBuffer());
    assert(downloaded.equals(onDisk));
    const parsed = JSON.parse(downloaded.toString("utf8"));
    assert.equal(parsed.kind, "pitch-figma-bridge");
    assert.equal(Object.keys(parsed.assets).length, 1);
  } finally {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("export download rejects path traversal attempts", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-workspace-export-path-"));
  try {
    await setup(root);
    const service = new PitchWorkspaceService(root);
    await assert.rejects(() => service.readExport("../secret.json"), /Invalid export file name/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
