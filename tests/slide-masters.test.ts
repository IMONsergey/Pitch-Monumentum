import test from "node:test";
import assert from "node:assert/strict";
import type { ImageElement, SlideDocument } from "../packages/deck-model/src/index.js";
import { createSlideMasterFromSlide, recommendSlideMasters, slideMasterId, slidePlaceholderId, validateSlideMaster, type SlideMasterDefinition } from "../packages/slide-masters/src/index.js";
import { applySlideMasterSafely, switchSlideMaster } from "../packages/slide-masters/src/safe.js";
import { validateSceneHierarchy } from "../packages/mutations/src/index.js";

function semantics() { return { purpose: "test", takeaway: "test", questionAnswered: "test", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" as const }; }
function templateOne(): SlideDocument {
  return { id: "template1", order: 0, title: "Title + media", archetype: "freeform", semantic: semantics(), status: "draft", qaIssueIds: [], dependencyIds: [], scene: [
    { id: "bg", type: "shape", shape: "rect", fill: "#101214", semanticRole: "decoration", geometry: { x: 0, y: 0, width: 1920, height: 1080 }, zIndex: 0, origin: "user", exportStrategy: "native", dependencies: [] },
    { id: "title", type: "text", semanticRole: "title", geometry: { x: 120, y: 100, width: 1000, height: 150 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Master title", color: "#FFFFFF", fontSizePt: 54 }] }] },
    { id: "body", type: "text", semanticRole: "body", geometry: { x: 120, y: 300, width: 700, height: 400 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Master body", color: "#DDDDDD", fontSizePt: 24 }] }] },
    { id: "media", type: "image", assetId: "asset_master", fit: "cover", clipShape: "roundRect", cornerRadiusDU: 36, semanticRole: "visual", geometry: { x: 980, y: 220, width: 760, height: 640 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset_master" }] } as ImageElement,
  ] };
}
function contentSlide(): SlideDocument {
  return { id: "slide", order: 0, title: "Content", archetype: "freeform", semantic: semantics(), status: "draft", qaIssueIds: [], dependencyIds: [], scene: [
    { id: "title_content", type: "text", semanticRole: "title", geometry: { x: 300, y: 80, width: 1200, height: 180 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Actual title", color: "#111111", fontSizePt: 72 }] }] },
    { id: "body_content", type: "text", semanticRole: "body", geometry: { x: 300, y: 330, width: 1200, height: 220 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "Actual body copy", color: "#222222", fontSizePt: 28 }] }] },
    { id: "photo", type: "image", assetId: "asset_actual", fit: "contain", crop: { left: .1, top: .05, right: .05, bottom: .02 }, focalPoint: { x: .75, y: .35 }, semanticRole: "visual", geometry: { x: 200, y: 600, width: 500, height: 300 }, zIndex: 4, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "asset_actual" }] } as ImageElement,
    { id: "free", type: "shape", shape: "ellipse", fill: "#FF00AA", semanticRole: "decoration", geometry: { x: 1600, y: 80, width: 100, height: 100 }, zIndex: 9, origin: "user", exportStrategy: "native", dependencies: [] },
  ] };
}

test("master apply preserves content but adopts master geometry and media treatment", () => {
  const master = createSlideMasterFromSlide({ slide: templateOne(), widthDU: 1920, heightDU: 1080, name: "Title + media", masterId: "master_one" });
  validateSlideMaster(master);
  assert(master.placeholders.some(item => item.kind === "title"));
  assert(master.placeholders.some(item => item.kind === "image"));
  const applied = applySlideMasterSafely(contentSlide(), master, { instanceId: "layout_one" });
  validateSceneHierarchy(applied.slide.scene);
  const title = applied.slide.scene.find(element => slidePlaceholderId(element) === "placeholder_title") as any;
  assert.equal(title.paragraphs[0].runs[0].text, "Actual title");
  assert.deepEqual(title.geometry, templateOne().scene.find(element => element.id === "title")!.geometry);
  const image = applied.slide.scene.find(element => slidePlaceholderId(element) === "placeholder_media") as any;
  assert.equal(image.assetId, "asset_actual");
  assert.deepEqual(image.crop, { left: .1, top: .05, right: .05, bottom: .02 });
  assert.deepEqual(image.focalPoint, { x: .75, y: .35 });
  assert.equal(image.fit, "cover");
  assert.equal(image.clipShape, "roundRect");
  assert.equal(image.cornerRadiusDU, 36);
  assert(applied.slide.scene.some(element => element.id === "free"));
});

test("switching to a structurally different master preserves old placeholder content", () => {
  const master1 = createSlideMasterFromSlide({ slide: templateOne(), widthDU: 1920, heightDU: 1080, name: "One", masterId: "master_one" });
  const first = applySlideMasterSafely(contentSlide(), master1, { instanceId: "first" });
  const template2: SlideDocument = { id: "template2", order: 0, title: "Two columns", archetype: "freeform", semantic: semantics(), status: "draft", qaIssueIds: [], dependencyIds: [], scene: [
    { id: "background2", type: "shape", shape: "rect", fill: "#F5F0E8", semanticRole: "decoration", geometry: { x: 0, y: 0, width: 1920, height: 1080 }, zIndex: 0, origin: "user", exportStrategy: "native", dependencies: [] },
    { id: "headline2", type: "text", semanticRole: "title", geometry: { x: 160, y: 120, width: 1600, height: 140 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "New master title" }] }] },
    { id: "copy2", type: "text", semanticRole: "body", geometry: { x: 980, y: 340, width: 700, height: 500 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [], paragraphs: [{ runs: [{ text: "New master body" }] }] },
    { id: "image2", type: "image", assetId: "master_two_asset", fit: "contain", clipShape: "ellipse", semanticRole: "visual", geometry: { x: 160, y: 340, width: 660, height: 560 }, zIndex: 2, origin: "user", exportStrategy: "native", dependencies: [{ kind: "asset", id: "master_two_asset" }] } as ImageElement,
  ] };
  const master2 = createSlideMasterFromSlide({ slide: template2, widthDU: 1920, heightDU: 1080, name: "Two", masterId: "master_two" });
  const second = switchSlideMaster(first.slide, master2, { instanceId: "second" });
  validateSceneHierarchy(second.slide.scene);
  const title = second.slide.scene.find(element => slidePlaceholderId(element) === "placeholder_headline2") as any;
  const body = second.slide.scene.find(element => slidePlaceholderId(element) === "placeholder_copy2") as any;
  const image = second.slide.scene.find(element => slidePlaceholderId(element) === "placeholder_image2") as any;
  assert.equal(title.paragraphs[0].runs[0].text, "Actual title");
  assert.equal(body.paragraphs[0].runs[0].text, "Actual body copy");
  assert.equal(image.assetId, "asset_actual");
  assert.equal(image.fit, "contain");
  assert.equal(image.clipShape, "ellipse");
  assert.equal(second.slide.scene.some(element => slideMasterId(element) === "master_one"), false);
});

test("safe apply repairs preserved nested hierarchy after a child becomes placeholder content", () => {
  const nested = contentSlide();
  const title = nested.scene.find(element => element.id === "title_content")!;
  title.groupId = "frame";
  nested.scene.push({ id: "frame", type: "frame", childIds: ["title_content"], fill: "#FFFFFF", semanticRole: "other", geometry: { x: 250, y: 40, width: 1300, height: 250 }, zIndex: 3, origin: "user", exportStrategy: "native", dependencies: [] });
  const master = createSlideMasterFromSlide({ slide: templateOne(), widthDU: 1920, heightDU: 1080, name: "Master", masterId: "master" });
  const applied = applySlideMasterSafely(nested, master, { instanceId: "safe" });
  validateSceneHierarchy(applied.slide.scene);
  const frame = applied.slide.scene.find(element => element.id === "frame") as any;
  assert(frame);
  assert.deepEqual(frame.childIds, []);
  const newTitle = applied.slide.scene.find(element => slidePlaceholderId(element) === "placeholder_title") as any;
  assert.equal(newTitle.paragraphs[0].runs[0].text, "Actual title");
});

test("smart recommendation prefers a master whose placeholders match slide content", () => {
  const titleMedia = createSlideMasterFromSlide({ slide: templateOne(), widthDU: 1920, heightDU: 1080, name: "Title Media", masterId: "title_media" });
  const textOnlyTemplate = templateOne(); textOnlyTemplate.scene = textOnlyTemplate.scene.filter(element => element.type !== "image");
  const textOnly = createSlideMasterFromSlide({ slide: textOnlyTemplate, widthDU: 1920, heightDU: 1080, name: "Text Only", masterId: "text_only" });
  const recommendations = recommendSlideMasters(contentSlide(), [textOnly, titleMedia]);
  assert.equal(recommendations[0].masterId, "title_media");
  assert(recommendations[0].score >= recommendations[1].score);
});
