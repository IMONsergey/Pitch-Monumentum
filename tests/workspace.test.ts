import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import { PitchWorkspaceService } from "../apps/workspace/src/server.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";

const root = "/tmp/pitchos-workspace-test";
function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck", title: "Workspace", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Decision", archetype: "decision", semantic: { purpose: "Get approval", takeaway: "Approve phase two", questionAnswered: "What next?", narrativeRole: "decision", claimIds: [], evidenceRefs: [], audienceRelevance: "Board", density: "sparse" }, scene: [{ id: "t1", type: "text", semanticRole: "title", geometry: { x: 120, y: 140, width: 1200, height: 180 }, zIndex: 1, origin: "agent", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Approve phase two", fontSizePt: 44, bold: true, color: "#111111" }] }] }], status: "draft", qaIssueIds: [], dependencyIds: [] }]
  };
}

function autoLayoutDeck(): DeckDocument {
  const value = deck();
  value.slides[0] = {
    ...value.slides[0],
    scene: [
      {
        id: "frame",
        type: "frame",
        semanticRole: "visual",
        geometry: { x: 100, y: 100, width: 500, height: 180 },
        zIndex: 1,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        childIds: ["a", "b"],
        layout: {
          direction: "horizontal",
          gapDU: 20,
          padding: { top: 20, right: 20, bottom: 20, left: 20 },
          justify: "start",
          align: "start",
          widthSizing: "fixed",
          heightSizing: "fixed",
        },
      },
      {
        id: "a",
        type: "shape",
        semanticRole: "visual",
        geometry: { x: 120, y: 120, width: 100, height: 80 },
        zIndex: 2,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        shape: "rect",
        fill: "#cccccc",
        layoutItem: { width: "fixed", height: "fixed" },
      },
      {
        id: "b",
        type: "shape",
        semanticRole: "visual",
        geometry: { x: 240, y: 120, width: 100, height: 80 },
        zIndex: 3,
        origin: "user",
        exportStrategy: "native",
        dependencies: [],
        shape: "rect",
        fill: "#cccccc",
        layoutItem: { width: "fixed", height: "fixed" },
      },
    ],
  };
  return value;
}

async function setup(initialDeck: DeckDocument = deck()) {
  await rm(root, { recursive: true, force: true });
  const store = new ArtifactStore(root); await store.init("Workspace test", "workspace_project");
  await store.write({ id: "deck", kind: "deck", payload: initialDeck, producer: { type: "deterministic" } });
  return new PitchWorkspaceService(root);
}
function text(state: any): string { return state.deck.slides[0].scene[0].paragraphs[0].runs[0].text; }

async function replace(service: PitchWorkspaceService, value: string) {
  const current = await service.state();
  return service.mutate({ expectedDeckHash: current.deckHash, reason: `Edit to ${value}`, operations: [{ op: "replaceText", slideId: "s1", elementId: "t1", paragraphs: [{ runs: [{ text: value, fontSizePt: 44, bold: true, color: "#111111" }] }] }] });
}

test("workspace mutation persists a new deck version and recalculates QA", async () => {
  const service = await setup(); const after = await replace(service, "Approve phase three");
  assert.equal(text(after), "Approve phase three");
  const head = Object.values(after.manifest.branches[after.manifest.activeBranchId].heads).find((h: any) => h.kind === "deck") as any;
  assert.equal(head.version, 2); assert.equal(after.history.canUndo, true);
});

test("workspace Pro Editor command persists one version with Auto Layout reflow", async () => {
  const service = await setup(autoLayoutDeck());
  const before = await service.state();
  const after = await service.editorCommand({
    command: "delete",
    slideId: "s1",
    selectedIds: ["a"],
    expectedDeckHash: before.deckHash,
  });
  const frame = after.deck.slides[0].scene.find((element: any) => element.id === "frame");
  const b = after.deck.slides[0].scene.find((element: any) => element.id === "b");
  assert(frame && frame.type === "frame");
  assert.deepEqual(frame.childIds, ["b"]);
  assert(b);
  assert.equal(b.geometry.x, 120);
  assert.equal(b.geometry.y, 120);
  assert.deepEqual(after.nextSelectionIds, []);
  assert.deepEqual(after.reflowedContainerIds, ["frame"]);
  const head = Object.values(after.manifest.branches[after.manifest.activeBranchId].heads).find((h: any) => h.kind === "deck") as any;
  assert.equal(head.version, 2);
  assert.equal(after.history.canUndo, true);
});

test("workspace copy is non-mutating and paste deep-clones hierarchy in one version", async () => {
  const service = await setup(autoLayoutDeck());
  const before = await service.state();
  const copied = await service.editorCommand({
    command: "copy",
    slideId: "s1",
    selectedIds: ["frame"],
    expectedDeckHash: before.deckHash,
  });
  assert(copied.clipboard);
  assert.deepEqual(copied.clipboard.rootIds, ["frame"]);
  assert.equal(copied.clipboard.elements.length, 3);
  assert.equal(copied.deckHash, before.deckHash);
  const headAfterCopy = Object.values(copied.manifest.branches[copied.manifest.activeBranchId].heads).find((h: any) => h.kind === "deck") as any;
  assert.equal(headAfterCopy.version, 1);

  const pasted = await service.editorCommand({
    command: "paste",
    slideId: "s1",
    clipboard: copied.clipboard,
    offsetDU: 32,
    expectedDeckHash: copied.deckHash,
  });
  assert.equal(pasted.nextSelectionIds.length, 1);
  assert.notEqual(pasted.nextSelectionIds[0], "frame");
  const pastedFrame = pasted.deck.slides[0].scene.find((element: any) => element.id === pasted.nextSelectionIds[0]);
  assert(pastedFrame && pastedFrame.type === "frame");
  assert.equal(pastedFrame.childIds.length, 2);
  assert(pastedFrame.childIds.every((id: string) => id !== "a" && id !== "b"));
  const headAfterPaste = Object.values(pasted.manifest.branches[pasted.manifest.activeBranchId].heads).find((h: any) => h.kind === "deck") as any;
  assert.equal(headAfterPaste.version, 2);
});

test("workspace branch edit remains isolated from main", async () => {
  const service = await setup(); const forked = await service.fork("CFO"); const forkId = forked.manifest.activeBranchId;
  const after = await replace(service, "Protect margin first"); assert.equal(after.manifest.activeBranchId, forkId);
  await service.checkout("branch_main"); assert.equal(text(await service.state()), "Approve phase two");
  await service.checkout(forkId); assert.equal(text(await service.state()), "Protect margin first");
});

test("undo redo follows only the active branch history", async () => {
  const service = await setup();
  await replace(service, "Main second state");
  const forked = await service.fork("CFO"); const forkId = forked.manifest.activeBranchId;
  await replace(service, "CFO state"); assert.equal(text(await service.state()), "CFO state");
  assert.equal(text(await service.undo()), "Main second state");
  assert.equal(text(await service.redo()), "CFO state");
  await service.checkout("branch_main"); assert.equal(text(await service.state()), "Main second state");
  await service.checkout(forkId); assert.equal(text(await service.state()), "CFO state");
});

test("workspace production-export gate returns a ready editable PPTX manifest", async () => {
  const service = await setup();
  const exported = await service.exportPptx();
  assert.equal(exported.manifest.slideCount, 1);
  assert.equal(exported.manifest.ready, true);
  assert.equal(exported.manifest.editability.unsupported, 0);
  assert.equal(exported.manifest.editability.native, 1);
  assert.equal(exported.manifest.roundTripIssues.some((issue) => issue.severity === "critical"), false);
  assert.match(exported.path, /\.pptx$/);
});
