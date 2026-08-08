import type { BranchArtifactHead, ProjectBranch } from "../../../packages/artifact-store/src/index.js";
import type { DeckDocument } from "../../../packages/deck-model/src/index.js";
import { diffDecks, type DeckDiff } from "../../../packages/deck-diff/src/index.js";
import { deckHash as computeDeckHash } from "../../../packages/mutations/src/index.js";
import { emptyMotionDocument } from "../../../packages/motion-commands/src/index.js";
import type { MotionDocument } from "../../../packages/motion-engine/src/index.js";
import { runDeterministicQA } from "../../../packages/qa/src/index.js";
import { PitchWorkspaceService } from "../../workspace/src/server.js";

export interface BranchArtifactChange {
  artifactId: string;
  kind: string;
  status: "added" | "removed" | "changed";
  base?: BranchArtifactHead;
  current?: BranchArtifactHead;
}

export interface CreativePreviewReview {
  schemaVersion: "0.1";
  previewBranchId: string;
  previewBranchName: string;
  targetBranchId: string;
  targetBranchName: string;
  baseAvailable: boolean;
  targetUnchangedSinceFork: boolean;
  targetDeckHash: string;
  previewDeckHash: string;
  changedArtifacts: BranchArtifactChange[];
  changedArtifactKinds: string[];
  deckDiff: DeckDiff;
  mergeable: boolean;
  blockers: string[];
  notes: string[];
}

const DERIVED_KINDS = new Set(["qa", "creativeRun"]);
const DIRECT_ACCEPT_KINDS = new Set(["deck", "motion", "qa", "creativeRun"]);

function sameHead(a?: BranchArtifactHead, b?: BranchArtifactHead): boolean {
  return Boolean(a && b && a.id === b.id && a.kind === b.kind && a.version === b.version && a.contentHash === b.contentHash);
}

function headByKind(branch: ProjectBranch, kind: string): BranchArtifactHead | undefined {
  return Object.values(branch.heads).find((head) => head.kind === kind);
}

function artifactChanges(base: Record<string, BranchArtifactHead>, current: Record<string, BranchArtifactHead>): BranchArtifactChange[] {
  const ids = [...new Set([...Object.keys(base), ...Object.keys(current)])];
  const changes: BranchArtifactChange[] = [];
  for (const id of ids) {
    const before = base[id]; const after = current[id];
    if (sameHead(before, after)) continue;
    changes.push({ artifactId: id, kind: after?.kind ?? before?.kind ?? "unknown", status: !before ? "added" : !after ? "removed" : "changed", base: before ? structuredClone(before) : undefined, current: after ? structuredClone(after) : undefined });
  }
  return changes.sort((a, b) => a.kind.localeCompare(b.kind) || a.artifactId.localeCompare(b.artifactId));
}

function targetChangedSinceFork(base: Record<string, BranchArtifactHead>, target: Record<string, BranchArtifactHead>): boolean {
  const relevant = (heads: Record<string, BranchArtifactHead>) => Object.fromEntries(Object.entries(heads).filter(([, head]) => !DERIVED_KINDS.has(head.kind)));
  return artifactChanges(relevant(base), relevant(target)).length > 0;
}

async function readBranchDeck(service: PitchWorkspaceService, branch: ProjectBranch): Promise<{ head: BranchArtifactHead; deck: DeckDocument; hash: string }> {
  const head = headByKind(branch, "deck");
  if (!head) throw new Error(`Branch ${branch.id} has no deck head`);
  const stored = (await service.store.read<DeckDocument>(head.id, head.version)).payload;
  const deck = stored.activeBranchId === branch.id ? stored : { ...stored, activeBranchId: branch.id };
  return { head, deck, hash: computeDeckHash(deck) };
}

