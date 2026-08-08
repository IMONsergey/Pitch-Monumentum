import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetRegistry } from "../packages/assets/src/index.js";

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=",
  "base64",
);

test("asset registry preserves original image bytes and deduplicates by SHA-256", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-assets-"));
  try {
    const registry = new AssetRegistry(root);
    const first = await registry.registerImage({
      bytes: ONE_PX_PNG,
      originalName: "reference.png",
      provenance: { source: "import", label: "first upload" },
    });
    const second = await registry.registerImage({
      bytes: ONE_PX_PNG,
      originalName: "same-image.png",
      provenance: { source: "clipboard", label: "pasted copy" },
    });

    assert.equal(second.id, first.id);
    assert.equal(first.mimeType, "image/png");
    assert.equal(first.width, 1);
    assert.equal(first.height, 1);
    assert.equal(first.byteLength, ONE_PX_PNG.length);

    const record = await registry.get(first.id);
    assert.equal(record.provenance.length, 2);
    const stored = await registry.readBytes(first.id);
    assert(stored.equals(ONE_PX_PNG));
    const disk = await readFile(await registry.absolutePath(first.id));
    assert(disk.equals(ONE_PX_PNG));

    const rich = await registry.resolveRichAssets([first.id]);
    assert.equal(rich[first.id].mimeType, "image/png");
    assert.equal(rich[first.id].path, await registry.absolutePath(first.id));
    assert.equal((await registry.list()).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asset registry rejects bytes that do not match the requested image type", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-assets-invalid-"));
  try {
    const registry = new AssetRegistry(root);
    await assert.rejects(() => registry.registerImage({
      bytes: Buffer.from("not a png"),
      originalName: "fake.png",
      mimeType: "image/png",
      provenance: { source: "import" },
    }), /Invalid image\/png image bytes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
