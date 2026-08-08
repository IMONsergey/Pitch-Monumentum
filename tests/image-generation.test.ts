import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetRegistry } from "../packages/assets/src/index.js";
import { GeneratedAssetService, type ImageGenerator } from "../packages/image-generation/src/index.js";

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=",
  "base64",
);

class FakeGenerator implements ImageGenerator {
  readonly provider = "fake";
  requests: any[] = [];
  async generate(request: any) {
    this.requests.push(request);
    return {
      bytes: ONE_PX_PNG,
      mimeType: "image/png" as const,
      model: "fake-image-v1",
      requestId: "req_test",
      revisedPrompt: `${request.prompt} polished`,
    };
  }
}

test("generated image bytes become a normal content-addressed asset with provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-generated-assets-"));
  try {
    const registry = new AssetRegistry(root);
    const generator = new FakeGenerator();
    const service = new GeneratedAssetService(registry, generator);
    const result = await service.generate({
      prompt: "  editorial photo of a calm arctic research station  ",
      aspectRatio: "landscape",
      quality: "high",
      background: "opaque",
    });

    assert.equal(generator.requests.length, 1);
    assert.equal(generator.requests[0].prompt, "editorial photo of a calm arctic research station");
    assert.equal(result.generated.model, "fake-image-v1");
    assert.equal(result.generated.requestId, "req_test");
    assert.equal(result.asset.width, 1);
    assert.equal(result.asset.height, 1);
    assert((await registry.readBytes(result.asset.id)).equals(ONE_PX_PNG));
    assert.equal(result.asset.provenance[0].source, "generated");
    assert.equal(result.asset.provenance[0].prompt, "editorial photo of a calm arctic research station");
    assert.equal(result.asset.provenance[0].model, "fake-image-v1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generation service rejects blank prompts before calling the provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-generated-empty-"));
  try {
    const generator = new FakeGenerator();
    const service = new GeneratedAssetService(new AssetRegistry(root), generator);
    await assert.rejects(() => service.generate({ prompt: "   " }), /prompt cannot be empty/);
    assert.equal(generator.requests.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
