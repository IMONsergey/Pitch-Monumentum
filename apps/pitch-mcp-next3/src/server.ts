import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPitchMcpNext2Server } from "../../pitch-mcp-next2/src/server.js";
import { CreativeDirectorRuntime, type CreativeDirectorPreparation } from "../../creative-director/src/runtime.js";
import { executeCreativeSafeFixes, previewCreativeSafeFixes } from "../../creative-director/src/autofix-runtime.js";
import { acceptCreativePreview, discardCreativePreview, reviewCreativePreview } from "../../creative-director/src/branch-review.js";
import type { CreativeChangeRequest } from "../../../packages/creative-director/src/index.js";
import type { CreativeExecutionBundle } from "../../../packages/creative-director/src/execution.js";

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent: value as any };
}

const intent = z.enum(["polish", "layout", "brand", "media", "content", "data", "motion", "system"]);
const scope = z.object({
  kind: z.enum(["selection", "slide", "deck"]),
  slideIds: z.array(z.string().min(1)).optional(),
  elementIds: z.array(z.string().min(1)).optional(),
});
const request = z.object({
  id: z.string().min(1),
  instruction: z.string().min(1),
  intent: z.array(intent).min(1),
  scope,
  aggressiveness: z.enum(["conservative", "balanced", "bold"]).optional(),
  mustPreserve: z.array(z.string()).optional(),
  allowGlobalPropagation: z.boolean().optional(),
  allowNarrativeChange: z.boolean().optional(),
  allowEvidenceChange: z.boolean().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
});
const canonicalTool = z.enum([
  "pitch_editor_command",
  "pitch_media_command",
  "pitch_design_command",
  "pitch_component_command",
  "pitch_master_command",
  "pitch_motion_command",
]);
const action = z.object({ id: z.string().min(1), stepId: z.string().min(1), tool: canonicalTool, args: z.record(z.string(), z.unknown()) });

