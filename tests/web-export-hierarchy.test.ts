import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { exportStandaloneWeb } from "../packages/web-export/src/index.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck_hierarchy", title: "Hierarchy",
    canvas: { widthDU: 1000, heightDU: 700, duPerInch: 100, aspectRatio: "custom" },
    briefId: "b", narrativeId: "n", designSystemId: "d", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z",
    slides: [{ id: "s1", order: 0, title: "Nested", archetype: "freeform", semantic: { purpose: "test", takeaway: "Nested", questionAnswered: "?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [
      { id: "frame", type: "frame", childIds: ["group"], clipContent: true, fill: "#FFFFFF", semanticRole: "other", geometry: { x: 100, y: 80, width: 500, height: 360 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "group", type: "group", childIds: ["child"], semanticRole: "other", geometry: { x: 150, y: 120, width: 300, height: 220 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [] },
      { id: "child", type: "shape", shape: "rect", fill: "#FF0000", groupId: "group", semanticRole: "visual", geometry: { x: 190, y: 150, width: 160, height: 100 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [] },
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

test("frames and groups become real nested DOM containers with relative child geometry", () => {
  const result = exportStandaloneWeb(deck(), {});
  const frameStart = result.html.indexOf('data-pitch-id="frame"');
  const groupStart = result.html.indexOf('data-pitch-id="group"');
  const childStart = result.html.indexOf('data-pitch-id="child"');
  assert(frameStart >= 0 && groupStart > frameStart && childStart > groupStart);
  const frameFragment = result.html.slice(frameStart, childStart + 500);
  assert.match(frameFragment, /left:100px;top:80px/);
  assert.match(frameFragment, /overflow:hidden/);
  assert.match(frameFragment, /data-pitch-id="group"[^>]*style="[^"]*left:50px;top:40px/);
  assert.match(frameFragment, /data-pitch-id="child"[^>]*style="[^"]*left:40px;top:30px/);
  assert.equal((result.html.match(/data-pitch-id="child"/g) ?? []).length, 1, "nested children must not also render as slide roots");
});
