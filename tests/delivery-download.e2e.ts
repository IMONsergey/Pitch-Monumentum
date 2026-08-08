import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { createDeliveryWorkspaceServer } from "../apps/workspace/src/delivery-server.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "delivery_download", title: "Download",
    canvas: { widthDU: 1200, heightDU: 750, duPerInch: 120, aspectRatio: "custom" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Download", archetype: "freeform", semantic: { purpose: "test", takeaway: "Download", questionAnswered: "?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [
      { id: "title", type: "text", paragraphs: [{ runs: [{ text: "Download", fontSizePt: 36 }] }], semanticRole: "title", geometry: { x: 100, y: 100, width: 600, height: 100 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pitch-delivery-download-"));
  const store = new ArtifactStore(root);
  await store.init("Download", "download_project");
  await store.write({ id: "deck", kind: "deck", payload: deck(), producer: { type: "deterministic" } });
  const created = createDeliveryWorkspaceServer(root);
  await new Promise<void>((resolve) => created.server.listen(0, "127.0.0.1", resolve));
  const address = created.server.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  return { root, base, async close() { await new Promise<void>((resolve, reject) => created.server.close((error) => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); } };
}

async function exportWeb(base: string): Promise<any> {
  const response = await fetch(`${base}/api/delivery-export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formats: ["web"] }) });
  if (response.status !== 200) assert.fail(`Delivery export failed (${response.status}): ${await response.text()}`);
  return response.json();
}

test("browser download requires current manifest snapshot and exact artifact bytes", async () => {
  const h = await setup();
  try {
    let manifest = await exportWeb(h.base);
    let artifact = manifest.artifacts.find((item: any) => item.format === "web");
    assert(artifact);

    let response = await fetch(`${h.base}/api/delivery-download?file=${encodeURIComponent(artifact.filename)}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /data-pitch-id="title"/);

    const reviewState = await fetch(`${h.base}/api/review-state`).then((item) => item.json());
    response = await fetch(`${h.base}/api/review-command`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        command: "addThread", threadId: "after_export", anchor: { scope: "slide", slideId: "s1" }, type: "comment", priority: "normal", body: "Review changed after export", author: { kind: "user", id: "reviewer", displayName: "Reviewer" }, expectedDeckHash: reviewState.deckHash, expectedReviewHash: reviewState.reviewHash,
      }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${h.base}/api/delivery-download?file=${encodeURIComponent(artifact.filename)}`);
    assert.equal(response.status, 409);
    assert.match(await response.text(), /stale project\/review\/motion snapshot/);

    manifest = await exportWeb(h.base);
    artifact = manifest.artifacts.find((item: any) => item.format === "web");
    await writeFile(artifact.path, "tampered output", "utf8");
    response = await fetch(`${h.base}/api/delivery-download?file=${encodeURIComponent(artifact.filename)}`);
    assert.equal(response.status, 409);
    assert.match(await response.text(), /bytes no longer match/);

    response = await fetch(`${h.base}/api/delivery-download?file=${encodeURIComponent("../manifest.json")}`);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Invalid delivery artifact filename/);
  } finally { await h.close(); }
});
