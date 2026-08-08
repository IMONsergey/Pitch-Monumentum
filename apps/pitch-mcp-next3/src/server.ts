import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPitchMcpNext2Server } from "../../pitch-mcp-next2/src/server.js";
import { CreativeDirectorRuntime, type CreativeDirectorPreparation } from "../../creative-director/src/runtime.js";
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
    description: "Run the Creative Director production review across deterministic QA, Brand QA/token coverage, editability, project assets, Slide Masters and Motion integrity.",
    inputSchema: {},
  }, async () => {
    const reviewed = await director.review();
    return result({
      deckId: reviewed.state.deck.id,
      deckHash: reviewed.state.deckHash,
      activeBranchId: reviewed.state.manifest.activeBranchId,
      review: reviewed.review,
      assets: reviewed.input.assets,
      motion: reviewed.input.motion,
      masterQA: reviewed.input.masterQA,
      brandCoverage: reviewed.input.brandCoverage,
    });
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
    description: "Validate and execute concrete canonical Pitch tool calls against a previously server-issued Creative Director plan. High-risk/global edits default to an isolated preview branch. Stale plans are refused and post-review can return a rejected preview to the original branch.",
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

  return server;
}

export async function runPitchMcpNext3Server(projectRoot: string): Promise<void> {
  await createPitchMcpNext3Server(projectRoot).connect(new StdioServerTransport());
}

if (process.argv[1]?.endsWith("server.js")) runPitchMcpNext3Server(process.argv[2] ?? ".pitch-demo").catch((error) => { console.error(error); process.exitCode = 1; });
