import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { createFigmaBridgeDocument } from "../packages/figma-bridge/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck_figma", title: "Figma Bridge", canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" }, briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{ id: "s1", order: 0, title: "Bridge", archetype: "freeform", semantic: { purpose: "test", takeaway: "Editable", questionAnswered: "How?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [
      { id: "frame", type: "frame", childIds: ["title", "hero"], fill: "#FFFFFF", semanticRole: "visual", geometry: { x: 100, y: 100, width: 1500, height: 800 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [], tags: ["component:instance_a", "component-def:component_a"] },
      { id: "title", type: "text", groupId: "frame", paragraphs: [{ align: "left", lineSpacing: 1.2, spaceAfterPt: 8, runs: [{ text: "Pitch ", fontFamily: "Inter", fontSizePt: 42, color: "#111111" }, { text: "Bridge", fontFamily: "Inter", fontSizePt: 42, color: "#3366FF", bold: true }] }, { bullet: { level: 0, marker: "•" }, runs: [{ text: "Second paragraph", fontFamily: "Inter", fontSizePt: 20, color: "#444444" }] }], semanticRole: "title", geometry: { x: 180, y: 170, width: 900, height: 230 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], tokenBindings: { textColor: "text.primary" } } as any,
      { id: "hero", type: "image", groupId: "frame", assetId: "asset_img", fit: "cover", crop: { left: .1, top: .05, right: .1, bottom: .05 }, focalPoint: { x: .72, y: .4 }, clipShape: "roundRect", cornerRadiusDU: 24, semanticRole: "visual", geometry: { x: 180, y: 440, width: 800, height: 330 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset_img" }] } as any,
    ], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

test("Figma bridge retains editable node identity hierarchy rich text paragraph ranges and media treatment", () => {
  const bridge = createFigmaBridgeDocument(fixture(), { asset_img: { assetId: "asset_img", mimeType: "image/png", base64: "AA==", width: 1000, height: 600 } });
  assert.equal(bridge.kind, "pitch-figma-bridge");
  assert.equal(bridge.slides.length, 1);
  const frame = bridge.slides[0].nodes.find((node) => node.pitchId === "frame")!;
  const title = bridge.slides[0].nodes.find((node) => node.pitchId === "title")!;
  const hero = bridge.slides[0].nodes.find((node) => node.pitchId === "hero")!;
  assert.deepEqual(frame.childIds, ["title", "hero"]);
  assert.equal(frame.componentInstanceId, "instance_a");
  assert.equal(frame.componentId, "component_a");
  assert.equal(title.payload.characters, "Pitch Bridge\nSecond paragraph");
  assert.equal((title.payload.ranges as any[]).length, 3);
  const paragraphs = title.payload.paragraphs as any[];
  assert.deepEqual({ start: paragraphs[0].start, end: paragraphs[0].end }, { start: 0, end: 12 });
  assert.deepEqual({ start: paragraphs[1].start, end: paragraphs[1].end }, { start: 13, end: 29 });
  assert.equal(paragraphs[0].lineSpacing, 1.2);
  assert.equal(paragraphs[0].spaceAfterPt, 8);
  assert.deepEqual(paragraphs[1].bullet, { level: 0, marker: "•" });
  assert.deepEqual(title.tokenBindings, { textColor: "text.primary" });
  assert.equal(hero.payload.assetId, "asset_img");
  assert.deepEqual(hero.payload.focalPoint, { x: .72, y: .4 });
  assert.equal(hero.payload.clipShape, "roundRect");
  assert.equal(bridge.assets.asset_img.base64, "AA==");
  assert(bridge.warnings.some((warning) => warning.includes("hero") && warning.includes("crop/focal metadata")));
});

test("pathData-only custom vectors are materialized into importer-ready SVG paths", () => {
  const deck = fixture();
  deck.slides[0].scene.push({
    id: "vector", type: "shape", shape: "custom", fill: "#00AA88", semanticRole: "visual",
    geometry: { x: 1050, y: 160, width: 300, height: 220 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [],
    pathData: { fillRule: "evenodd", commands: [
      { command: "M", x: 0, y: 0 },
      { command: "L", x: 120, y: 0 },
      { command: "Q", x1: 170, y1: 70, x: 120, y: 150 },
      { command: "Z" },
    ] },
  } as any);
  const bridge = createFigmaBridgeDocument(deck, { asset_img: { assetId: "asset_img", mimeType: "image/png", base64: "AA==" } });
  const vector = bridge.slides[0].nodes.find((node) => node.pitchId === "vector")!;
  assert.equal(vector.payload.svgPath, "M0 0 L120 0 Q170 70 120 150 Z");
  assert.deepEqual((vector.payload.pathData as any).fillRule, "evenodd");
});

test("bridge warns instead of silently flattening structured chart/table/diagram and unsupported image parity", () => {
  const deck = fixture();
  deck.slides[0].scene.push(
    { id: "table", type: "table", rows: [[{ text: "A" }]], semanticRole: "table", geometry: { x: 1000, y: 350, width: 500, height: 250 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [] } as any,
    { id: "ellipse_image", type: "image", assetId: "asset_img", fit: "stretch", clipShape: "ellipse", semanticRole: "visual", geometry: { x: 1050, y: 650, width: 300, height: 180 }, zIndex: 5, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset_img" }] } as any,
  );
  const bridge = createFigmaBridgeDocument(deck, { asset_img: { assetId: "asset_img", mimeType: "image/png", base64: "AA==" } });
  assert(bridge.warnings.some((warning) => warning.includes("table") && warning.includes("structured bridge data")));
  assert(bridge.warnings.some((warning) => warning.includes("ellipse_image") && warning.includes("non-square ellipse")));
  assert(bridge.warnings.some((warning) => warning.includes("ellipse_image") && warning.includes("stretch image fit")));
});
