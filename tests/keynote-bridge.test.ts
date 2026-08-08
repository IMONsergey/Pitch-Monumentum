import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { exportDeckToKeynote, KeynoteBridgeUnavailableError, type KeynoteAutomationRunner } from "../packages/keynote-bridge/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "keynote_deck",
    title: "Keynote Bridge",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b", narrativeId: "n", designSystemId: "d",
    sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{
      id: "s1", order: 0, title: "Decision", archetype: "decision",
      semantic: {
        purpose: "test", takeaway: "Native bridge", questionAnswered: "Works?", narrativeRole: "decision",
        claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse",
      },
      scene: [{
        id: "title", type: "text", semanticRole: "title",
        geometry: { x: 120, y: 140, width: 1200, height: 180 }, zIndex: 1,
        origin: "user", exportStrategy: "native", dependencies: [],
        paragraphs: [{ runs: [{ text: "Editable Keynote via PPTX bridge", fontSizePt: 40, bold: true, color: "#111111" }] }],
      }],
      status: "draft", qaIssueIds: [], dependencyIds: [],
    }],
  };
}

class FakeKeynoteRunner implements KeynoteAutomationRunner {
  calls: Array<{ input: string; output: string }> = [];
  async run(inputPptxPath: string, outputKeyPath: string): Promise<void> {
    const source = await readFile(inputPptxPath);
    assert(source.length > 1000, "Bridge input must be a real PPTX package");
    this.calls.push({ input: inputPptxPath, output: outputKeyPath });
    await writeFile(outputKeyPath, Buffer.from("fake-keynote-package-for-test"));
  }
}

test("Keynote export explicitly rejects non-macOS hosts", async () => {
  await assert.rejects(
    () => exportDeckToKeynote(fixture(), "/tmp/pitch-keynote.key", { platform: "linux" }),
    KeynoteBridgeUnavailableError,
  );
});

test("Keynote bridge converts only after a production PPTX gate and validates output", async () => {
  const root = await mkdtemp(join(tmpdir(), "pitch-keynote-test-"));
  try {
    const output = join(root, "decision.key");
    const runner = new FakeKeynoteRunner();
    const result = await exportDeckToKeynote(fixture(), output, { platform: "darwin", runner });
    assert.equal(result.bridge, "apple-keynote");
    assert.equal(result.sourcePptxManifest.ready, true);
    assert.equal(result.sourcePptxManifest.editability.unsupported, 0);
    assert.equal(runner.calls.length, 1);
    assert.equal(result.outputPath, output);
    assert((await stat(output)).size > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
