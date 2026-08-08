import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectFilesystemArtifact } from "../packages/fs-artifact/src/index.js";

test("filesystem artifact inspection hashes ordinary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-file-artifact-"));
  try {
    const path = join(root, "deck.pptx");
    await writeFile(path, Buffer.from("pitch"));
    const first = await inspectFilesystemArtifact(path);
    const second = await inspectFilesystemArtifact(path);
    assert.equal(first.kind, "file");
    assert.equal(first.bytes, 5);
    assert.equal(first.fileCount, 1);
    assert.equal(first.sha256, second.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("filesystem artifact inspection hashes directory packages deterministically", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-package-artifact-"));
  try {
    const key = join(root, "deck.key");
    await mkdir(join(key, "Data"), { recursive: true });
    await writeFile(join(key, "index.apxl"), "alpha");
    await writeFile(join(key, "Data", "image.png"), Buffer.from([1, 2, 3, 4]));
    const first = await inspectFilesystemArtifact(key);
    const second = await inspectFilesystemArtifact(key);
    assert.equal(first.kind, "directory");
    assert.equal(first.bytes, 9);
    assert.equal(first.fileCount, 2);
    assert.equal(first.sha256, second.sha256);

    await writeFile(join(key, "Data", "image.png"), Buffer.from([1, 2, 3, 5]));
    const changed = await inspectFilesystemArtifact(key);
    assert.notEqual(changed.sha256, first.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});
