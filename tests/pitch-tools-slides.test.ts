import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { PitchToolRuntime } from "../packages/pitch-tools/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";

const root = "/tmp/pitch-tools-slides-test";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "deck",
    title: "Slides",
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
      title: "Original",
      archetype: "freeform",
      semantic: { purpose: "working", takeaway: "", questionAnswered: "", narrativeRole: "working", claimIds: [], evidenceRefs: [], audienceRelevance: "", density: "balanced" },
      scene: [{ id: "shape", type: "shape", semanticRole: "visual", geometry: { x: 100, y: 100, width: 300, height: 200 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], shape: "rect", fill: "#dddddd" }],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

async function setup() {
  await rm(root, { recursive: true, force: true });
  const store = new ArtifactStore(root);
  await store.init("Slide tools", "slide_tools_project");
  await store.write({ id: "deck", kind: "deck", payload: fixture(), producer: { type: "deterministic" } });
  const service = new PitchWorkspaceService(root);
  return { service, runtime: new PitchToolRuntime(service) };
}

test("Codex duplicateSlide tool creates one canonical version and undo restores the storyboard", async () => {
  const { service, runtime } = await setup();
  const before = await service.state();
  const result = await runtime.callTool("pitch_editor_command", {
    command: "duplicateSlide",
    slideId: "s1",
    expectedDeckHash: before.deckHash,
  });
  assert.equal(result.ok, true, result.error);
  const payload = result.data as any;
  assert(payload.nextSlideId);

  const after = await service.state();
  assert.equal(after.deck.slides.length, 2);
  assert.equal(after.deck.slides[1].id, payload.nextSlideId);
  assert.notEqual(after.deck.slides[1].scene[0].id, "shape");
  const head = Object.values(after.manifest.branches[after.manifest.activeBranchId].heads).find((value: any) => value.kind === "deck") as any;
  assert.equal(head.version, 2);

  const undo = await runtime.callTool("pitch_undo");
  assert.equal(undo.ok, true, undo.error);
  const restored = await service.state();
  assert.equal(restored.deck.slides.length, 1);
  assert.equal(restored.deck.slides[0].id, "s1");
});

test("Codex newSlide and renameSlide tools expose returned slide handles for continued work", async () => {
  const { service, runtime } = await setup();
  const before = await service.state();
  const created = await runtime.callTool("pitch_editor_command", {
    command: "newSlide",
    afterSlideId: "s1",
    title: "Working slide",
    expectedDeckHash: before.deckHash,
  });
  assert.equal(created.ok, true, created.error);
  const createdId = (created.data as any).nextSlideId;
  assert(createdId);

  const afterCreate = await service.state();
  const renamed = await runtime.callTool("pitch_editor_command", {
    command: "renameSlide",
    slideId: createdId,
    title: "CFO decision",
    expectedDeckHash: afterCreate.deckHash,
  });
  assert.equal(renamed.ok, true, renamed.error);
  const final = await service.state();
  assert.equal(final.deck.slides.find(slide => slide.id === createdId)?.title, "CFO decision");
});
