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
      scene: [
        {
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
        },
        {
          id: "hero_image",
          type: "image",
          name: "Hero image",
          semanticRole: "visual",
          geometry: { x: 120, y: 400, width: 900, height: 500 },
          zIndex: 2,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          assetId: "asset_original",
          fit: "cover",
        },
      ],
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

test("Pitch tool catalog exposes editor, motion, media, components and independent histories", async () => {
  const { runtime } = await setup();
  const tools = runtime.listTools();
  assert.deepEqual(tools.map(tool => tool.name), [
    "pitch_project_state",
    "pitch_editor_command",
    "pitch_motion_command",
    "pitch_media_command",
    "pitch_component_command",
    "pitch_undo",
    "pitch_redo",
    "pitch_motion_undo",
    "pitch_motion_redo",
  ]);
  assert.equal(tools.find(tool => tool.name === "pitch_project_state")?.readOnly, true);
  assert.equal(tools.find(tool => tool.name === "pitch_motion_command")?.readOnly, false);
  const componentSchema = tools.find(tool => tool.name === "pitch_component_command")?.inputSchema as any;
  assert.equal(componentSchema.oneOf.some((item: any) => item.properties.command.const === "updateFromSelection"), true);
  assert.equal(componentSchema.oneOf.some((item: any) => item.properties.command.const === "resetInstance"), true);
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

test("Codex can author motion and undo it independently from deck history", async () => {
  const { service, runtime } = await setup();
  const before = await service.state();
  const result = await runtime.callTool("pitch_motion_command", {
    command: "addBuild",
    slideId: "s1",
    elementIds: ["title"],
    kind: "entrance",
    effect: "fade",
    trigger: "onClick",
    durationMs: 400,
    expectedDeckHash: before.deckHash,
  });
  assert.equal(result.ok, true, result.error);
  let state = await service.state();
  assert.equal(state.motion.slides[0].builds.length, 1);
  assert.equal(state.deckHash, before.deckHash);
  assert.equal(state.motionHistory.canUndo, true);

  const undo = await runtime.callTool("pitch_motion_undo");
  assert.equal(undo.ok, true, undo.error);
  state = await service.state();
  assert.deepEqual(state.motion.slides, []);
  assert.equal(state.deckHash, before.deckHash);
});

test("Codex media command preserves the image object while changing native crop", async () => {
  const { service, runtime } = await setup();
  const before = await service.state();
  const result = await runtime.callTool("pitch_media_command", {
    command: "setImageCrop",
    slideId: "s1",
    elementId: "hero_image",
    crop: { left: .1, top: .05, right: .1, bottom: .05 },
    expectedDeckHash: before.deckHash,
  });
  assert.equal(result.ok, true, result.error);
  const after = await service.state();
  const image = after.deck.slides[0].scene.find((element: any) => element.id === "hero_image") as any;
  assert.equal(image.type, "image");
  assert.equal(image.assetId, "asset_original");
  assert.deepEqual(image.crop, { left: .1, top: .05, right: .1, bottom: .05 });
});

test("Codex can create, insert, resync and reset linked component instances", async () => {
  const { service, runtime } = await setup();
  let state = await service.state();
  const created = await runtime.callTool("pitch_component_command", {
    command: "createFromSelection",
    slideId: "s1",
    selectedIds: ["title"],
    name: "Decision title",
    componentId: "component_decision_title",
    expectedDeckHash: state.deckHash,
  });
  assert.equal(created.ok, true, created.error);
  state = await service.state();
  assert.equal(state.components.some((component: any) => component.id === "component_decision_title"), true);

  const inserted = await runtime.callTool("pitch_component_command", {
    command: "insert",
    slideId: "s1",
    componentId: "component_decision_title",
    transform: { x: 300, y: 700 },
    instanceId: "instance_decision",
    expectedDeckHash: state.deckHash,
  });
  assert.equal(inserted.ok, true, inserted.error);
  state = await service.state();
  const instance = state.deck.slides[0].scene.find((element: any) => element.id === "instance_decision_title") as any;
  assert(instance);
  assert(instance.tags.includes("component:instance_decision"));
  assert(instance.tags.includes("component-def:component_decision_title"));
  assert(instance.tags.includes("component-source:title"));
  assert.equal(state.componentInstances.length, 1);
  assert.equal(state.components.find((component: any) => component.id === "component_decision_title")?.instanceCount, 1);

  const synced = await runtime.callTool("pitch_component_command", {
    command: "refreshInstances",
    componentId: "component_decision_title",
    expectedDeckHash: state.deckHash,
  });
  assert.equal(synced.ok, true, synced.error);
  state = await service.state();

  const reset = await runtime.callTool("pitch_component_command", {
    command: "resetInstance",
    componentId: "component_decision_title",
    instanceId: "instance_decision",
    expectedDeckHash: state.deckHash,
  });
  assert.equal(reset.ok, true, reset.error);
});

test("project-state tool returns semantic handles plus motion, component instances and assets", async () => {
  const { runtime } = await setup();
  const result = await runtime.callTool("pitch_project_state");
  assert.equal(result.ok, true);
  const data = result.data as any;
  assert.equal(data.deck.slides[0].elements[0].id, "title");
  assert.equal(data.deck.slides[0].elements[0].semanticRole, "title");
  assert.equal(data.deck.slides[0].elements[0].geometry.x, 120);
  assert.equal("paragraphs" in data.deck.slides[0].elements[0], false);
  assert.equal(data.motion.deckId, "deck_tools");
  assert.deepEqual(data.components, []);
  assert.deepEqual(data.componentInstances, []);
  assert.deepEqual(data.assets, []);
});

test("unknown Pitch tool fails closed", async () => {
  const { runtime } = await setup();
  const result = await runtime.callTool("pitch_delete_everything");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Unknown Pitch tool/);
});
