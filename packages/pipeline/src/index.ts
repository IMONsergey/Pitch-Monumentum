import { randomUUID } from "node:crypto";
import type { ArtifactEnvelope } from "../../shared/src/index.js";
import type { Claim, NarrativeGraph, PresentationBrief, SourceDocument, SlideArchetype, SlideSemanticContract } from "../../deck-model/src/index.js";
import type { SourceBlock } from "../../source-ingest/src/index.js";
import type { EvidenceCandidate } from "../../evidence/src/candidates.js";
import { ArtifactStore } from "../../artifact-store/src/index.js";

export interface StoryboardSlide {
  id: string;
  order: number;
  sectionId?: string;
  title: string;
  archetype: SlideArchetype;
  semantic: SlideSemanticContract;
  visualIntent: string;
  layoutHints: string[];
  requiredAssetRoles: string[];
  qaRisks: string[];
}
export interface Storyboard { id: string; deckTitle: string; rationale: string; slides: StoryboardSlide[]; }

export type PitchReasoningTaskKind = "claim-review" | "strategist" | "story-architect" | "storyboard";
export interface PitchReasoningTask<TInput = unknown> {
  id: string;
  kind: PitchReasoningTaskKind;
  role: "Researcher" | "Strategist" | "Story Architect";
  systemContract: string;
  instruction: string;
  input: TInput;
  outputContract: Record<string, unknown>;
}
/** Codex-specific reasoning boundary; intentionally not a generic model-provider abstraction. */
export interface CodexPitchReasoner { runStructured<TOutput>(task: PitchReasoningTask): Promise<TOutput>; }
export interface SemanticPipelineInput {
  projectId: string;
  userRequest: string;
  language: string;
  sources: SourceDocument[];
  blocks: SourceBlock[];
  evidenceCandidates: EvidenceCandidate[];
}
export interface SemanticPipelineResult {
  claims: ArtifactEnvelope<Claim[]>;
  brief: ArtifactEnvelope<PresentationBrief>;
  narrative: ArtifactEnvelope<NarrativeGraph>;
  storyboard: ArtifactEnvelope<Storyboard>;
}

const FACTUALITY = [
  "You work inside PitchOS. Typed project artifacts are canonical.",
  "Never invent a source fact, number, quote, citation, evidence id, or causal relationship.",
  "Targets, assumptions, demo values and user hypotheses are scenario data, not sourced facts.",
  "Preserve supplied evidence ids exactly and return only the requested structured data."
].join("\n");
function makeTask<T>(kind: PitchReasoningTaskKind, role: PitchReasoningTask["role"], instruction: string, input: T, outputContract: Record<string, unknown>): PitchReasoningTask<T> {
  return { id: `task_${kind}_${randomUUID()}`, kind, role, systemContract: FACTUALITY, instruction, input, outputContract };
}

export function createClaimReviewTask(input: SemanticPipelineInput): PitchReasoningTask {
  return makeTask("claim-review", "Researcher",
    "Turn evidence candidates into concise presentation-safe claims. Use anchored surrounding text as context. Omit ambiguous candidates. Source-backed claims must reference supplied evidence candidate ids. Mark verified only when anchored context directly supports the full statement.",
    { userRequest: input.userRequest, language: input.language, sources: input.sources, blocks: input.blocks.map(b => ({ id: b.id, anchor: b.anchor, text: b.text })), evidenceCandidates: input.evidenceCandidates },
    { type: "array", requiredItemFields: ["id", "statement", "dataClass", "evidenceRefs", "confidence", "verificationStatus"] });
}
export function createStrategistTask(input: SemanticPipelineInput, claims: Claim[]): PitchReasoningTask {
  return makeTask("strategist", "Strategist",
    "Create one operational PresentationBrief. Infer aggressively instead of forcing a questionnaire; expose uncertain assumptions. Define audience, intent, outcome, core message, decision ask, delivery/reading mode and page budget. Do not design slides or add unsupported facts.",
    { userRequest: input.userRequest, language: input.language, sources: input.sources, claims, sourceDigest: input.blocks.slice(0, 120).map(b => ({ anchorId: b.anchor.id, text: b.text })) },
    { type: "object", contract: "PresentationBrief" });
}
export function createNarrativeTask(brief: PresentationBrief, claims: Claim[]): PitchReasoningTask {
  return makeTask("story-architect", "Story Architect",
    "Build an inspectable argument graph, not slide titles. Use typed question/context/claim/evidence/objection/decision/recommendation/action/section nodes. Factual claim nodes may reference only supplied claim ids. Expose objections and proof gaps.",
    { brief, claims }, { type: "object", contract: "NarrativeGraph" });
}
export function createStoryboardTask(brief: PresentationBrief, claims: Claim[], narrative: NarrativeGraph): PitchReasoningTask {
  return makeTask("storyboard", "Story Architect",
    "Project the narrative into an ordered semantic storyboard. Keep page count inside the brief budget. Each slide has one dominant job and takeaway plus visualIntent/layoutHints, but no geometry. Avoid filler agenda/section pages unless they materially improve orientation.",
    { brief, claims, narrative }, { type: "object", contract: "Storyboard" });
}

