import type { DeckDocument, SceneElement } from "../../deck-model/src/index.js";
import type { QAIssue } from "../../qa/src/index.js";
import type { BrandCoverage, BrandQAIssue } from "../../brand-qa/src/index.js";
import type { SlideMasterQAReport } from "../../slide-master-qa/src/index.js";

export type CreativeIntent = "polish" | "layout" | "brand" | "media" | "content" | "data" | "motion" | "system";
export type CreativeScopeKind = "selection" | "slide" | "deck";
export type CreativeRisk = "low" | "medium" | "high";
export type CreativeToolFamily = "read" | "editor" | "media" | "design" | "component" | "master" | "motion" | "asset" | "qa" | "evidence";

export interface CreativeScope {
  kind: CreativeScopeKind;
  slideIds?: string[];
  elementIds?: string[];
}

export interface CreativeChangeRequest {
  id: string;
  instruction: string;
  intent: CreativeIntent[];
  scope: CreativeScope;
  aggressiveness?: "conservative" | "balanced" | "bold";
  mustPreserve?: string[];
  allowGlobalPropagation?: boolean;
  allowNarrativeChange?: boolean;
  allowEvidenceChange?: boolean;
  acceptanceCriteria?: string[];
}

export interface AssetReviewSummary {
  total: number;
  missingBytes: number;
  unused: number;
  oversized?: number;
}

export interface MotionReviewSummary {
  slidesWithMotion: number;
  staleReferences: number;
}

export interface CreativeReviewInput {
  deck: DeckDocument;
  deterministicQA: QAIssue[];
  brandQA?: BrandQAIssue[];
  brandCoverage?: BrandCoverage;
  masterQA?: SlideMasterQAReport;
  assets?: AssetReviewSummary;
  motion?: MotionReviewSummary;
}

export interface CreativeQualityLane {
  lane: "structure" | "visual" | "brand" | "editability" | "assets" | "masters" | "motion";
  score: number;
  blockers: number;
  warnings: number;
  notes: string[];
}

export interface CreativeReview {
  score: number;
  ready: boolean;
  blockerCount: number;
  warningCount: number;
  lanes: CreativeQualityLane[];
  priorities: string[];
}

export interface CreativePlanStep {
  id: string;
  order: number;
  phase: "inspect" | "edit" | "verify";
  toolFamily: CreativeToolFamily;
  operation: string;
  scope: CreativeScope;
  risk: CreativeRisk;
  rationale: string;
  prerequisites: string[];
  expectedEffects: string[];
  mustNotChange: string[];
  requiresExplicitApproval: boolean;
}

export interface CreativeDirectorPlan {
  schemaVersion: "0.1";
  requestId: string;
  deckId: string;
  createdAt: string;
  risk: CreativeRisk;
  blocked: boolean;
  blockers: string[];
  assumptions: string[];
  before: CreativeReview;
  steps: CreativePlanStep[];
  acceptanceCriteria: string[];
}

export interface CreativeExecutionReview {
  accepted: boolean;
  regressions: string[];
  improvements: string[];
  before: CreativeReview;
  after: CreativeReview;
  acceptanceFailures: string[];
}

const severityCost: Record<string, number> = { info: 0, minor: 2, major: 8, critical: 24 };
function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }
function scoreFromIssues(base: number, issues: Array<{ severity: string }>): number { return clamp(base - issues.reduce((sum, issue) => sum + (severityCost[issue.severity] ?? 4), 0)); }
function issueCount(issues: Array<{ severity: string }>, severe = false): number { return issues.filter((issue) => severe ? issue.severity === "critical" || issue.severity === "major" : issue.severity === "minor").length; }
function criticalCount(issues: Array<{ severity: string }>): number { return issues.filter((issue) => issue.severity === "critical").length; }

