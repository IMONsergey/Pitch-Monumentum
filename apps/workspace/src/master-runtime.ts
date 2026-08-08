import type { BranchArtifactHead } from "../../../packages/artifact-store/src/index.js";
import { runDeterministicQA } from "../../../packages/qa/src/index.js";
import { executeProductionSlideMasterCommand } from "../../../packages/slide-master-commands/src/production.js";
import { recommendMastersForSlide, type MasteredDeckDocument, type SlideMasterCommand } from "../../../packages/slide-master-commands/src/index.js";
import { PitchWorkspaceService } from "./server.js";

export type WorkspaceSlideMasterCommand = SlideMasterCommand & { expectedDeckHash?: string };

function deckHead(current: Awaited<ReturnType<PitchWorkspaceService["state"]>>): BranchArtifactHead {
  const head = Object.values(current.manifest.branches[current.manifest.activeBranchId]?.heads ?? {}).find((item) => item.kind === "deck");
  if (!head) throw new Error("No deck artifact on active branch");
  return head;
}

export async function readSlideMasterState(service: PitchWorkspaceService, slideId?: string) {
  const current = await service.state();
  const masters = Object.values((current.deck as MasteredDeckDocument).slideMasters ?? {});
  return {
    deckHash: current.deckHash,
    masters,
    recommendations: slideId ? recommendMastersForSlide(current.deck, slideId) : [],
    activeSlideId: slideId ?? null,
  };
}

export async function executeWorkspaceSlideMasterCommand(service: PitchWorkspaceService, input: WorkspaceSlideMasterCommand) {
  const current = await service.state();
  if (input.expectedDeckHash && input.expectedDeckHash !== current.deckHash) throw new Error(`Deck changed since master command was authored: expected ${input.expectedDeckHash}, got ${current.deckHash}`);
  const { expectedDeckHash: _expectedDeckHash, ...command } = input;
  const result = executeProductionSlideMasterCommand(current.deck, command as SlideMasterCommand);
  if (!result.changed) return { ...current, commandReason: result.reason, master: result.master, affectedSlideIds: [], affectedElementIds: [], nextSelectionIds: result.nextSelectionIds };

  const head = deckHead(current);
  await service.journal.record(current.manifest.activeBranchId, head);
  const deckArtifact = await service.store.write({ id: head.id, kind: "deck", payload: result.deck, producer: { type: "user" }, inputs: [head] });
  await service.journal.record(current.manifest.activeBranchId, { id: deckArtifact.id, kind: deckArtifact.kind, version: deckArtifact.version, contentHash: deckArtifact.contentHash, status: deckArtifact.status });
  const qa = runDeterministicQA(result.deck);
  await service.store.write({
    id: "qa_current", kind: "qa",
    payload: { deckId: result.deck.id, issues: qa, reason: result.reason, impact: { affectedSlideIds: result.affectedSlideIds, affectedElementIds: result.affectedElementIds, staleArtifacts: ["storyboard", "qa:visual", "qa:readability", "export"], narrativeChanged: false, evidenceRisk: false, slideOrderChanged: false } },
    producer: { type: "deterministic" }, inputs: [deckArtifact], status: qa.some((issue) => issue.severity === "critical") ? "needsReview" : "ready",
  });
  const next = await service.state();
  return { ...next, commandReason: result.reason, master: result.master, affectedSlideIds: result.affectedSlideIds, affectedElementIds: result.affectedElementIds, nextSelectionIds: result.nextSelectionIds };
}
