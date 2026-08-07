import type { DeckDocument, TextElement } from "../../deck-model/src/index.js";
import type { ContextIndex } from "../../context-index/src/index.js";
import { runDeterministicQA, type QAIssue } from "../../qa/src/index.js";
import { dataStoryQuality } from "../../data-storytelling/src/index.js";
import type { ProductionExportManifest } from "../../export-pipeline/src/index.js";

export interface QualityDimensionScores {
  narrative: number;
  evidence: number;
  visual: number;
  readability: number;
  brand: number;
  exportEditability: number;
}
export interface ModelReviewScores {
  narrative?: number;
  visual?: number;
  brand?: number;
}
export interface QualityGateFailure {
  code: string;
  lane: keyof QualityDimensionScores | "system";
  message: string;
  slideId?: string;
  elementId?: string;
  claimId?: string;
}
export interface DeckQualityReport {
  schemaVersion: "0.1";
  deckId: string;
  scores: QualityDimensionScores;
  weightedScore: number;
  ready: boolean;
  hardGateFailures: QualityGateFailure[];
  deterministicIssues: QAIssue[];
  observations: string[];
}
export interface QualityInput {
  deck: DeckDocument;
  contextIndex?: ContextIndex;
  exportManifest?: ProductionExportManifest;
  modelReview?: ModelReviewScores;
}

const WEIGHTS: Record<keyof QualityDimensionScores, number> = {
  narrative: 0.25,
  evidence: 0.25,
  visual: 0.20,
  readability: 0.10,
  brand: 0.10,
  exportEditability: 0.10,
};
function clamp(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }
function minModel(base: number, override?: number): number { return override === undefined ? base : clamp((base * 0.4) + (override * 0.6)); }
function usedClaimIds(deck: DeckDocument): string[] { return [...new Set(deck.slides.flatMap((slide) => [...slide.semantic.claimIds, ...slide.scene.flatMap((element) => element.dependencies.filter((d) => d.kind === "claim").map((d) => d.id))]))]; }
function narrativeScore(deck: DeckDocument): { score: number; observations: string[] } {
  let score = 100; const observations: string[] = [];
  if (!deck.slides.length) return { score: 0, observations: ["Deck contains no slides"] };
  const takeaways = new Map<string, number>();
  for (const slide of deck.slides) {
    if (!slide.semantic.purpose.trim()) { score -= 12; observations.push(`${slide.id}: missing purpose`) }
    if (!slide.semantic.takeaway.trim()) { score -= 14; observations.push(`${slide.id}: missing takeaway`) }
    if (!slide.semantic.questionAnswered.trim()) { score -= 6; observations.push(`${slide.id}: no question answered`) }
    const key = slide.semantic.takeaway.trim().toLowerCase(); if (key) takeaways.set(key, (takeaways.get(key) ?? 0) + 1);
  }
  for (const [takeaway, count] of takeaways) if (count > 1) { score -= Math.min(20, (count - 1) * 7); observations.push(`Repeated takeaway across ${count} slides: ${takeaway.slice(0, 70)}`) }
  if (deck.slides.length > 2 && !deck.slides.some((slide) => ["decision", "recommendation", "ask", "closing"].includes(slide.archetype))) { score -= 12; observations.push("Deck has no explicit decision/recommendation/ask/closing slide") }
  return { score: clamp(score), observations };
}
function evidenceScore(deck: DeckDocument, index?: ContextIndex): { score: number; failures: QualityGateFailure[]; observations: string[] } {
  const used = usedClaimIds(deck); const failures: QualityGateFailure[] = []; const observations: string[] = [];
  if (!used.length) return { score: 100, failures, observations: ["No factual claim dependencies are declared"] };
  if (!index) return { score: 30, failures: [{ code: "evidence-index-missing", lane: "evidence", message: "Deck uses factual claims but has no ContextIndex" }], observations: ["Evidence coverage cannot be proven without ContextIndex"] };
  let healthy = 0;
  for (const claimId of used) {
    const claim = index.claims[claimId], health = index.health.claims[claimId];
    if (!claim) { failures.push({ code: "claim-missing", lane: "evidence", claimId, message: `Used claim ${claimId} is absent from ContextIndex` }); continue }
    if (claim.dataClass === "scenario") { healthy++; continue }
    if (health === "valid" && claim.verificationStatus === "verified") healthy++;
    else failures.push({ code: `claim-${health ?? "missing"}`, lane: "evidence", claimId, message: `Used claim ${claimId} is ${health ?? "missing"}/${claim.verificationStatus}` });
  }
  const coverage = used.length ? healthy / used.length : 1;
  if (coverage < 1) observations.push(`Verified claim coverage: ${Math.round(coverage * 100)}%`);
  return { score: clamp(coverage * 100), failures, observations };
}
function visualReadability(deck: DeckDocument, deterministic: QAIssue[]): { visual: number; readability: number; observations: string[] } {
  let visual = 100, readability = 100; const observations: string[] = [];
  for (const issue of deterministic) {
    const penalty = issue.severity === "critical" ? 30 : issue.severity === "major" ? 14 : issue.severity === "minor" ? 5 : 1;
    if (issue.category === "readability") readability -= penalty; else if (["geometry", "visual", "brand"].includes(issue.category)) visual -= penalty;
  }
  for (const slide of deck.slides) {
    if (slide.scene.length > 28) { visual -= 8; readability -= 6; observations.push(`${slide.id}: high object density (${slide.scene.length})`) }
    for (const element of slide.scene) {
      if (element.type !== "text") continue;
      const text = element as TextElement;
      const sizes = text.paragraphs.flatMap((p) => p.runs.map((r) => r.fontSizePt).filter((v): v is number => typeof v === "number"));
      const min = sizes.length ? Math.min(...sizes) : undefined;
      if (min !== undefined && min < 11) { readability -= 14; observations.push(`${slide.id}/${element.id}: text below 11pt`) }
      else if (min !== undefined && min < 16 && slide.semantic.density !== "dense") { readability -= 5; observations.push(`${slide.id}/${element.id}: small text for ${slide.semantic.density} mode`) }
    }
    for (const element of slide.scene) if (element.type === "chart") {
      const issues = dataStoryQuality(element.chart); visual -= issues.filter((i) => i.severity === "major").length * 8; readability -= issues.filter((i) => i.code === "category-density").length * 10;
    }
  }
  return { visual: clamp(visual), readability: clamp(readability), observations };
}
function brandScore(deck: DeckDocument): number {
  const styles = new Set<string>();
  for (const slide of deck.slides) for (const element of slide.scene) if (element.type === "text") for (const p of element.paragraphs) for (const run of p.runs) if (run.fontFamily) styles.add(run.fontFamily);
  return styles.size > 5 ? 70 : styles.size > 3 ? 85 : 100;
}
function exportScore(manifest?: ProductionExportManifest): { score: number; failures: QualityGateFailure[] } {
  if (!manifest) return { score: 50, failures: [] };
  const total = Object.values(manifest.editability).reduce((a, b) => a + b, 0) || 1;
  const nativeEquivalent = manifest.editability.native + manifest.editability.vector * 0.8 + manifest.editability.rasterFallback * 0.25;
  const failures: QualityGateFailure[] = [];
  if (!manifest.ready) failures.push({ code: "export-not-ready", lane: "exportEditability", message: "Latest export manifest is not production-ready" });
  if (manifest.editability.unsupported) failures.push({ code: "unsupported-export-elements", lane: "exportEditability", message: `${manifest.editability.unsupported} element(s) are unsupported by the export pipeline` });
  if (manifest.roundTripIssues.some((issue) => issue.severity === "critical")) failures.push({ code: "roundtrip-critical", lane: "exportEditability", message: "PPTX round-trip validation has critical issues" });
  return { score: clamp((nativeEquivalent / total) * 100), failures };
}