function structureLane(input: CreativeReviewInput): CreativeQualityLane {
  const issues = input.deterministicQA.filter((issue) => issue.category === "schema" || issue.category === "geometry" || issue.category === "narrative");
  return { lane: "structure", score: scoreFromIssues(100, issues), blockers: criticalCount(issues), warnings: issueCount(issues, true) + issueCount(issues), notes: issues.slice(0, 5).map((issue) => issue.message) };
}
function visualLane(input: CreativeReviewInput): CreativeQualityLane {
  const issues = input.deterministicQA.filter((issue) => issue.category === "visual" || issue.category === "readability");
  return { lane: "visual", score: scoreFromIssues(100, issues), blockers: criticalCount(issues), warnings: issueCount(issues, true) + issueCount(issues), notes: issues.slice(0, 5).map((issue) => issue.message) };
}
function editabilityLane(input: CreativeReviewInput): CreativeQualityLane {
  const issues = input.deterministicQA.filter((issue) => issue.category === "export");
  return { lane: "editability", score: scoreFromIssues(100, issues), blockers: criticalCount(issues), warnings: issueCount(issues, true) + issueCount(issues), notes: issues.slice(0, 5).map((issue) => issue.message) };
}
function brandLane(input: CreativeReviewInput): CreativeQualityLane {
  const issues = input.brandQA ?? [];
  const coverage = input.brandCoverage?.coverage ?? 1;
  const score = clamp(scoreFromIssues(100, issues) * .7 + coverage * 100 * .3);
  const notes = issues.slice(0, 4).map((issue) => issue.message);
  if (input.brandCoverage) notes.unshift(`Token coverage ${Math.round(coverage * 100)}%`);
  return { lane: "brand", score, blockers: issues.filter((issue) => issue.severity === "major").length, warnings: issues.filter((issue) => issue.severity === "minor").length, notes };
}
function assetLane(input: CreativeReviewInput): CreativeQualityLane {
  const assets = input.assets;
  if (!assets) return { lane: "assets", score: 100, blockers: 0, warnings: 0, notes: ["Asset review unavailable"] };
  const score = clamp(100 - assets.missingBytes * 30 - (assets.oversized ?? 0) * 2 - assets.unused * .25);
  return { lane: "assets", score, blockers: assets.missingBytes, warnings: (assets.oversized ?? 0) + assets.unused, notes: [`${assets.total} assets`, `${assets.missingBytes} missing bytes`, `${assets.unused} unused`] };
}
function masterLane(input: CreativeReviewInput): CreativeQualityLane {
  const qa = input.masterQA;
  if (!qa) return { lane: "masters", score: 100, blockers: 0, warnings: 0, notes: ["Master review unavailable"] };
  const score = scoreFromIssues(100, qa.issues);
  return { lane: "masters", score, blockers: qa.issues.filter((issue) => issue.severity === "critical").length, warnings: qa.issues.filter((issue) => issue.severity !== "critical").length, notes: [`${qa.masterCount} masters`, `${qa.linkedSlideCount} linked slides`, ...qa.issues.slice(0, 3).map((issue) => issue.message)] };
}
function motionLane(input: CreativeReviewInput): CreativeQualityLane {
  const motion = input.motion;
  if (!motion) return { lane: "motion", score: 100, blockers: 0, warnings: 0, notes: ["Motion review unavailable"] };
  return { lane: "motion", score: clamp(100 - motion.staleReferences * 25), blockers: motion.staleReferences, warnings: 0, notes: [`${motion.slidesWithMotion} slides with motion`, `${motion.staleReferences} stale references`] };
}

export function reviewCreativeQuality(input: CreativeReviewInput): CreativeReview {
  const lanes = [structureLane(input), visualLane(input), brandLane(input), editabilityLane(input), assetLane(input), masterLane(input), motionLane(input)];
  const weights: Record<CreativeQualityLane["lane"], number> = { structure: .18, visual: .18, brand: .15, editability: .16, assets: .12, masters: .12, motion: .09 };
  const score = Math.round(lanes.reduce((sum, lane) => sum + lane.score * weights[lane.lane], 0));
  const blockerCount = lanes.reduce((sum, lane) => sum + lane.blockers, 0);
  const warningCount = lanes.reduce((sum, lane) => sum + lane.warnings, 0);
  const priorities = [...lanes].sort((a, b) => a.score - b.score).filter((lane) => lane.score < 95 || lane.blockers).slice(0, 4).map((lane) => `${lane.lane}: ${lane.notes[0] ?? `${lane.score}/100`}`);
  return { score, ready: blockerCount === 0 && score >= 85, blockerCount, warningCount, lanes, priorities };
}

function riskRank(risk: CreativeRisk): number { return risk === "high" ? 3 : risk === "medium" ? 2 : 1; }
function maxRisk(values: CreativeRisk[]): CreativeRisk { return values.reduce((best, value) => riskRank(value) > riskRank(best) ? value : best, "low" as CreativeRisk); }
function scopeRisk(scope: CreativeScope): CreativeRisk { return scope.kind === "deck" ? "medium" : scope.kind === "slide" ? "low" : "low"; }
function globalRisk(operation: string): CreativeRisk { return ["setToken", "updateMasterFromSlide", "refreshInstances", "bulkMigration"].includes(operation) ? "high" : "medium"; }

