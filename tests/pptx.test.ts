import test from "node:test";
import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import { compileDeckToPptx, duToEmu } from "../packages/pptx/src/index.js";
import { inspectPptx, validatePptxRoundTrip } from "../packages/pptx-roundtrip/src/index.js";
import type { DeckDocument } from "../packages/deck-model/src/index.js";

test("DU maps exactly to standard widescreen PowerPoint units", () => {
  assert.equal(duToEmu(1920), 12192000);
  assert.equal(duToEmu(1080), 6858000);
});

test("base compiler keeps rich text formatting in native DrawingML runs", async () => {
  const out = "/tmp/pitchos-minimal.pptx";
  await rm(out, { force: true });
  const now = new Date().toISOString();
  const deck: DeckDocument = {
    schemaVersion: "0.1",
    id: "d",
    title: "Native test",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 144, aspectRatio: "16:9" },
    briefId: "b",
    narrativeId: "n",
    designSystemId: "ds",
    sourceIds: [],
    claimIds: [],
    activeBranchId: "main",
    createdAt: now,
    updatedAt: now,
    slides: [{
      id: "s1",
      order: 0,
      title: "Slide",
      archetype: "thesis",
      semantic: {
        purpose: "p",
        takeaway: "Editable native text",
        questionAnswered: "q",
        narrativeRole: "r",
        claimIds: [],
        evidenceRefs: [],
        audienceRelevance: "a",
        density: "sparse",
      },
      scene: [
        {
          id: "bg",
          type: "shape",
          semanticRole: "decoration",
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          zIndex: 0,
          origin: "deterministic",
          exportStrategy: "native",
          dependencies: [],
          shape: "rect",
          fill: "#0D0E11",
        },
        {
          id: "t",
          type: "text",
          semanticRole: "title",
          geometry: { x: 150, y: 200, width: 1400, height: 300 },
          zIndex: 1,
          origin: "agent",
          exportStrategy: "native",
          dependencies: [],
          fitPolicy: "shrinkText",
          paragraphs: [{
            align: "right",
            lineSpacing: 1.15,
            spaceAfterPt: 8,
            runs: [
              { text: "Editable ", fontSizePt: 54, bold: true, color: "#FFFFFF", fontFamily: "Arial" },
              { text: "PitchOS text", fontSizePt: 54, underline: true, letterSpacingPt: 0.2, color: "#FFFFFF", fontFamily: "Arial" },
            ],
          }],
        },
      ],
      status: "draft",
      qaIssueIds: [],
      dependencyIds: [],
    }],
  };

  const result = await compileDeckToPptx(deck, out);
  assert.equal(result.slideCount, 1);
  assert.equal(result.elementResults.filter((item) => item.strategy === "native").length, 2);
  assert.ok((await stat(out)).size > 1000);

  const inspected = await inspectPptx(out);
  assert.equal(inspected.slides[0].textRuns.length, 2);
  assert.equal(inspected.slides[0].textRuns[0].bold, true);
  assert.equal(inspected.slides[0].textRuns[0].fontFamily, "Arial");
  assert.equal(inspected.slides[0].textRuns[1].underline, true);
  assert.equal(inspected.slides[0].textRuns[1].letterSpacingPt, 0.2);
  assert.equal(inspected.slides[0].textRuns[1].fontSizePt, 54);
  assert.equal(inspected.slides[0].textRuns[1].color, "#FFFFFF");

  const roundTrip = await validatePptxRoundTrip(deck, out);
  assert.equal(roundTrip.issues.filter((issue) => issue.kind === "textStyle").length, 0, JSON.stringify(roundTrip.issues));
});
