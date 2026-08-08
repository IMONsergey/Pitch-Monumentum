import type { BranchArtifactHead } from "../../../packages/artifact-store/src/index.js";
import { executeDesignCommand, type DesignCommand } from "../../../packages/design-system/src/index.js";
import { runBrandQA } from "../../../packages/brand-qa/src/index.js";
import { runDeterministicQA } from "../../../packages/qa/src/index.js";
import { PitchWorkspaceService } from "./server.js";

export type WorkspaceDesignCommand = DesignCommand & { expectedDeckHash?: string };

function deckHead(current: Awaited<ReturnType<PitchWorkspaceService["state"]>>): BranchArtifactHead {
  const head = Object.values(current.manifest.branches[current.manifest.activeBranchId]?.heads ?? {}).find((item) => item.kind === "deck");
  if (!head) throw new Error("No deck artifact on active branch");
  return head;
}

/** Apply one design-system action as one ordinary deck version in the same VersionJournal used by the visual editor. */
export async function executeWorkspaceDesignCommand(service: PitchWorkspaceService, input: WorkspaceDesignCommand) {
  const current = await service.state();
  if (input.expectedDeckHash && input.expectedDeckHash !== current.deckHash) throw new Error(`Deck changed since design command was authored: expected ${input.expectedDeckHash}, got ${current.deckHash}`);
  const { expectedDeckHash: _expectedDeckHash, ...command } = input;
  const result = executeDesignCommand(current.deck, command as DesignCommand);
  if (!result.changed) return { ...current, designAudit: result.audit, brandQA: runBrandQA(current.deck, (current.deck as any).theme), commandReason: result.reason, affectedSlideIds: [], affectedElementIds: [] };

  const head = deckHead(current);
  await service.journal.record(current.manifest.activeBranchId, head);
  const deckArtifact = await service.store.write({ id: head.id, kind: "deck", payload: result.deck, producer: { type: "user" }, inputs: [head] });
  await service.journal.record(current.manifest.activeBranchId, { id: deckArtifact.id, kind: deckArtifact.kind, version: deckArtifact.version, contentHash: deckArtifact.contentHash, status: deckArtifact.status });

  const qa = runDeterministicQA(result.deck);
  const brandQA = runBrandQA(result.deck, (result.deck as any).theme);
  await service.store.write({
    id: "qa_current",
    kind: "qa",
    payload: {
      deckId: result.deck.id,
      issues: qa,
      brandIssues: brandQA,
      reason: result.reason,
      impact: { affectedSlideIds: result.affectedSlideIds, affectedElementIds: result.affectedElementIds, staleArtifacts: ["qa:visual", "qa:brand", "export"], narrativeChanged: false, evidenceRisk: false, slideOrderChanged: false },
    },
    producer: { type: "deterministic" },
    inputs: [deckArtifact],
    status: qa.some((issue) => issue.severity === "critical") || brandQA.some((issue) => issue.severity === "major") ? "needsReview" : "ready",
  });

  const next = await service.state();
  return { ...next, designAudit: result.audit, brandQA, commandReason: result.reason, affectedSlideIds: result.affectedSlideIds, affectedElementIds: result.affectedElementIds };
}
