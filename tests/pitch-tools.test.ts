import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import { PitchToolRuntime } from "../packages/pitch-tools/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";

const root = "/tmp/pitch-tools-test";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "deck_tools",
    title: "Codex tools",
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
      title: "Decision",
      archetype: "decision",
      semantic: {
        purpose: "Get approval",
        takeaway: "Approve phase two",
        questionAnswered: "What next?",
        narrativeRole: "decision",
        claimIds: [],
        evidenceRefs: [],
        audienceRelevance: "Board",
        density: "sparse",
      },
      scene: [{
        id: "title",
        type: "text",
        name: "Title",
        semanticRole: "title",
        geometry: { x: 120, y: 140, width: 1200, height: 180 },
        zIndex: 1,
        origin: "agent",
        exportStrategy: "native",
        dependencies: [],
        paragraphs: [{ runs: [{ text: "Approve phase two", fontSizePt: 44, bold: true, color: "#111111" }] }],
      }],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

async function setup() {
  await rm(root, { recursive: true, force: true });
  const store = new ArtifactStore(root);
  await store.init("Pitch tools", "pitch_tools_project");
  await store.write({ id: "deck", kind: "deck", payload: fixture(), producer: { type: "deterministic" } });
  const service = new PitchWorkspaceService(root);
  return { service, runtime: new PitchToolRuntime(service) };
}

test("Pitch tool catalog exposes bounded editor and history tools", async () => {
  const { runtime } = await setup();
  const tools = runtime.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ["pitch_project_state", "pitch_editor_command", "pitch_undo", "pitch_redo"]);
  assert.equal(tools.find(tool => tool.name === "pitch_project_state")?.readOnly, true);
  assert.equal(tools.find(tool => tool.name === "pitch_editor_command")?.readOnly, false);
});

test("Codex editor tool writes the same canonical deck version and can undo it", async () => {
  const { service, runtime } = await setup();
  const before = await service.state();
  const result = await runtime.callTool("pitch_editor_command", {
    command: "nudge",
    slideId: "s1",
    selectedIds: ["title"],
    dx: 12,
    dy: -4,
    expectedDeckHash: before.deckHash,
  });
  assert.equal(result.ok, true, result.error);
  const after = await service.state();
  const title = after.deck.slides[0].scene.find((element: any) => element.id === "title");
  assert.equal(title?.geometry.x, 132);
  assert.equal(title?.geometry.y, 136);
  assert.notEqual(after.deckHash, before.deckHash);
  const head = Object.values(after.manifest.branches[after.manifest.activeBranchId].heads).find((value: any) => value.kind === "deck") as any;
  assert.equal(head.version, 2);

  const undo = await runtime.callTool("pitch_undo");
  assert.equal(undo.ok, true, undo.error);
  const restored = await service.state();
  assert.equal(restored.deck.slides[0].scene.find((element: any) => element.id === "title")?.geometry.x, 120);
});

test("project-state tool returns semantic object handles rather than raw rich deck payloads", async () => {
  const { runtime } = await setup();
  const result = await runtime.callTool("pitch_project_state");
  assert.equal(result.ok, true);
  const data = result.data as any;
  assert.equal(data.deck.slides[0].elements[0].id, "title");
  assert.equal(data.deck.slides[0].elements[0].semanticRole, "title");
  assert.equal(data.deck.slides[0].elements[0].geometry.x, 120);
  assert.equal("paragraphs" in data.deck.slides[0].elements[0], false);
});

test("unknown Pitch tool fails closed", async () => {
  const { runtime } = await setup();
  const result = await runtime.callTool("pitch_delete_everything");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Unknown Pitch tool/);
});