function baseStep(id: string, order: number, phase: CreativePlanStep["phase"], toolFamily: CreativeToolFamily, operation: string, request: CreativeChangeRequest, risk: CreativeRisk, rationale: string): CreativePlanStep {
  return { id, order, phase, toolFamily, operation, scope: structuredClone(request.scope), risk, rationale, prerequisites: [], expectedEffects: [], mustNotChange: [...(request.mustPreserve ?? [])], requiresExplicitApproval: risk === "high" && !request.allowGlobalPropagation };
}

export function buildCreativeDirectorPlan(request: CreativeChangeRequest, input: CreativeReviewInput): CreativeDirectorPlan {
  if (!request.id.trim()) throw new Error("Creative request id is required");
  if (!request.instruction.trim()) throw new Error("Creative instruction is required");
  if (!request.intent.length) throw new Error("At least one creative intent is required");
  const before = reviewCreativeQuality(input);
  const blockers: string[] = [];
  const assumptions: string[] = [];
  if (request.scope.kind === "selection" && !(request.scope.elementIds?.length)) blockers.push("Selection scope requires elementIds");
  if ((request.scope.kind === "slide" || request.scope.kind === "selection") && !(request.scope.slideIds?.length)) blockers.push(`${request.scope.kind} scope requires slideIds`);
  if (!request.allowEvidenceChange && request.intent.includes("content")) assumptions.push("Preserve existing claim/evidence relationships; content edits must remain meaning-preserving unless separately approved.");
  if (!request.allowNarrativeChange && request.intent.includes("content")) assumptions.push("Narrative structure and slide order remain fixed.");

  const steps: CreativePlanStep[] = [];
  let order = 0;
  const push = (step: Omit<CreativePlanStep, "order">) => steps.push({ ...step, order: ++order });
  push({ ...baseStep("inspect_project", 0, "inspect", "read", "projectState", request, "low", "Resolve current canonical slide/object handles and deck hash before authoring edits."), order: 0 });

  if (request.intent.includes("brand") || request.intent.includes("polish")) {
    push({ ...baseStep("inspect_design", 0, "inspect", "design", "designState", request, "low", "Read live tokens, coverage, Brand QA and migration suggestions before changing styling."), order: 0 });
    const operation = request.scope.kind === "deck" ? "setToken" : "bindOrStyleSelection";
    const step = baseStep("edit_brand", 0, "edit", "design", operation, request, request.scope.kind === "deck" ? globalRisk("setToken") : "medium", "Prefer live token/binding edits over repeated literal styling when the request is brand-level.");
    step.prerequisites.push("inspect_design"); step.expectedEffects.push("Brand-consistent materialized native scene values"); push({ ...step, order: 0 });
  }
  if (request.intent.includes("layout") || request.intent.includes("polish")) {
    push({ ...baseStep("inspect_layout", 0, "inspect", "master", "masterState", request, "low", "Read current master, Smart Layout recommendations and master drift before changing composition."), order: 0 });
    const operation = request.scope.kind === "deck" && request.allowGlobalPropagation ? "updateMasterFromSlide" : "applyRecommendedMasterOrEditGeometry";
    const step = baseStep("edit_layout", 0, "edit", "master", operation, request, operation === "updateMasterFromSlide" ? globalRisk(operation) : "medium", "Use reusable layout/master semantics when the requested composition should propagate; otherwise keep the edit local.");
    step.prerequisites.push("inspect_layout"); step.expectedEffects.push("Improved composition without losing placeholder content or freeform objects"); push({ ...step, order: 0 });
  }
  if (request.intent.includes("media")) {
    const inspect = baseStep("inspect_media", 0, "inspect", "asset", "assetAndMediaState", request, "low", "Resolve actual project assets and current crop/focal/clip treatment before art direction."); push({ ...inspect, order: 0 });
    const edit = baseStep("edit_media", 0, "edit", "media", "setImageProperties", request, "medium", "Keep image art direction non-destructive and canonical across Editor, Presenter, Components and PPTX."); edit.prerequisites.push("inspect_media"); edit.expectedEffects.push("Editable fit/crop/focal/clip treatment"); push({ ...edit, order: 0 });
  }
  if (request.intent.includes("motion")) {
    const inspect = baseStep("inspect_motion", 0, "inspect", "motion", "motionState", request, "low", "Resolve stable motion/build/track handles before animation changes."); push({ ...inspect, order: 0 });
    const edit = baseStep("edit_motion", 0, "edit", "motion", "motionCommand", request, "medium", "Use canonical MotionDocument commands rather than DOM-only animation state."); edit.prerequisites.push("inspect_motion"); edit.expectedEffects.push("Presenter-compatible transitions/builds/keyframes"); push({ ...edit, order: 0 });
  }
  if (request.intent.includes("content") || request.intent.includes("data")) {
    const evidence = baseStep("inspect_evidence", 0, "inspect", "evidence", "evidenceDependencies", request, "low", "Protect factual meaning and source dependencies before editing semantic content."); push({ ...evidence, order: 0 });
    const edit = baseStep("edit_content", 0, "edit", "editor", request.intent.includes("data") ? "dataAwareEdit" : "contentEdit", request, request.allowEvidenceChange ? "high" : "medium", "Edit semantic content only within the explicitly allowed narrative/evidence scope."); edit.prerequisites.push("inspect_evidence"); if (!request.allowEvidenceChange) edit.mustNotChange.push("claim/evidence meaning"); push({ ...edit, order: 0 });
  }
  if (request.intent.includes("system")) {
    const step = baseStep("edit_system", 0, "edit", "component", "componentOrSystemCommand", request, request.scope.kind === "deck" ? "high" : "medium", "Use linked components/tokens/masters for reusable system-level changes rather than repeated one-off edits."); push({ ...step, order: 0 });
  }

  const verify = baseStep("verify_quality", 0, "verify", "qa", "productionReview", request, "low", "Re-run deterministic, brand, master, asset and motion review after edits and reject regressions.");
  verify.prerequisites.push(...steps.filter((step) => step.phase === "edit").map((step) => step.id));
  verify.expectedEffects.push("No new critical QA issues", "No unintended scope changes", "Canonical editability preserved");
  push({ ...verify, order: 0 });

  const planRisk = maxRisk([scopeRisk(request.scope), ...steps.map((step) => step.risk)]);
  for (const step of steps) if (step.requiresExplicitApproval) blockers.push(`${step.id} requires explicit approval for global propagation`);
  const acceptanceCriteria = [...new Set([
    ...(request.acceptanceCriteria ?? []),
    "No new critical deterministic QA issues",
    "No broken asset/master/motion references",
    "Result remains manually editable",
    ...(request.mustPreserve ?? []).map((item) => `Preserve: ${item}`),
  ])];
  return { schemaVersion: "0.1", requestId: request.id, deckId: input.deck.id, createdAt: new Date().toISOString(), risk: planRisk, blocked: blockers.length > 0, blockers, assumptions, before, steps, acceptanceCriteria };
}