export async function reviewCreativePreview(service: PitchWorkspaceService, previewBranchId: string): Promise<CreativePreviewReview> {
  const manifest = await service.store.readManifest();
  const preview = manifest.branches[previewBranchId];
  if (!preview) throw new Error(`Unknown preview branch ${previewBranchId}`);
  if (!preview.parentBranchId) throw new Error(`Branch ${previewBranchId} is not a forked preview branch`);
  const target = manifest.branches[preview.parentBranchId];
  if (!target) throw new Error(`Preview parent branch ${preview.parentBranchId} no longer exists`);
  const base = preview.baseHeads;
  const blockers: string[] = [];
  const notes: string[] = [];
  if (!base) blockers.push("Preview was created before fork-base tracking existed; automatic accept is disabled. Re-plan into a new preview branch.");
  const targetUnchangedSinceFork = base ? !targetChangedSinceFork(base, target.heads) : false;
  if (base && !targetUnchangedSinceFork) blockers.push("Target branch changed after this preview was forked. Re-plan/rebase instead of overwriting newer work.");

  const changedArtifacts = artifactChanges(base ?? {}, preview.heads);
  const changedArtifactKinds = [...new Set(changedArtifacts.map((change) => change.kind))].sort();
  const unsupported = changedArtifacts.filter((change) => !DIRECT_ACCEPT_KINDS.has(change.kind));
  if (unsupported.length) blockers.push(`Automatic accept does not yet merge artifact kinds: ${[...new Set(unsupported.map((change) => change.kind))].join(", ")}. Keep/review the preview branch instead.`);
  if (changedArtifacts.some((change) => change.kind === "motion")) notes.push("Motion is accepted into its independent motion history; deck and motion remain separately undoable by design.");
  if (changedArtifacts.some((change) => change.kind === "creativeRun")) notes.push("Creative run audit artifacts stay on the preview branch and are not copied into the target branch.");

  const targetDeck = await readBranchDeck(service, target);
  const previewDeck = await readBranchDeck(service, preview);
  const deckDiff = diffDecks(targetDeck.deck, previewDeck.deck);
  if (!deckDiff.changed && !changedArtifacts.some((change) => change.kind === "motion")) notes.push("Preview contains no deck or motion change to accept.");

  return {
    schemaVersion: "0.1",
    previewBranchId: preview.id,
    previewBranchName: preview.name,
    targetBranchId: target.id,
    targetBranchName: target.name,
    baseAvailable: Boolean(base),
    targetUnchangedSinceFork,
    targetDeckHash: targetDeck.hash,
    previewDeckHash: previewDeck.hash,
    changedArtifacts,
    changedArtifactKinds,
    deckDiff,
    mergeable: blockers.length === 0,
    blockers,
    notes,
  };
}

async function writeDeckAccept(service: PitchWorkspaceService, targetBranchId: string, targetHead: BranchArtifactHead, previewHead: BranchArtifactHead, previewDeck: DeckDocument) {
  await service.journal.record(targetBranchId, targetHead);
  const artifact = await service.store.write({
    id: targetHead.id,
    kind: "deck",
    payload: { ...previewDeck, activeBranchId: targetBranchId },
    producer: { type: "codex" },
    inputs: [targetHead, previewHead],
  });
  const nextHead: BranchArtifactHead = { id: artifact.id, kind: artifact.kind, version: artifact.version, contentHash: artifact.contentHash, status: artifact.status };
  await service.journal.record(targetBranchId, nextHead);
  return nextHead;
}

async function writeMotionAccept(service: PitchWorkspaceService, targetBranchId: string, targetDeck: DeckDocument, targetHead: BranchArtifactHead | undefined, previewHead: BranchArtifactHead, previewMotion: MotionDocument) {
  if (targetHead) await service.journal.record(targetBranchId, targetHead);
  else {
    const baseline = await service.store.write({ id: previewHead.id, kind: "motion", payload: emptyMotionDocument(targetDeck), producer: { type: "deterministic" } });
    await service.journal.record(targetBranchId, { id: baseline.id, kind: baseline.kind, version: baseline.version, contentHash: baseline.contentHash, status: baseline.status });
  }
  const artifact = await service.store.write({ id: previewHead.id, kind: "motion", payload: previewMotion, producer: { type: "codex" }, inputs: [...(targetHead ? [targetHead] : []), previewHead] });
  const nextHead: BranchArtifactHead = { id: artifact.id, kind: artifact.kind, version: artifact.version, contentHash: artifact.contentHash, status: artifact.status };
  await service.journal.record(targetBranchId, nextHead);
  return nextHead;
}

