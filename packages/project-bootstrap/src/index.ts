import { mkdir } from "node:fs/promises";
import { ArtifactStore } from "../../artifact-store/src/index.js";
import type { DeckDocument, DesignSystem, NarrativeGraph, PresentationBrief, SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import { runDeterministicQA } from "../../qa/src/index.js";

function text(id: string, value: string, x: number, y: number, width: number, height: number, size: number, color = "#F5F7FA", role: SceneElement["semanticRole"] = "body", bold = false): SceneElement {
  return {
    id,
    type: "text",
    semanticRole: role,
    geometry: { x, y, width, height },
    zIndex: 10,
    origin: "deterministic",
    exportStrategy: "native",
    dependencies: [],
    paragraphs: [{ runs: [{ text: value, fontFamily: "Inter", fontSizePt: size, color, bold }] }],
    fitPolicy: "shrinkText",
  };
}

function shape(id: string, x: number, y: number, width: number, height: number, fill: string, radiusDU = 28, zIndex = 1): SceneElement {
  return {
    id,
    type: "shape",
    semanticRole: "decoration",
    geometry: { x, y, width, height },
    zIndex,
    origin: "deterministic",
    exportStrategy: "native",
    dependencies: [],
    shape: radiusDU ? "roundRect" : "rect",
    fill,
    radiusDU,
  };
}

function slide(id: string, order: number, title: string, takeaway: string, scene: SceneElement[]): SlideDocument {
  return {
    id,
    order,
    title,
    archetype: order === 0 ? "cover" : "freeform",
    semantic: {
      purpose: order === 0 ? "Introduce the desktop preview" : "Demonstrate the current editor capability",
      takeaway,
      questionAnswered: order === 0 ? "What is this build?" : "What can the current build already do?",
      narrativeRole: order === 0 ? "opening" : "product proof",
      claimIds: [],
      evidenceRefs: [],
      audienceRelevance: "Pitch Monumentum product inspection",
      density: "sparse",
    },
    scene,
    speakerNotes: order === 0 ? "Desktop preview project generated locally on first launch." : undefined,
    status: "draft",
    qaIssueIds: [],
    dependencyIds: [],
  };
}

function previewDeck(now: string): DeckDocument {
  const background = (id: string) => shape(`${id}_bg`, 0, 0, 1920, 1080, "#090B0E", 0, 0);
  return {
    schemaVersion: "0.1",
    id: "deck_desktop_preview",
    title: "Pitch Monumentum — Desktop Preview",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "brief_desktop_preview",
    narrativeId: "narrative_desktop_preview",
    designSystemId: "design_desktop_preview",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "branch_main",
    createdAt: now,
    updatedAt: now,
    slides: [
      slide("desktop_01", 0, "Desktop Preview", "Pitch Monumentum is already a branch-safe professional scene editor with Codex parity.", [
        background("d1"),
        shape("d1_accent", 126, 126, 170, 12, "#C7FF5E", 6, 2),
        text("d1_kicker", "PITCH MONUMENTUM / DESKTOP PREVIEW", 126, 176, 1060, 58, 17, "#C7FF5E", "label", true),
        text("d1_title", "An AI-native presentation editor\nthat stays deeply editable.", 126, 300, 1480, 310, 57, "#F8FAFC", "title", true),
        text("d1_body", "SceneGraph canvas · professional transforms · rich text · vectors · auto layout · charts/tables · motion · components · native PPTX", 130, 704, 1460, 150, 24, "#AAB3BF", "body"),
        shape("d1_pill", 130, 914, 382, 62, "#171C22", 31, 3),
        text("d1_pill_text", "INTEL MAC DESKTOP BUILD", 164, 930, 330, 34, 14, "#E6EBF1", "label", true),
      ]),
      slide("desktop_02", 1, "Editor core", "Manual editing and Codex use the same canonical commands and version history.", [
        background("d2"),
        text("d2_kicker", "01 / EDITOR CORE", 124, 116, 500, 52, 16, "#7E8998", "label", true),
        text("d2_title", "The canvas is no longer a mockup.", 124, 206, 1420, 110, 48, "#F8FAFC", "title", true),
        shape("d2_a", 124, 404, 500, 420, "#11161C", 34, 2),
        shape("d2_b", 660, 404, 500, 420, "#11161C", 34, 2),
        shape("d2_c", 1196, 404, 600, 420, "#11161C", 34, 2),
        text("d2_a_t", "PRO EDITOR", 168, 454, 360, 50, 18, "#C7FF5E", "label", true),
        text("d2_a_b", "Move / resize / rotate\nSnap + guides\nLayers + grouping\nBranch-safe undo/redo", 168, 542, 370, 210, 24, "#D7DCE4"),
        text("d2_b_t", "DESIGN SYSTEM", 704, 454, 360, 50, 18, "#78A9FF", "label", true),
        text("d2_b_b", "Rich text\nGradients + shadows\nPen / Pencil vectors\nAuto Layout", 704, 542, 370, 210, 24, "#D7DCE4"),
        text("d2_c_t", "DATA + EXPORT", 1240, 454, 420, 50, 18, "#D9B8FF", "label", true),
        text("d2_c_b", "Native tables + charts\nStable object identity\nPPTX round-trip QA\nProduction export gates", 1240, 542, 450, 210, 24, "#D7DCE4"),
      ]),
      slide("desktop_03", 2, "Motion & components", "Motion and components are canonical project data, not temporary DOM decoration.", [
        background("d3"),
        text("d3_kicker", "02 / MOTION + COMPONENTS", 124, 116, 720, 52, 16, "#7E8998", "label", true),
        text("d3_title", "Build, animate, reuse, present.", 124, 206, 1420, 110, 48, "#F8FAFC", "title", true),
        shape("d3_card1", 124, 416, 770, 410, "#12181C", 42, 2),
        shape("d3_card2", 926, 416, 870, 410, "#12151D", 42, 2),
        text("d3_one", "MOTION STUDIO", 172, 468, 560, 48, 18, "#C7FF5E", "label", true),
        text("d3_one_b", "Transitions · click builds · entrance / emphasis / exit · exact keyframe tracks · independent motion history · presenter preview", 172, 558, 610, 170, 25, "#DDE2E8"),
        text("d3_two", "REUSABLE COMPONENTS", 978, 468, 620, 48, 18, "#78A9FF", "label", true),
        text("d3_two_b", "Create from selection · automatic text/image slots · instances · overrides · detach · branch-aware component artifacts", 978, 558, 670, 170, 25, "#DDE2E8"),
      ]),
      slide("desktop_04", 3, "What to inspect", "This DMG is an honest development preview of the editor foundation before the next asset-production milestone.", [
        background("d4"),
        text("d4_kicker", "03 / INSPECT THIS BUILD", 124, 116, 720, 52, 16, "#7E8998", "label", true),
        text("d4_title", "Open it. Break it. See what is real.", 124, 206, 1460, 110, 48, "#F8FAFC", "title", true),
        shape("d4_line", 124, 376, 1670, 2, "#252B33", 0, 2),
        text("d4_1", "01", 124, 438, 80, 60, 20, "#C7FF5E", "label", true),
        text("d4_1b", "Select objects and test the inspector, transforms, layers, grouping and typography.", 230, 432, 1370, 80, 26, "#E2E6EB"),
        text("d4_2", "02", 124, 570, 80, 60, 20, "#C7FF5E", "label", true),
        text("d4_2b", "Open Motion, add builds/keyframes and run Presenter from the current slide.", 230, 564, 1370, 80, 26, "#E2E6EB"),
        text("d4_3", "03", 124, 702, 80, 60, 20, "#C7FF5E", "label", true),
        text("d4_3b", "Create a reusable component, insert it again, then undo and branch the deck.", 230, 696, 1370, 80, 26, "#E2E6EB"),
        text("d4_footer", "Next milestone: real project asset library + generated/imported media production.", 124, 920, 1480, 60, 18, "#7E8998", "footer"),
      ]),
    ],
  };
}

export async function ensureDesktopPreviewProject(root: string): Promise<{ projectRoot: string; created: boolean }> {
  const store = new ArtifactStore(root);
  try {
    const manifest = await store.readManifest();
    const hasDeck = Object.values(manifest.branches[manifest.activeBranchId]?.heads ?? {}).some((head) => head.kind === "deck");
    if (hasDeck) return { projectRoot: root, created: false };
  } catch {}

  await mkdir(root, { recursive: true });
  await store.init("Pitch Monumentum Desktop Preview", "project_desktop_preview");
  const now = new Date().toISOString();
  const brief: PresentationBrief = {
    id: "brief_desktop_preview",
    language: "en",
    audience: "Pitch Monumentum product owner",
    communicationIntent: "Inspect the current desktop editor foundation",
    audienceOutcome: "Understand what is already real and editable",
    coreMessage: "Pitch Monumentum is becoming a professional AI-native presentation environment",
    deliveryContext: "local desktop development preview",
    sourceDivergence: "free product demo",
    readingMode: "balanced",
    pageBudget: { min: 4, target: 4, max: 4 },
    mustInclude: [],
    mustNotChange: [],
    brandConstraints: ["dark neutral UI", "lime product accent"],
    assumptions: [],
  };
  const narrative: NarrativeGraph = {
    id: "narrative_desktop_preview",
    nodes: [
      { id: "desktop_n1", kind: "claim", label: "The editor core is real" },
      { id: "desktop_n2", kind: "claim", label: "Motion and components are canonical" },
      { id: "desktop_n3", kind: "action", label: "Inspect the desktop build" },
    ],
    edges: [
      { id: "desktop_e1", from: "desktop_n1", to: "desktop_n2", kind: "follows" },
      { id: "desktop_e2", from: "desktop_n2", to: "desktop_n3", kind: "follows" },
    ],
    sectionOrder: [],
    rationale: "Product proof before roadmap",
  };
  const design: DesignSystem = {
    id: "design_desktop_preview",
    name: "Pitch Monumentum Desktop",
    tokens: {
      colors: { canvas: "#090B0E", accent: "#C7FF5E", blue: "#78A9FF", text: "#F8FAFC" },
      fonts: { display: "Inter", body: "Inter" },
      typeScalePt: { display: 57, title: 48, body: 25, label: 18 },
      spacingDU: { s: 12, m: 24, l: 48, xl: 96 },
    },
    grid: { marginXDU: 124, marginYDU: 96, columns: 12, gutterDU: 24 },
    chartRules: [],
    imageRules: [],
    iconRules: [],
    forbiddenTreatments: [],
    recipeIds: [],
  };

  const briefArtifact = await store.write({ id: brief.id, kind: "brief", payload: brief, producer: { type: "deterministic" } });
  const narrativeArtifact = await store.write({ id: narrative.id, kind: "narrative", payload: narrative, producer: { type: "deterministic" }, inputs: [briefArtifact] });
  const designArtifact = await store.write({ id: design.id, kind: "design", payload: design, producer: { type: "deterministic" }, inputs: [briefArtifact] });
  const deck = previewDeck(now);
  const deckArtifact = await store.write({ id: deck.id, kind: "deck", payload: deck, producer: { type: "deterministic" }, inputs: [narrativeArtifact, designArtifact] });
  const issues = runDeterministicQA(deck);
  await store.write({
    id: "qa_desktop_preview",
    kind: "qa",
    payload: { deckId: deck.id, issues },
    producer: { type: "deterministic" },
    inputs: [deckArtifact],
    status: issues.some((issue) => issue.severity === "critical") ? "needsReview" : "ready",
  });
  return { projectRoot: root, created: true };
}
