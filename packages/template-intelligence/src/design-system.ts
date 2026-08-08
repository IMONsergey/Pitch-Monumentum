import type { DesignSystem } from "../../deck-model/src/index.js";
import type { TemplateIntelligence } from "./index.js";

export interface TemplateDesignSystemCandidate {
  designSystem: DesignSystem;
  confidence: {
    palette: number;
    typography: number;
    layout: number;
  };
  sourceHash: string;
  notes: string[];
}

function themeColor(intelligence: TemplateIntelligence, role: string): string | undefined {
  return intelligence.theme.colors.find((item) => item.role === role)?.hex;
}

function palette(intelligence: TemplateIntelligence): Record<string, string> {
  const used = intelligence.recommendations.palette;
  const accentRoles = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
  const result: Record<string, string> = {
    canvas: themeColor(intelligence, "lt1") ?? "#FFFFFF",
    surface: themeColor(intelligence, "lt2") ?? "#F4F5F7",
    primaryText: themeColor(intelligence, "dk1") ?? "#111111",
    secondaryText: themeColor(intelligence, "dk2") ?? "#475467",
    accent: themeColor(intelligence, "accent1") ?? used[0] ?? "#335CFF",
  };
  accentRoles.slice(1).forEach((role, index) => {
    const value = themeColor(intelligence, role) ?? used[index + 1];
    if (value) result[`accent${index + 2}`] = value;
  });
  used.forEach((value, index) => {
    if (!Object.values(result).includes(value)) result[`observed${index + 1}`] = value;
  });
  return result;
}

function descendingUnique(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => b - a);
}

function nearest(values: number[], index: number, fallback: number): number {
  return values[Math.min(index, values.length - 1)] ?? fallback;
}

function typeScale(intelligence: TemplateIntelligence): Record<string, number> {
  const observed = descendingUnique(intelligence.recommendations.typeScalePt);
  const display = nearest(observed, 0, 48);
  const h1 = nearest(observed, 1, Math.min(display, 36));
  const h2 = nearest(observed, 2, Math.min(h1, 28));
  const body = nearest(observed, Math.max(0, observed.length - 2), 18);
  const small = nearest(observed, Math.max(0, observed.length - 1), Math.max(10, body - 4));
  return {
    display,
    h1,
    h2,
    h3: Math.max(body + 2, Math.min(h2, 22)),
    body,
    bodySmall: small,
    caption: Math.max(9, small - 2),
    metric: Math.max(display, 52),
    label: Math.max(9, Math.min(14, small)),
  };
}

function fonts(intelligence: TemplateIntelligence): Record<string, string> {
  const major = intelligence.theme.fonts.majorLatin?.trim();
  const minor = intelligence.theme.fonts.minorLatin?.trim();
  const observed = intelligence.recommendations.primaryFonts;
  const display = major || observed[0] || minor || "Inter";
  const body = minor || observed.find((font) => font !== display) || display;
  return { display, heading: display, body, metric: display, label: body };
}

function layoutRecipeIds(intelligence: TemplateIntelligence): string[] {
  const dominant = intelligence.recommendations.dominantLayoutSignatures;
  const source = dominant.length ? dominant : intelligence.layouts.slice(0, 8).map((layout) => layout.signature);
  return source.map((signature) => `template-layout:${intelligence.sourceHash.slice(0, 8)}:${signature}`);
}

export function compileTemplateDesignSystem(intelligence: TemplateIntelligence, name = "Imported corporate template"): TemplateDesignSystemCandidate {
  const layoutCount = intelligence.layouts.reduce((sum, layout) => sum + layout.count, 0);
  const recurringSlides = intelligence.layouts.filter((layout) => layout.count > 1).reduce((sum, layout) => sum + layout.count, 0);
  const observedColorCount = intelligence.styleStats.colors.length + intelligence.theme.colors.length;
  const observedFontCount = intelligence.recommendations.primaryFonts.length;
  const notes: string[] = [];
  if (!intelligence.theme.fonts.majorLatin && !intelligence.theme.fonts.minorLatin) notes.push("Theme font scheme is missing; typography falls back to observed/default fonts.");
  if (!intelligence.recommendations.dominantLayoutSignatures.length) notes.push("No repeated slide layout was detected; top unique layouts are exposed as recipe candidates.");
  if (!intelligence.styleStats.fontSizesPt.length) notes.push("No explicit text sizes were found in slide runs; default type scale values are used.");

  const designSystem: DesignSystem = {
    id: `design_template_${intelligence.sourceHash.slice(0, 16)}`,
    name,
    tokens: {
      colors: palette(intelligence),
      fonts: fonts(intelligence),
      typeScalePt: typeScale(intelligence),
      spacingDU: { xs: 8, s: 12, m: 16, l: 24, xl: 32, xxl: 48, section: 72 },
    },
    grid: {
      marginXDU: 144,
      marginYDU: 96,
      columns: 12,
      gutterDU: 24,
    },
    chartRules: [
      "Use the imported palette before introducing new series colors.",
      "Keep the slide takeaway visually dominant over the chart mechanics.",
      "Preserve source provenance for every data-backed chart.",
    ],
    imageRules: [
      "Preserve original asset bytes; crop and fit are scene properties.",
      "Match the reference deck's observed whitespace and image density before introducing decorative imagery.",
    ],
    iconRules: ["Prefer one consistent icon family and stroke language per deck."],
    forbiddenTreatments: ["Do not invent unsupported brand colors or fonts when the imported template already defines them."],
    recipeIds: layoutRecipeIds(intelligence),
  };

  return {
    designSystem,
    sourceHash: intelligence.sourceHash,
    confidence: {
      palette: Math.min(1, observedColorCount / 8),
      typography: Math.min(1, (observedFontCount + Math.min(4, intelligence.styleStats.fontSizesPt.length)) / 5),
      layout: layoutCount ? Math.min(1, 0.35 + recurringSlides / layoutCount) : 0,
    },
    notes,
  };
}
