import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertPptxToKeynote, keynoteAvailability, KEYNOTE_SAVE_SCRIPT, type KeynoteCommandRunner } from "../packages/keynote-export/src/index.js";

test("Keynote availability is explicitly unsupported off macOS", async () => {
  const availability = await keynoteAvailability({ platform: "linux" });
  assert.equal(availability.supportedPlatform, false);
  assert.equal(availability.keynoteInstalled, false);
  assert.match(availability.reason ?? "", /macOS/);
});

test("Keynote availability resolves application bundle id through osascript on macOS", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const runner: KeynoteCommandRunner = async (file, args) => { calls.push({ file, args }); return { stdout: "com.apple.iWork.Keynote\n", stderr: "" }; };
  const availability = await keynoteAvailability({ platform: "darwin", runner });
  assert.equal(availability.supportedPlatform, true);
  assert.equal(availability.keynoteInstalled, true);
  assert.equal(availability.bundleId, "com.apple.iWork.Keynote");
  assert.equal(calls[0].file, "/usr/bin/osascript");
  assert(calls[0].args.join(" ").includes("id of application"));
});

test("conversion passes absolute PPTX/KEY paths to Keynote AppleScript and inspects file output", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-keynote-adapter-"));
  try {
    const input = join(root, "source.pptx");
    const output = join(root, "result.key");
    await writeFile(input, "fake pptx bytes");
    const calls: Array<{ file: string; args: string[] }> = [];
    const runner: KeynoteCommandRunner = async (file, args) => {
      calls.push({ file, args });
      if (args.join(" ").includes("id of application")) return { stdout: "com.apple.iWork.Keynote\n", stderr: "" };
      await writeFile(output, "fake key bytes");
      return { stdout: `${output}\n`, stderr: "" };
    };
    const result = await convertPptxToKeynote(input, output, { platform: "darwin", runner });
    assert.equal(result.adapterStatus, "adapter-unverified");
    assert.equal(result.outputKind, "file");
    assert.equal(result.outputFileCount, 1);
    assert.equal(result.bytes, Buffer.byteLength("fake key bytes"));
    assert.match(result.outputSha256, /^[0-9a-f]{64}$/);
    const saveCall = calls.find((call) => call.args.includes("--"));
    assert(saveCall);
    assert.equal(saveCall.file, "/usr/bin/osascript");
    assert(saveCall.args.includes(input));
    assert(saveCall.args.includes(output));
    assert.match(KEYNOTE_SAVE_SCRIPT, /open sourceFile/);
    assert.match(KEYNOTE_SAVE_SCRIPT, /save openedDocument in destinationFile/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("conversion accepts Keynote directory packages and reports their real contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-keynote-package-"));
  try {
    const input = join(root, "source.pptx");
    const output = join(root, "result.key");
    await writeFile(input, "fake pptx bytes");
    const runner: KeynoteCommandRunner = async (_file, args) => {
      if (args.join(" ").includes("id of application")) return { stdout: "com.apple.iWork.Keynote\n", stderr: "" };
      await mkdir(join(output, "Data"), { recursive: true });
      await writeFile(join(output, "index.apxl"), "abc");
      await writeFile(join(output, "Data", "asset.bin"), Buffer.from([1, 2, 3, 4]));
      return { stdout: `${output}\n`, stderr: "" };
    };
    const result = await convertPptxToKeynote(input, output, { platform: "darwin", runner });
    assert.equal(result.outputKind, "directory");
    assert.equal(result.outputFileCount, 2);
    assert.equal(result.bytes, 7);
    assert.match(result.outputSha256, /^[0-9a-f]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("conversion refuses wrong extensions before invoking Keynote", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-keynote-extension-"));
  try {
    const input = join(root, "source.txt");
    await writeFile(input, "not pptx");
    await assert.rejects(() => convertPptxToKeynote(input, join(root, "out.key"), { platform: "darwin", runner: async () => ({ stdout: "com.apple.iWork.Keynote\n", stderr: "" }) }), /\.pptx/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