export function createPitchMcpNext3Server(projectRoot: string) {
  const root = resolve(projectRoot);
  const server = createPitchMcpNext2Server(root);
  const director = new CreativeDirectorRuntime(root);
  const plans = new Map<string, CreativeDirectorPreparation>();

  server.registerTool("pitch_creative_review", {
    title: "Review Pitch production quality",
    description: "Run Creative Director production review across structure, evidence, visual, Brand QA/token coverage, editability, project assets, Slide Masters and Motion integrity.",
    inputSchema: {},
  }, async () => {
    const reviewed = await director.review();
    const activeBranch = reviewed.state.manifest.branches[reviewed.state.manifest.activeBranchId];
    const previewReview = activeBranch?.parentBranchId ? await reviewCreativePreview(director.service, activeBranch.id).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })) : null;
    return result({
      deckId: reviewed.state.deck.id,
      deckHash: reviewed.state.deckHash,
      activeBranchId: reviewed.state.manifest.activeBranchId,
      review: reviewed.review,
      assets: reviewed.input.assets,
      motion: reviewed.input.motion,
      masterQA: reviewed.input.masterQA,
      brandCoverage: reviewed.input.brandCoverage,
      previewReview,
    });
  });

  server.registerTool("pitch_creative_safe_fix_preview", {
    title: "Preview deterministic Creative Director safe fixes",
    description: "Preview only exact visually-neutral live-theme token bindings. This does not move objects, alter content, reapply masters or make approximate style guesses.",
    inputSchema: {},
  }, async () => result(await previewCreativeSafeFixes(director.service)));

  server.registerTool("pitch_creative_safe_fix_apply", {
    title: "Apply deterministic Creative Director safe fixes",
    description: "Apply the currently reviewed exact safe fixes as one ordinary deck version / one undo point. Requires the deck hash from pitch_creative_safe_fix_preview.",
    inputSchema: { expectedDeckHash: z.string().min(1) },
  }, async ({ expectedDeckHash }) => {
    const applied = await executeCreativeSafeFixes(director.service, expectedDeckHash);
    return result({ deckHash: applied.deckHash, activeBranchId: applied.manifest.activeBranchId, plan: applied.plan, commandReason: applied.commandReason, affectedSlideIds: applied.affectedSlideIds, affectedElementIds: applied.affectedElementIds, history: applied.history });
  });

  server.registerTool("pitch_creative_plan", {
    title: "Plan a guarded Creative Director change",
    description: "Create a server-issued Creative Director plan from an instruction, intent and explicit scope. The plan contains quality baseline, risk, required approvals and canonical tool-family steps. Use its requestId for execution; do not invent a plan client-side.",
    inputSchema: {
      id: z.string().min(1), instruction: z.string().min(1), intent: z.array(intent).min(1), scope,
      aggressiveness: z.enum(["conservative", "balanced", "bold"]).optional(), mustPreserve: z.array(z.string()).optional(),
      allowGlobalPropagation: z.boolean().optional(), allowNarrativeChange: z.boolean().optional(), allowEvidenceChange: z.boolean().optional(), acceptanceCriteria: z.array(z.string()).optional(),
    },
  }, async (args) => {
    const parsed = request.parse(args) as CreativeChangeRequest;
    const prepared = await director.prepare(parsed);
    plans.set(prepared.plan.requestId, prepared);
    return result({ plan: prepared.plan, deckHash: prepared.deckHash, activeBranchId: prepared.activeBranchId });
  });

  server.registerTool("pitch_creative_execute", {
    title: "Execute a server-issued Creative Director plan",
    description: "Validate and execute concrete canonical Pitch tool calls against a previously server-issued Creative Director plan. High-risk/global edits default to an isolated preview branch. Stale plans are refused and every executed run receives a branch-local audit artifact.",
    inputSchema: {
      requestId: z.string().min(1),
      mode: z.enum(["currentBranch", "previewBranch"]).optional(),
      previewBranchName: z.string().optional(),
      approvedStepIds: z.array(z.string()).optional(),
      directHighRiskWriteApproved: z.boolean().optional(),
      actions: z.array(action).max(80),
      acceptanceResults: z.record(z.string(), z.boolean()).optional(),
    },
  }, async (args) => {
    const prepared = plans.get(args.requestId);
    if (!prepared) return result({ ok: false, error: `No server-issued Creative Director plan ${args.requestId}; call pitch_creative_plan first.` });
    const current = await director.service.state();
    if (current.manifest.activeBranchId !== prepared.activeBranchId || current.deckHash !== prepared.deckHash) {
      plans.delete(args.requestId);
      return result({ ok: false, stalePlan: true, error: "Pitch project changed after this Creative Director plan was issued. Re-read state and call pitch_creative_plan again.", plannedDeckHash: prepared.deckHash, currentDeckHash: current.deckHash, plannedBranchId: prepared.activeBranchId, currentBranchId: current.manifest.activeBranchId });
    }
    const bundle: CreativeExecutionBundle = {
      schemaVersion: "0.1",
      requestId: prepared.plan.requestId,
      deckId: prepared.plan.deckId,
      mode: args.mode,
      previewBranchName: args.previewBranchName,
      approvedStepIds: args.approvedStepIds,
      directHighRiskWriteApproved: args.directHighRiskWriteApproved,
      actions: args.actions as CreativeExecutionBundle["actions"],
    };
    const executed = await director.execute(prepared.plan, bundle, args.acceptanceResults ?? {});
    plans.delete(args.requestId);
    return result({ ok: !executed.error && executed.validation.valid, ...executed });
  });

  server.registerTool("pitch_creative_plan_status", {
    title: "Read Creative Director plan status",
    description: "Read whether a server-issued Creative Director plan is still registered and whether the deck/branch hash is still current before execution.",
    inputSchema: { requestId: z.string().min(1) },
  }, async ({ requestId }) => {
    const prepared = plans.get(requestId);
    const current = await director.service.state();
    if (!prepared) return result({ requestId, exists: false, currentDeckHash: current.deckHash, currentBranchId: current.manifest.activeBranchId });
    return result({ requestId, exists: true, stale: current.deckHash !== prepared.deckHash || current.manifest.activeBranchId !== prepared.activeBranchId, plannedDeckHash: prepared.deckHash, currentDeckHash: current.deckHash, plannedBranchId: prepared.activeBranchId, currentBranchId: current.manifest.activeBranchId, plan: prepared.plan });
  });

  server.registerTool("pitch_creative_preview_review", {
    title: "Review Creative Director preview branch",
    description: "Inspect object-level deck diff, changed artifact kinds, system/theme/master changes and merge blockers for a Creative preview branch before acceptance.",
    inputSchema: { previewBranchId: z.string().min(1) },
  }, async ({ previewBranchId }) => result(await reviewCreativePreview(director.service, previewBranchId)));

  server.registerTool("pitch_creative_preview_accept", {
    title: "Accept Creative Director preview",
    description: "Accept a reviewed conflict-free Creative preview into its original branch. Requires the exact target/preview deck hashes returned by pitch_creative_preview_review. Component-artifact previews and stale-parent previews are refused rather than partially merged.",
    inputSchema: { previewBranchId: z.string().min(1), expectedTargetDeckHash: z.string().min(1), expectedPreviewDeckHash: z.string().min(1) },
  }, async (args) => {
    const accepted = await acceptCreativePreview(director.service, args);
    return result({ acceptedIntoBranchId: accepted.acceptedIntoBranchId, previewBranchId: accepted.previewBranchId, review: accepted.review, deckHash: accepted.state.deckHash, activeBranchId: accepted.state.manifest.activeBranchId, history: accepted.state.history, motionHistory: accepted.state.motionHistory });
  });

  server.registerTool("pitch_creative_preview_discard", {
    title: "Return from Creative Director preview",
    description: "Return to the preview's original parent branch without deleting the preview. The preview and its Creative run audit stay available for later inspection.",
    inputSchema: { previewBranchId: z.string().min(1) },
  }, async ({ previewBranchId }) => {
    const discarded = await discardCreativePreview(director.service, previewBranchId);
    return result({ discardedPreviewBranchId: discarded.discardedPreviewBranchId, activeBranchId: discarded.activeBranchId, review: discarded.review, deckHash: discarded.state.deckHash });
  });

  return server;
}

export async function runPitchMcpNext3Server(projectRoot: string): Promise<void> {
  await createPitchMcpNext3Server(projectRoot).connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runPitchMcpNext3Server(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
