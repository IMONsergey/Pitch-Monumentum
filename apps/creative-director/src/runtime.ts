import { randomUUID } from "node:crypto";
import { PitchWorkspaceService } from "../../workspace/src/server.js";
import { executeWorkspaceDesignCommand, type WorkspaceDesignCommand } from "../../workspace/src/design-runtime.js";
import { executeWorkspaceSlideMasterCommand, type WorkspaceSlideMasterCommand } from "../../workspace/src/master-runtime.js";
import { PitchToolRuntime } from "../../../packages/pitch-tools/src/index.js";
import { brandCoverage, runBrandQA } from "../../../packages/brand-qa/src/index.js";
import { runSlideMasterQA } from "../../../packages/slide-master-qa/src/index.js";
import { validateMotionDocument } from "../../../packages/motion-engine/src/index.js";
import {
  buildCreativeDirectorPlan,
  reviewCreativeExecution,
  reviewCreativeQuality,
  type CreativeChangeRequest,
  type CreativeDirectorPlan,
  type CreativeExecutionReview,
  type CreativeReviewInput,
  type CreativeScope,
} from "../../../packages/creative-director/src/index.js";
import {
  validateCreativeExecutionBundle,
  type CreativeExecutionBundle,
  type CreativeExecutionValidation,
  type CreativeToolAction,
} from "../../../packages/creative-director/src/execution.js";

export interface CreativeDirectorPreparation {
  plan: CreativeDirectorPlan;
  reviewInput: CreativeReviewInput;
  deckHash: string;
  activeBranchId: string;
}

export interface CreativeActionTrace {
  actionId: string;
  stepId: string;
  tool: CreativeToolAction["tool"];
  beforeDeckHash: string;
  afterDeckHash: string;
  branchId: string;
  ok: boolean;
  reason?: string;
  error?: string;
}

export interface CreativeDirectorExecutionResult {
  validation: CreativeExecutionValidation;
  executed: boolean;
  originalBranchId: string;
  executionBranchId: string;
  activeBranchId: string;
  previewBranchId?: string;
  traces: CreativeActionTrace[];
  review?: CreativeExecutionReview;
  rejectedPreviewReturnedToOriginal: boolean;
  error?: string;
}

function referencedAssetIds(deck: CreativeReviewInput["deck"]): Set<string> {
  const ids = new Set<string>();
  for (const slide of deck.slides) for (const element of slide.scene) {
    if (element.type === "image" || element.type === "icon" || element.type === "video") ids.add(element.assetId);
    if (element.type === "video" && element.posterAssetId) ids.add(element.posterAssetId);
  }
  return ids;
}

function staleMotionReferenceCount(input: CreativeReviewInput["deck"], motion: Awaited<ReturnType<PitchWorkspaceService["state"]>>["motion"]): number {
  const staleCodes = new Set([
    "motion:deck-mismatch",
    "motion:missing-slide",
    "motion:track-slide-mismatch",
    "motion:missing-element",
    "motion:build-slide-mismatch",
    "motion:missing-build-element",
  ]);
  return validateMotionDocument(input, motion).filter((issue) => staleCodes.has(issue.code)).length;
}

export async function collectCreativeReviewInput(service: PitchWorkspaceService): Promise<CreativeReviewInput> {
  const state = await service.state();
  const theme = (state.deck as any).theme;
  const referenced = referencedAssetIds(state.deck);
  const available = new Set((state.assets ?? []).map((asset: any) => asset.id));
  const missingBytes = [...referenced].filter((id) => !available.has(id)).length;
  const unused = (state.assets ?? []).filter((asset: any) => !asset.usageCount).length;
  const oversized = (state.assets ?? []).filter((asset: any) => Number(asset.bytes ?? 0) > 20 * 1024 * 1024).length;
  return {
    deck: state.deck,
    deterministicQA: state.qa,
    brandQA: runBrandQA(state.deck, theme),
    brandCoverage: brandCoverage(state.deck),
    masterQA: runSlideMasterQA(state.deck),
    assets: { total: (state.assets ?? []).length, missingBytes, unused, oversized },
    motion: {
      slidesWithMotion: state.motion.slides.filter((slide) => Boolean(slide.transition) || slide.builds.length > 0 || slide.tracks.length > 0).length,
      staleReferences: staleMotionReferenceCount(state.deck, state.motion),
    },
  };
}

function validateScopeHandles(deck: CreativeReviewInput["deck"], scope: CreativeScope): string[] {
  const problems: string[] = [];
  const slides = new Map(deck.slides.map((slide) => [slide.id, slide]));
  for (const slideId of scope.slideIds ?? []) if (!slides.has(slideId)) problems.push(`Unknown scoped slide ${slideId}`);
  if (scope.kind === "selection") {
    const allowedSlides = (scope.slideIds ?? []).map((id) => slides.get(id)).filter(Boolean);
    const allowedElements = new Set(allowedSlides.flatMap((slide) => slide!.scene.map((element) => element.id)));
    for (const elementId of scope.elementIds ?? []) if (!allowedElements.has(elementId)) problems.push(`Unknown scoped element ${elementId} in the selected slide scope`);
  }
  return problems;
}