export async function acceptCreativePreview(
  service: PitchWorkspaceService,
  input: { previewBranchId: string; expectedTargetDeckHash: string; expectedPreviewDeckHash: string },
) {
  const review = await reviewCreativePreview(service, input.previewBranchId);
  if (!review.mergeable) throw new Error(`Creative preview cannot be auto-accepted: ${review.blockers.join("; ")}`);
  if (review.targetDeckHash !== input.expectedTargetDeckHash) throw new Error(`Target branch changed since preview review: expected ${input.expectedTargetDeckHash}, got ${review.targetDeckHash}`);
  if (review.previewDeckHash !== input.expectedPreviewDeckHash) throw new Error(`Preview branch changed since review: expected ${input.expectedPreviewDeckHash}, got ${review.previewDeckHash}`);

  const manifest = await service.store.readManifest();
  const preview = manifest.branches[review.previewBranchId];
  const target = manifest.branches[review.targetBranchId];
  if (!preview || !target) throw new Error("Preview/target branch disappeared during accept");
  const previewDeckHead = headByKind(preview, "deck")!;
  const targetDeckHead = headByKind(target, "deck")!;
  const previewDeck = (await readBranchDeck(service, preview)).deck;
  const previewMotionHead = headByKind(preview, "motion");
  const targetMotionHead = headByKind(target, "motion");
  const baseMotionHead = preview.baseHeads ? Object.values(preview.baseHeads).find((head) => head.kind === "motion") : undefined;
  const motionChanged = Boolean(previewMotionHead && !sameHead(previewMotionHead, baseMotionHead));
  const previewMotion = motionChanged && previewMotionHead ? (await service.store.read<MotionDocument>(previewMotionHead.id, previewMotionHead.version)).payload : undefined;

  await service.checkout(review.targetBranchId);
  const current = await service.state();
  if (current.deckHash !== input.expectedTargetDeckHash) throw new Error(`Target branch changed while accepting preview: expected ${input.expectedTargetDeckHash}, got ${current.deckHash}`);
  const acceptedDeckHead = review.deckDiff.changed ? await writeDeckAccept(service, review.targetBranchId, targetDeckHead, previewDeckHead, previewDeck) : targetDeckHead;
  if (previewMotion && previewMotionHead) await writeMotionAccept(service, review.targetBranchId, { ...previewDeck, activeBranchId: review.targetBranchId }, targetMotionHead, previewMotionHead, previewMotion);

  const acceptedDeck = (await service.store.read<DeckDocument>(acceptedDeckHead.id, acceptedDeckHead.version)).payload;
  const qa = runDeterministicQA(acceptedDeck);
  await service.store.write({ id: "qa_current", kind: "qa", payload: { deckId: acceptedDeck.id, issues: qa, reason: `Accept Creative preview ${preview.name}`, impact: { affectedSlideIds: review.deckDiff.slideDiffs.map((slide) => slide.slideId), affectedElementIds: review.deckDiff.slideDiffs.flatMap((slide) => slide.elementDiffs.map((element) => element.elementId)), staleArtifacts: ["qa:visual", "qa:readability", "export"], narrativeChanged: review.deckDiff.summary.semanticChanges > 0, evidenceRisk: review.deckDiff.slideDiffs.some((slide) => slide.semanticFields.includes("claimIds") || slide.semanticFields.includes("evidenceRefs")), slideOrderChanged: review.deckDiff.summary.slidesMoved > 0 || review.deckDiff.summary.slidesAdded > 0 || review.deckDiff.summary.slidesRemoved > 0 } }, producer: { type: "deterministic" }, inputs: [acceptedDeckHead], status: qa.some((issue) => issue.severity === "critical") ? "needsReview" : "ready" });
  return { review, acceptedIntoBranchId: review.targetBranchId, previewBranchId: review.previewBranchId, state: await service.state() };
}

export async function discardCreativePreview(service: PitchWorkspaceService, previewBranchId: string) {
  const review = await reviewCreativePreview(service, previewBranchId);
  await service.checkout(review.targetBranchId);
  return { review, discardedPreviewBranchId: previewBranchId, activeBranchId: review.targetBranchId, state: await service.state() };
}