function laneMap(review: CreativeReview): Map<string, CreativeQualityLane> { return new Map(review.lanes.map((lane) => [lane.lane, lane])); }
export function reviewCreativeExecution(plan: CreativeDirectorPlan, afterInput: CreativeReviewInput, acceptanceResults: Record<string, boolean> = {}): CreativeExecutionReview {
  const after = reviewCreativeQuality(afterInput);
  const beforeLanes = laneMap(plan.before); const afterLanes = laneMap(after);
  const regressions: string[] = []; const improvements: string[] = [];
  for (const [lane, current] of afterLanes) {
    const previous = beforeLanes.get(lane); if (!previous) continue;
    if (current.blockers > previous.blockers) regressions.push(`${lane}: blockers ${previous.blockers} → ${current.blockers}`);
    else if (current.score < previous.score - 3) regressions.push(`${lane}: score ${previous.score} → ${current.score}`);
    else if (current.score > previous.score + 3 || current.blockers < previous.blockers) improvements.push(`${lane}: ${previous.score} → ${current.score}`);
  }
  if (after.blockerCount > plan.before.blockerCount) regressions.push(`Total blockers ${plan.before.blockerCount} → ${after.blockerCount}`);
  const acceptanceFailures = plan.acceptanceCriteria.filter((criterion) => acceptanceResults[criterion] === false);
  const accepted = regressions.length === 0 && acceptanceFailures.length === 0 && !after.lanes.some((lane) => lane.blockers > 0 && (beforeLanes.get(lane.lane)?.blockers ?? 0) === 0);
  return { accepted, regressions: [...new Set(regressions)], improvements: [...new Set(improvements)], before: plan.before, after, acceptanceFailures };
}
