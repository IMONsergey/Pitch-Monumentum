import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import type { MotionDocument } from "../packages/motion-engine/src/index.js";
import { exportStandaloneWeb } from "../packages/web-export/src/index.js";

function fixture(): DeckDocument {
  return {
    schemaVersion: "0.1",
    id: "deck_web",
    title: "Standalone Web",
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
      title: "Web slide",
      archetype: "freeform",
      semantic: { purpose: "test", takeaway: "Self contained", questionAnswered: "How?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" },
      scene: [
        { id: "title", type: "text", paragraphs: [{ runs: [{ text: "Web export", fontFamily: "Inter", fontSizePt: 42, color: "#111111", bold: true }] }], semanticRole: "title", geometry: { x: 120, y: 100, width: 1000, height: 160 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] },
        { id: "hero", type: "image", assetId: "asset_hero", fit: "cover", crop: { left: .1, top: .05, right: .1, bottom: .05 }, focalPoint: { x: .7, y: .4 }, clipShape: "roundRect", cornerRadiusDU: 24, alt: "Hero", semanticRole: "visual", geometry: { x: 120, y: 330, width: 900, height: 560 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset_hero" }] } as any,
      ],
      speakerNotes: "Speaker-only note",
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };
}

function motion(): MotionDocument {
  return {
    schemaVersion: "0.1",
    deckId: "deck_web",
    slides: [{
      slideId: "s1",
      builds: [{ id: "build_1", kind: "entrance", effect: "fade", trigger: "onClick", elementIds: ["title"], durationMs: 350, delayMs: 0 }],
      tracks: [{ id: "track_1", slideId: "s1", elementId: "hero", property: "x", enabled: true, keyframes: [{ timeMs: 0, value: 120 }, { timeMs: 800, value: 500 }] }],
    }],
  };
}

test("standalone Web output embeds image bytes and contains no project API asset dependency", () => {
  const result = exportStandaloneWeb(fixture(), {
    asset_hero: { assetId: "asset_hero", mimeType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" },
  }, motion());
  assert.match(result.html, /data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/);
  assert.equal(result.html.includes("/api/assets"), false);
  assert.equal(result.html.includes("asset_hero/content"), false);
  assert.match(result.html, /data-pitch-id="title"/);
  assert.match(result.html, /data-pitch-id="hero"/);
  assert.match(result.html, /Speaker-only note/);
  assert.match(result.html, /@media print/);
  assert.match(result.html, /build_1/);
  assert(result.warnings.some((warning) => warning.includes("keyframe tracks")));
});

test("missing embedded image bytes are explicit warnings rather than silent remote fallbacks", () => {
  const result = exportStandaloneWeb(fixture(), {}, undefined);
  assert(result.warnings.some((warning) => warning.includes("missing embedded asset asset_hero")));
  assert.equal(result.html.includes("http://"), false);
  assert.equal(result.html.includes("https://"), false);
});

test("basic click-build semantics are compiled into the self-contained player", () => {
  const result = exportStandaloneWeb(fixture(), { asset_hero: { assetId: "asset_hero", mimeType: "image/jpeg", base64: "AA==" } }, motion());
  assert.match(result.html, /pitch-build-hidden/);
  assert.match(result.html, /function compile\(builds\)/);
  assert.match(result.html, /b\.trigger==='onClick'/);
  assert.match(result.html, /ArrowRight/);
  assert.match(result.html, /PageDown/);
});

test("Web renderer uses canonical duPerInch and preserves rich visual primitives", () => {
  const deck = fixture();
  deck.canvas = { widthDU: 1440, heightDU: 900, duPerInch: 144, aspectRatio: "custom" };
  deck.slides[0].scene = [
    {
      id: "rich_text", type: "text", semanticRole: "body", geometry: { x: 40, y: 50, width: 800, height: 240 }, zIndex: 1,
      origin: "user", exportStrategy: "native", dependencies: [], verticalAlign: "middle", insetsDU: [12, 24, 18, 30],
      paragraphs: [{ align: "left", bullet: { level: 1, marker: "→" }, spaceBeforePt: 6, spaceAfterPt: 9, runs: [{ text: "Canonical scale", fontFamily: "IBM Plex Sans", fontSizePt: 72, letterSpacingPt: 1.5, color: "#112233", bold: true }] }],
    } as any,
    {
      id: "gradient", type: "shape", shape: "roundRect", semanticRole: "visual", geometry: { x: 40, y: 330, width: 500, height: 240 }, zIndex: 2,
      origin: "user", exportStrategy: "native", dependencies: [], radiusDU: 24,
      fillPaint: { kind: "linearGradient", angleDeg: 90, stops: [{ position: 0, color: "#FF0000" }, { position: 1, color: "#0000FF", opacity: .5 }] },
      effects: [{ kind: "dropShadow", color: "#000000", opacity: .35, blurDU: 16, offsetXDU: 6, offsetYDU: 10 }],
    } as any,
    {
      id: "vector", type: "shape", shape: "custom", semanticRole: "visual", geometry: { x: 600, y: 330, width: 300, height: 240 }, zIndex: 3,
      origin: "user", exportStrategy: "native", dependencies: [], fill: "#22AA77",
      pathData: { fillRule: "evenodd", commands: [
        { command: "M", x: 0, y: 0 },
        { command: "L", x: 120, y: 0 },
        { command: "Q", x1: 170, y1: 80, x: 120, y: 160 },
        { command: "C", x1: 80, y1: 210, x2: 30, y2: 190, x: 0, y: 120 },
        { command: "Z" },
      ] },
    } as any,
  ];

  const result = exportStandaloneWeb(deck, {});
  assert.match(result.html, /width:1440px;height:900px/);
  assert.match(result.html, /font-size:144px/); // 72pt × 144DU/in ÷ 72pt/in
  assert.match(result.html, /letter-spacing:3px/);
  assert.match(result.html, /padding:12px 24px 18px 30px/);
  assert.match(result.html, /→/);
  assert.match(result.html, /linear-gradient\(90deg/);
  assert.match(result.html, /drop-shadow\(6px 10px 16px rgba\(0,0,0,0\.35\)\)/);
  assert.match(result.html, /d="M0 0 L120 0 Q170 80 120 160 C80 210 30 190 0 120 Z"/);
  assert.match(result.html, /fill-rule="evenodd"/);
});
