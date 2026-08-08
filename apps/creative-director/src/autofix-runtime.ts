import type { BranchArtifactHead } from "../../../packages/artifact-store/src/index.js";
import { buildCreativeSafeFixPlan } from "../../../packages/creative-director/src/autofix.js";
import { executeDesignCommand } from "../../../packages/design-system/src/index.js";
import { runBrandQA } from "../../../packages/brand-qa/src/index.js";
import { runDeterministicQA } from "../../../packages/qa/src/index.js";
import { PitchWorkspaceService } from "../../workspace/src/server.js";

function deckHead(current: Awaited<ReturnType<PitchWorkspaceService["state"]>>): BranchArtifactHead {
  const head = Object.values(current.manifest.branches[current.manifest.activeBranchId]?.heads ?? {}).find((item) => item.kind === "deck");
  if (!head) throw new Error("No deck artifact on active branch");
  return head;
}

export async function previewCreativeSafeFixes(service: PitchWorkspaceService) {
  const current = await service.state();
  return { deckHash: current.deckHash, activeBranchId: current.manifest.activeBranchId, plan: buildCreativeSafeFixPlan(current.deck) };
}

export async function executeCreativeSafeFixes(service: PitchWorkspaceService, expectedDeckHash?: string) {
  const current = await service.state();
  if (expectedDeckHash && expectedDeckHash !== current.deckHash) throw new Error(`Deck changed since safe fixes were reviewed: expected ${expectedDeckHash}, got ${current.deckHash}`);
  const plan = buildCreativeSafeFixPlan(current.deck);
  if (!plan.commands.length) return { ...current, plan, commandReason: "No deterministic safe fixes available", affectedSlideIds: [], affectedElementIds: [] };

  let deck = current.deck;
  const affectedSlideIds = new Set<string>();
  const affectedElementIds = new Set<string>();
  for (const command of plan.commands) {
    const result = executeDesignCommand(deck, command);
    deck = result.deck;
    result.affectedSlideIds.forEach((id) => affectedSlideIds.add(id));
    result.affectedElementIds.forEach((id) => affectedElementIds.add(id));
  }

  const head = deckHead(current);
  await service.journal.record(current.manifest.activeBranchId, head);
  const deckArtifact = await service.store.write({ id: head.id, kind: "deck", payload: deck, producer: { type: "deterministic" }, inputs: [head] });
  await service.journal.record(current.manifest.activeBranchId, { id: deckArtifact.id, kind: deckArtifact.kind, version: deckArtifact.version, contentHash: deckArtifact.contentHash, status: deckArtifact.status });

  const qa = runDeterministicQA(deck);
  const brandQA = runBrandQA(deck, (deck as any).theme);
  await service.store.write({
    id: "qa_current",
    kind: "qa",
    payload: {
      deckId: deck.id,
      issues: qa,
      brandIssues: brandQA,
      reason: `Creative Director safe fixes · ${plan.suggestionCount} exact token bindings`,
      impact: {
        affectedSlideIds: [...affectedSlideIds],
        affectedElementIds: [...affectedElementIds],
        staleArtifacts: ["qa:brand", "export"],
        narrativeChanged: false,
        evidenceRisk: false,
        slideOrderChanged: false,
      },
    },
    producer: { type: "deterministic" },
    inputs: [deckArtifact],
    status: qa.some((issue) => issue.severity === "critical") || brandQA.some((issue) => issue.severity === "major") ? "needsReview" : "ready",
  });
  const next = await service.state();
  return { ...next, plan, commandReason: `Creative Director safe fixes · ${plan.suggestionCount} exact token bindings`, affectedSlideIds: [...affectedSlideIds], affectedElementIds: [...affectedElementIds], brandQA };
}
