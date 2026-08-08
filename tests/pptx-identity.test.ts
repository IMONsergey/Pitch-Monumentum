import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { exportProductionPptx } from "../packages/export-pipeline/src/index.js";
import { pitchIdFromDescription } from "../packages/pptx-identity/src/index.js";
import { readZipMap } from "../packages/source-ingest/src/zip.js";

function fixture(): DeckDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: "0.1",
    id: "identity_deck",
    title: "Identity",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b",
    narrativeId: "n",
    designSystemId: "d",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: now,
    updatedAt: now,
    slides: [{
      id: "s1",
      order: 0,
      title: "Identity",
      archetype: "freeform",
      semantic: {
        purpose: "test",
        takeaway: "test",
        questionAnswered: "test",
        narrativeRole: "test",
        claimIds: [],
        evidenceRefs: [],
        audienceRelevance: "test",
        density: "sparse",
      },
      scene: [
        {
          id: "shape_left",
          type: "shape",
          name: "Rectangle",
          semanticRole: "visual",
          geometry: { x: 100, y: 120, width: 320, height: 180 },
          zIndex: 1,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          shape: "rect",
          fill: "#FF0000",
        },
        {
          id: "shape_right",
          type: "shape",
          name: "Rectangle",
          semanticRole: "visual",
          geometry: { x: 600, y: 120, width: 320, height: 180 },
          zIndex: 2,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          shape: "rect",
          fill: "#00FF00",
        },
        {
          id: "line_1",
          type: "line",
          name: "Connector",
          semanticRole: "visual",
          geometry: { x: 200, y: 500, width: 700, height: 1 },
          zIndex: 3,
          origin: "user",
          exportStrategy: "native",
          dependencies: [],
          start: [0, 0],
          end: [700, 0],
          stroke: { color: "#112233", widthDU: 3 },
          endMarker: "arrow",
        },
      ],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

test("PPTX keeps user layer names while embedding stable Pitch ids", async () => {
  const output = "/tmp/pitch-stable-identity.pptx";
  await rm(output, { force: true });
  const manifest = await exportProductionPptx(fixture(), output);
  assert.equal(manifest.ready, true, JSON.stringify(manifest.roundTripIssues));

  const entries = readZipMap(await readFile(output));
  const xml = entries.get("ppt/slides/slide1.xml")?.toString("utf8") ?? "";
  assert.equal((xml.match(/name="Rectangle"/g) ?? []).length, 2, "duplicate user-visible layer names must be preserved");
  assert.match(xml, /descr="pitch:id:shape_left"/);
  assert.match(xml, /descr="pitch:id:shape_right"/);
  assert.match(xml, /descr="pitch:id:line_1"/);
  assert.equal(xml.includes("__pitch_scene_id__"), false, "compile-only identity markers must not leak into final PPTX");
});

test("Pitch identity description parser is deterministic", () => {
  assert.equal(pitchIdFromDescription("pitch:id:shape_left"), "shape_left");
  assert.equal(pitchIdFromDescription("other:value"), undefined);
  assert.equal(pitchIdFromDescription(undefined), undefined);
});