export function scoreDeckQuality(input: QualityInput): DeckQualityReport {
  const deterministic = runDeterministicQA(input.deck);
  const narrative = narrativeScore(input.deck);
  const evidence = evidenceScore(input.deck, input.contextIndex);
  const vr = visualReadability(input.deck, deterministic);
  const exportResult = exportScore(input.exportManifest);
  const scores: QualityDimensionScores = {
    narrative: minModel(narrative.score, input.modelReview?.narrative),
    evidence: evidence.score,
    visual: minModel(vr.visual, input.modelReview?.visual),
    readability: vr.readability,
    brand: minModel(brandScore(input.deck), input.modelReview?.brand),
    exportEditability: exportResult.score,
  };
  const hardGateFailures: QualityGateFailure[] = [
    ...deterministic.filter((issue) => issue.severity === "critical").map((issue) => ({ code: `qa:${issue.category}`, lane: issue.category === "readability" ? "readability" as const : "visual" as const, slideId: issue.scope.slideId, elementId: issue.scope.elementIds?.[0], message: issue.message })),
    ...evidence.failures,
    ...exportResult.failures,
  ];
  const weightedScore = clamp(Object.entries(scores).reduce((sum, [key, value]) => sum + value * WEIGHTS[key as keyof QualityDimensionScores], 0));
  const ready = hardGateFailures.length === 0 && scores.narrative >= 80 && scores.evidence >= 90 && scores.visual >= 80 && scores.readability >= 90 && scores.exportEditability >= 90;
  return { schemaVersion: "0.1", deckId: input.deck.id, scores, weightedScore, ready, hardGateFailures, deterministicIssues: deterministic, observations: [...narrative.observations, ...evidence.observations, ...vr.observations] };
}
