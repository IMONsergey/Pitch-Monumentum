import type { DeckDocument, SceneElement } from "../../deck-model/src/index.js";
import { auditTheme, type DeckTheme, type ThemeBindingTarget } from "../../design-system/src/index.js";

export interface BrandCoverage {
  eligibleBindings: number;
  boundBindings: number;
  coverage: number;
  byTarget: Record<ThemeBindingTarget, { eligible: number; bound: number; coverage: number }>;
}

export interface BrandQAIssue {
  code: "theme-audit" | "hardcoded-brand-value" | "unknown-brand-value" | "mixed-text-style";
  severity: "minor" | "major";
  slideId?: string;
  elementId?: string;
  target?: ThemeBindingTarget;
  value?: string | number;
  message: string;
}

const TARGETS: ThemeBindingTarget[] = ["fill", "strokeColor", "textColor", "fontFamily", "fontSizePt"];

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(next) ? next : undefined;
}

function binding(element: SceneElement, target: ThemeBindingTarget): string | undefined {
  return (element as any).tokenBindings?.[target];
}

function uniformText(element: Extract<SceneElement, { type: "text" }>, target: "textColor" | "fontFamily" | "fontSizePt"): string | number | "mixed" | undefined {
  const values = element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => target === "textColor" ? normalizeColor(run.color) : target === "fontFamily" ? run.fontFamily?.trim() : run.fontSizePt)).filter((value): value is string | number => value !== undefined && value !== "");
  if (!values.length) return undefined;
  return values.every((value) => value === values[0]) ? values[0] : "mixed";
}

function eligible(element: SceneElement, target: ThemeBindingTarget): boolean {
  if (target === "fill") return (element.type === "shape" || element.type === "frame") && Boolean(element.fill);
  if (target === "strokeColor") return (element.type === "shape" || element.type === "line" || element.type === "frame") && Boolean(element.stroke?.color);
  if (target === "textColor") return element.type === "text" && uniformText(element, target) !== undefined && uniformText(element, target) !== "mixed";
  if (target === "fontFamily") return element.type === "text" && uniformText(element, target) !== undefined && uniformText(element, target) !== "mixed";
  return element.type === "text" && uniformText(element, target) !== undefined && uniformText(element, target) !== "mixed";
}

function currentValue(element: SceneElement, target: ThemeBindingTarget): string | number | "mixed" | undefined {
  if (target === "fill") return element.type === "shape" || element.type === "frame" ? normalizeColor(element.fill) : undefined;
  if (target === "strokeColor") return element.type === "shape" || element.type === "line" || element.type === "frame" ? normalizeColor(element.stroke?.color) : undefined;
  if (element.type !== "text") return undefined;
  return uniformText(element, target as "textColor" | "fontFamily" | "fontSizePt");
}

function tokenHasValue(theme: DeckTheme, target: ThemeBindingTarget, value: string | number): boolean {
  if (target === "fill" || target === "strokeColor" || target === "textColor") {
    const normalized = normalizeColor(value);
    return Object.values(theme.colors).some((candidate) => normalizeColor(candidate) === normalized);
  }
  if (target === "fontFamily") return Object.values(theme.fonts).some((candidate) => candidate.trim().toLowerCase() === String(value).trim().toLowerCase());
  return Object.values(theme.typeScalePt).some((candidate) => candidate === value);
}

export function brandCoverage(deck: DeckDocument): BrandCoverage {
  const byTarget = Object.fromEntries(TARGETS.map((target) => [target, { eligible: 0, bound: 0, coverage: 1 }])) as BrandCoverage["byTarget"];
  for (const slide of deck.slides) for (const element of slide.scene) for (const target of TARGETS) {
    if (!eligible(element, target)) continue;
    byTarget[target].eligible += 1;
    if (binding(element, target)) byTarget[target].bound += 1;
  }
  let eligibleBindings = 0;
  let boundBindings = 0;
  for (const target of TARGETS) {
    const row = byTarget[target];
    row.coverage = row.eligible ? row.bound / row.eligible : 1;
    eligibleBindings += row.eligible;
    boundBindings += row.bound;
  }
  return { eligibleBindings, boundBindings, coverage: eligibleBindings ? boundBindings / eligibleBindings : 1, byTarget };
}

export function runBrandQA(deck: DeckDocument, theme?: DeckTheme): BrandQAIssue[] {
  const issues: BrandQAIssue[] = auditTheme(deck).map((issue) => ({ code: "theme-audit", severity: issue.severity, slideId: issue.slideId, elementId: issue.elementId, target: issue.target, message: issue.message }));
  if (!theme) return issues;
  for (const slide of deck.slides) for (const element of slide.scene) {
    if (element.type === "text") for (const target of ["textColor", "fontFamily", "fontSizePt"] as const) {
      const value = uniformText(element, target);
      if (value === "mixed") issues.push({ code: "mixed-text-style", severity: "minor", slideId: slide.id, elementId: element.id, target, message: `Text object ${element.id} has mixed ${target} and cannot be bound as one box-level design token` });
    }
    for (const target of TARGETS) {
      if (!eligible(element, target) || binding(element, target)) continue;
      const value = currentValue(element, target);
      if (value === undefined || value === "mixed") continue;
      const matchesTheme = tokenHasValue(theme, target, value);
      issues.push({
        code: matchesTheme ? "hardcoded-brand-value" : "unknown-brand-value",
        severity: matchesTheme ? "minor" : "major",
        slideId: slide.id,
        elementId: element.id,
        target,
        value,
        message: matchesTheme ? `${target} uses a brand value literally instead of binding to its theme token` : `${target} value ${String(value)} is outside the current theme token set`,
      });
    }
  }
  return issues;
}
