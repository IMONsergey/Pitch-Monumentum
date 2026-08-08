import test from "node:test";
import assert from "node:assert/strict";
import { compileTemplateDesignSystem } from "../packages/template-intelligence/src/design-system.js";
import type { TemplateIntelligence } from "../packages/template-intelligence/src/index.js";

function intelligence(): TemplateIntelligence {
  return {
    schemaVersion: "0.1",
    sourceHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    canvas: { widthDU: 1920, heightDU: 1080, aspectRatio: 16 / 9 },
    theme: {
      name: "Corporate",
      colors: [
        { role: "dk1", hex: "#111111" },
        { role: "lt1", hex: "#FFFFFF" },
        { role: "dk2", hex: "#475467" },
        { role: "lt2", hex: "#F2F4F7" },
        { role: "accent1", hex: "#335CFF" },
        { role: "accent2", hex: "#14B8A6" },
      ],
      fonts: { majorLatin: "Brand Display", minorLatin: "Brand Sans" },
    },
    styleStats: {
      fontSizesPt: [{ value: 44, count: 4 }, { value: 28, count: 6 }, { value: 18, count: 20 }, { value: 12, count: 10 }],
      colors: [{ value: "#335CFF", count: 8 }, { value: "#111111", count: 30 }, { value: "#F59E0B", count: 3 }],
      textAlignments: [{ value: "l", count: 24 }],
    },
    layouts: [
      { signature: "hero123", count: 4, slideNumbers: [1, 4, 8, 12], objectCount: 3, kinds: { shape: 2, image: 1 }, normalizedGeometry: ["shape:0.1,0.1,0.6,0.2"] },
      { signature: "chart456", count: 2, slideNumbers: [3, 9], objectCount: 5, kinds: { shape: 3, graphic: 1, image: 1 }, normalizedGeometry: ["graphic:0.1,0.3,0.8,0.5"] },
    ],
    recommendations: {
      primaryFonts: ["Brand Display", "Brand Sans"],
      palette: ["#335CFF", "#111111", "#F59E0B"],
      typeScalePt: [44, 28, 18, 12],
      dominantLayoutSignatures: ["hero123", "chart456"],
    },
  };
}

test("template compiler maps brand palette, fonts, type scale and layouts into DesignSystem", () => {
  const candidate = compileTemplateDesignSystem(intelligence(), "Corporate imported");
  assert.equal(candidate.designSystem.id, "design_template_0123456789abcdef");
  assert.equal(candidate.designSystem.name, "Corporate imported");
  assert.equal(candidate.designSystem.tokens.colors.canvas, "#FFFFFF");
  assert.equal(candidate.designSystem.tokens.colors.primaryText, "#111111");
  assert.equal(candidate.designSystem.tokens.colors.accent, "#335CFF");
  assert.equal(candidate.designSystem.tokens.colors.accent2, "#14B8A6");
  assert.equal(candidate.designSystem.tokens.fonts.display, "Brand Display");
  assert.equal(candidate.designSystem.tokens.fonts.body, "Brand Sans");
  assert.equal(candidate.designSystem.tokens.typeScalePt.display, 44);
  assert.equal(candidate.designSystem.tokens.typeScalePt.body, 18);
  assert(candidate.designSystem.recipeIds.some((id) => id.endsWith(":hero123")));
  assert(candidate.designSystem.recipeIds.some((id) => id.endsWith(":chart456")));
  assert(candidate.confidence.palette > 0.5);
  assert(candidate.confidence.typography >= 1);
  assert(candidate.confidence.layout > 0.8);
});

test("template compiler is deterministic and exposes explicit uncertainty notes", () => {
  const sparse = intelligence();
  sparse.theme.fonts = {};
  sparse.recommendations.primaryFonts = [];
  sparse.recommendations.dominantLayoutSignatures = [];
  sparse.styleStats.fontSizesPt = [];
  sparse.layouts = [{ ...sparse.layouts[0], count: 1, slideNumbers: [1] }];
  const first = compileTemplateDesignSystem(sparse);
  const second = compileTemplateDesignSystem(sparse);
  assert.deepEqual(first, second);
  assert.equal(first.designSystem.tokens.fonts.display, "Inter");
  assert(first.notes.some((note) => note.includes("font scheme")));
  assert(first.notes.some((note) => note.includes("No repeated slide layout")));
  assert(first.notes.some((note) => note.includes("No explicit text sizes")));
});