function requiredText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
}
export function validateClaims(claims: Claim[], evidence: EvidenceCandidate[]): void {
  const knownEvidence = new Set(evidence.map(x => x.id));
  const ids = new Set<string>();
  for (const claim of claims) {
    requiredText(claim.id, "claim.id"); requiredText(claim.statement, `claim ${claim.id}.statement`);
    if (ids.has(claim.id)) throw new Error(`Duplicate claim id: ${claim.id}`); ids.add(claim.id);
    if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) throw new Error(`Claim ${claim.id} confidence must be 0..1`);
    if (claim.dataClass !== "scenario" && claim.evidenceRefs.length === 0) throw new Error(`Non-scenario claim ${claim.id} must have evidence refs`);
    for (const ref of claim.evidenceRefs) if (!knownEvidence.has(ref)) throw new Error(`Claim ${claim.id} references unknown evidence ${ref}`);
    if (claim.dataClass === "scenario" && claim.verificationStatus === "verified") throw new Error(`Scenario claim ${claim.id} cannot be verified as sourced fact`);
  }
}
export function validateBrief(brief: PresentationBrief): void {
  for (const [label, value] of [["id", brief.id], ["language", brief.language], ["audience", brief.audience], ["intent", brief.communicationIntent], ["outcome", brief.audienceOutcome], ["coreMessage", brief.coreMessage], ["deliveryContext", brief.deliveryContext]] as const) requiredText(value, `brief.${label}`);
  const { min, target, max } = brief.pageBudget;
  if (![min, target, max].every(Number.isInteger) || min < 1 || min > target || target > max) throw new Error("brief.pageBudget must satisfy positive integer min <= target <= max");
}
export function validateNarrative(narrative: NarrativeGraph, claims: Claim[]): void {
  requiredText(narrative.id, "narrative.id");
  const claimIds = new Set(claims.map(c => c.id)); const nodeIds = new Set<string>();
  for (const node of narrative.nodes) {
    requiredText(node.id, "narrative node id"); requiredText(node.label, `narrative node ${node.id}.label`);
    if (nodeIds.has(node.id)) throw new Error(`Duplicate narrative node: ${node.id}`); nodeIds.add(node.id);
    if (node.claimId && !claimIds.has(node.claimId)) throw new Error(`Narrative node ${node.id} references unknown claim ${node.claimId}`);
  }
  for (const edge of narrative.edges) if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`Narrative edge ${edge.id} has dangling endpoint`);
}
export function validateStoryboard(storyboard: Storyboard, brief: PresentationBrief, claims: Claim[]): void {
  requiredText(storyboard.id, "storyboard.id"); requiredText(storyboard.deckTitle, "storyboard.deckTitle");
  if (storyboard.slides.length < brief.pageBudget.min || storyboard.slides.length > brief.pageBudget.max) throw new Error(`Storyboard slide count ${storyboard.slides.length} is outside brief range ${brief.pageBudget.min}..${brief.pageBudget.max}`);
  const claimIds = new Set(claims.map(c => c.id)); const slideIds = new Set<string>();
  storyboard.slides.forEach((slide, index) => {
    if (slide.order !== index) throw new Error(`Storyboard orders must be contiguous; expected ${index}, got ${slide.order}`);
    if (slideIds.has(slide.id)) throw new Error(`Duplicate storyboard slide id: ${slide.id}`); slideIds.add(slide.id);
    requiredText(slide.semantic.purpose, `slide ${slide.id}.purpose`); requiredText(slide.semantic.takeaway, `slide ${slide.id}.takeaway`);
    for (const claimId of slide.semantic.claimIds) if (!claimIds.has(claimId)) throw new Error(`Slide ${slide.id} references unknown claim ${claimId}`);
  });
}

export async function runSemanticPipeline(store: ArtifactStore, input: SemanticPipelineInput, reasoner: CodexPitchReasoner): Promise<SemanticPipelineResult> {
  const claims = await reasoner.runStructured<Claim[]>(createClaimReviewTask(input)); validateClaims(claims, input.evidenceCandidates);
  const claimsArtifact = await store.write({ id: "claims_current", kind: "claims", payload: claims, producer: { type: "codex", stageRunId: "claim-review" } });
  const brief = await reasoner.runStructured<PresentationBrief>(createStrategistTask(input, claims)); validateBrief(brief);
  const briefArtifact = await store.write({ id: "brief_current", kind: "brief", payload: brief, producer: { type: "codex", stageRunId: "strategist" }, inputs: [claimsArtifact] });
  const narrative = await reasoner.runStructured<NarrativeGraph>(createNarrativeTask(brief, claims)); validateNarrative(narrative, claims);
  const narrativeArtifact = await store.write({ id: "narrative_current", kind: "narrative", payload: narrative, producer: { type: "codex", stageRunId: "story-architect" }, inputs: [claimsArtifact, briefArtifact] });
  const storyboard = await reasoner.runStructured<Storyboard>(createStoryboardTask(brief, claims, narrative)); validateStoryboard(storyboard, brief, claims);
  const storyboardArtifact = await store.write({ id: "storyboard_current", kind: "storyboard", payload: storyboard, producer: { type: "codex", stageRunId: "storyboard" }, inputs: [claimsArtifact, briefArtifact, narrativeArtifact] });
  return { claims: claimsArtifact, brief: briefArtifact, narrative: narrativeArtifact, storyboard: storyboardArtifact };
}
