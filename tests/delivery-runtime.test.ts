import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { DeliveryRuntime } from "../apps/delivery/src/runtime.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "deck_delivery",
    title: "Delivery",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief",
    narrativeId: "narrative",
    designSystemId: "design",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{
      id: "s1",
      order: 0,
      title: "Delivery slide",
      archetype: "closing",
      semantic: { purpose: "Conclude", takeaway: "Delivery is ready", questionAnswered: "What is delivered?", narrativeRole: "closing", claimIds: [], evidenceRefs: [], audienceRelevance: "All", density: "sparse" },
      scene: [
        { id: "title", type: "text", paragraphs: [{ runs: [{ text: "Delivery is ready", fontFamily: "Inter", fontSizePt: 44, color: "#111111", bold: true }] }], semanticRole: "title", geometry: { x: 160, y: 180, width: 1280, height: 160 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
        { id: "body", type: "text", paragraphs: [{ runs: [{ text: "Editable outputs use the same canonical project.", fontFamily: "Inter", fontSizePt: 24, color: "#444444" }] }], semanticRole: "body", geometry: { x: 160, y: 390, width: 1120, height: 140 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [] },
      ],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-delivery-runtime-"));
  const store = new ArtifactStore(root);
  await store.init("Delivery", "delivery_project");
  await store.write({ id: "deck", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
  return { root, delivery: new DeliveryRuntime(root, { platform: "linux" }), async close() { await rm(root, { recursive: true, force: true }); } };
}

test("Delivery preflight exposes format readiness and does not pretend Keynote works off macOS", async () => {
  const h = await setup();
  try {
    const preflight = await h.delivery.preflight();
    assert.equal(preflight.deckId, "deck_delivery");
    assert.equal(preflight.missingAssetIds.length, 0);
    assert.equal(preflight.formats.keynote.ready, false);
    assert(preflight.formats.keynote.blockers.some((blocker) => blocker.includes("macOS") || blocker.includes("Keynote")));
    assert.equal(preflight.reviewGate.ready, true);
  } finally { await h.close(); }
});

test("Figma Bridge and Standalone Web delivery write self-contained inspectable artifacts when preflight is ready", async () => {
  const h = await setup();
  try {
    const preflight = await h.delivery.preflight();
    if (!preflight.formats.figma.ready || !preflight.formats.web.ready) {
      assert.fail(`Fixture unexpectedly blocked by preflight: ${JSON.stringify({ figma: preflight.formats.figma, web: preflight.formats.web })}`);
    }
    const figma = await h.delivery.exportFigma();
    const web = await h.delivery.exportWeb();
    for (const artifact of [figma.artifact, web.artifact]) {
      assert(artifact.bytes > 0);
      assert.equal(artifact.filesystemKind, "file");
      assert.equal(artifact.fileCount, 1);
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    }
    assert.match(figma.artifact.filename, /figma-bridge\.json$/);
    assert.match(web.artifact.filename, /standalone\.html$/);
    const bridge = JSON.parse(await readFile(figma.artifact.path, "utf8"));
    assert.equal(bridge.kind, "pitch-figma-bridge");
    assert.equal(bridge.slides[0].nodes[0].pitchId, "title");
    const html = await readFile(web.artifact.path, "utf8");
    assert.match(html, /data-pitch-id="title"/);
    assert.equal(html.includes("/api/assets"), false);
  } finally { await h.close(); }
});

test("blocking review prevents Delivery Center exports before any output is generated", async () => {
  const h = await setup();
  try {
    const review = await h.delivery.review.state();
    await h.delivery.review.command({
      command: "addThread",
      threadId: "block_delivery",
      anchor: { scope: "slide", slideId: "s1" },
      type: "changeRequest",
      priority: "blocking",
      body: "Do not deliver until reviewed.",
      author: { kind: "user", id: "reviewer", displayName: "Reviewer" },
      expectedDeckHash: review.deckHash,
    });
    const preflight = await h.delivery.preflight();
    assert.equal(preflight.reviewGate.ready, false);
    assert.equal(preflight.formats.web.ready, false);
    assert.equal(preflight.formats.figma.ready, false);
    await assert.rejects(() => h.delivery.exportWeb(), /WEB delivery is blocked/);
    await assert.rejects(() => h.delivery.exportFigma(), /FIGMA delivery is blocked/);
  } finally { await h.close(); }
});

test("missing canonical image bytes block media-bearing delivery formats before export", async () => {
  const h = await setup();
  try {
    const state = await h.delivery.service.state();
    const next = structuredClone(state.deck);
    next.slides[0].scene.push({ id: "missing_image", type: "image", assetId: "asset_missing0000000000000", fit: "cover", semanticRole: "visual", geometry: { x: 1350, y: 390, width: 360, height: 240 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset_missing0000000000000" }] } as any);
    await h.delivery.service.store.write({ id: "deck", kind: "deck", payload: next, producer: { type: "user" } });
    const preflight = await h.delivery.preflight();
    assert(preflight.missingAssetIds.includes("asset_missing0000000000000"));
    assert.equal(preflight.formats.web.ready, false);
    assert.equal(preflight.formats.figma.ready, false);
  } finally { await h.close(); }
});