export async function prepareCreativeDirectorPlan(service: PitchWorkspaceService, request: CreativeChangeRequest): Promise<CreativeDirectorPreparation> {
  const input = await collectCreativeReviewInput(service);
  const state = await service.state();
  const plan = buildCreativeDirectorPlan(request, input);
  const handleProblems = validateScopeHandles(input.deck, request.scope);
  if (handleProblems.length) {
    plan.blockers.push(...handleProblems);
    plan.blocked = true;
  }
  return { plan, reviewInput: input, deckHash: state.deckHash, activeBranchId: state.manifest.activeBranchId };
}

function withCurrentHashes(action: CreativeToolAction, state: Awaited<ReturnType<PitchWorkspaceService["state"]>>): Record<string, unknown> {
  const args: Record<string, unknown> = { ...action.args };
  if (args.expectedDeckHash === undefined) args.expectedDeckHash = state.deckHash;
  if (action.tool === "pitch_motion_command" && args.expectedMotionHash === undefined && state.motionHash) args.expectedMotionHash = state.motionHash;
  return args;
}

async function dispatchAction(service: PitchWorkspaceService, tools: PitchToolRuntime, action: CreativeToolAction): Promise<{ reason?: string }> {
  const state = await service.state();
  const args = withCurrentHashes(action, state);
  if (action.tool === "pitch_design_command") {
    const result = await executeWorkspaceDesignCommand(service, args as WorkspaceDesignCommand);
    return { reason: result.commandReason };
  }
  if (action.tool === "pitch_master_command") {
    const result = await executeWorkspaceSlideMasterCommand(service, args as WorkspaceSlideMasterCommand);
    return { reason: result.commandReason };
  }
  const result = await tools.callTool(action.tool, args);
  if (!result.ok) throw new Error(result.error ?? `${action.tool} failed`);
  const data = result.data as any;
  return { reason: data?.commandReason ?? data?.reason };
}

function previewName(bundle: CreativeExecutionBundle): string {
  const requested = bundle.previewBranchName?.trim();
  return requested || `Creative ${bundle.requestId.slice(0, 28)} ${randomUUID().slice(0, 6)}`;
}

export class CreativeDirectorRuntime {
  readonly service: PitchWorkspaceService;
  readonly tools: PitchToolRuntime;

  constructor(projectRoot: string) {
    this.service = new PitchWorkspaceService(projectRoot);
    this.tools = new PitchToolRuntime(this.service);
  }

  async prepare(request: CreativeChangeRequest): Promise<CreativeDirectorPreparation> {
    return prepareCreativeDirectorPlan(this.service, request);
  }

  async review() {
    const input = await collectCreativeReviewInput(this.service);
    return { input, review: reviewCreativeQuality(input), state: await this.service.state() };
  }

  async execute(plan: CreativeDirectorPlan, bundle: CreativeExecutionBundle, acceptanceResults: Record<string, boolean> = {}): Promise<CreativeDirectorExecutionResult> {
    const validation = validateCreativeExecutionBundle(plan, bundle);
    const originalState = await this.service.state();
    const originalBranchId = originalState.manifest.activeBranchId;
    if (!validation.valid) {
      return { validation, executed: false, originalBranchId, executionBranchId: originalBranchId, activeBranchId: originalBranchId, traces: [], rejectedPreviewReturnedToOriginal: false, error: validation.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("; ") };
    }

    let executionBranchId = originalBranchId;
    let previewBranchId: string | undefined;
    if (validation.effectiveMode === "previewBranch") {
      const forked = await this.service.fork(previewName(bundle));
      executionBranchId = forked.manifest.activeBranchId;
      previewBranchId = executionBranchId;
    }

    const traces: CreativeActionTrace[] = [];
    try {
      for (const action of validation.orderedActions) {
        const before = await this.service.state();
        const trace: CreativeActionTrace = { actionId: action.id, stepId: action.stepId, tool: action.tool, beforeDeckHash: before.deckHash, afterDeckHash: before.deckHash, branchId: before.manifest.activeBranchId, ok: false };
        try {
          const outcome = await dispatchAction(this.service, this.tools, action);
          const after = await this.service.state();
          trace.afterDeckHash = after.deckHash;
          trace.ok = true;
          trace.reason = outcome.reason;
          traces.push(trace);
        } catch (error) {
          trace.error = error instanceof Error ? error.message : String(error);
          traces.push(trace);
          throw error;
        }
      }

      const afterInput = await collectCreativeReviewInput(this.service);
      const review = reviewCreativeExecution(plan, afterInput, acceptanceResults);
      if (!review.accepted && previewBranchId) {
        await this.service.checkout(originalBranchId);
        return { validation, executed: true, originalBranchId, executionBranchId, activeBranchId: originalBranchId, previewBranchId, traces, review, rejectedPreviewReturnedToOriginal: true };
      }
      const final = await this.service.state();
      return { validation, executed: true, originalBranchId, executionBranchId, activeBranchId: final.manifest.activeBranchId, previewBranchId, traces, review, rejectedPreviewReturnedToOriginal: false };
    } catch (error) {
      if (previewBranchId) await this.service.checkout(originalBranchId).catch(() => undefined);
      const current = await this.service.state();
      return { validation, executed: true, originalBranchId, executionBranchId, activeBranchId: current.manifest.activeBranchId, previewBranchId, traces, rejectedPreviewReturnedToOriginal: Boolean(previewBranchId), error: error instanceof Error ? error.message : String(error) };
    }
  }
}
