import type { BranchArtifactHead } from "../../../packages/artifact-store/src/index.js";
import type { ReviewCommand, ReviewDocument } from "../../../packages/review-engine/src/index.js";
import { emptyReviewDocument, executeReviewCommand, reviewApprovalViews, reviewSummary, reviewThreadViews, unresolvedBlockingThreads } from "../../../packages/review-engine/src/index.js";
import { PitchWorkspaceService } from "../../workspace/src/server.js";

export type WorkspaceReviewCommand = ReviewCommand & {
  expectedDeckHash?: string;
  expectedReviewHash?: string;
  /** Required for human-governance commands that do not carry author in the core command union, such as revokeApproval. */
  author?: { kind: "user" | "codex" | "system"; id?: string; displayName: string };
};

function headByKind(current: Awaited<ReturnType<PitchWorkspaceService["state"]>>, kind: string): BranchArtifactHead | undefined {
  return Object.values(current.manifest.branches[current.manifest.activeBranchId]?.heads ?? {}).find((head) => head.kind === kind);
}

function assertHumanReviewAuthority(input: WorkspaceReviewCommand): void {
  if (!["resolve", "reopen", "approveSlide", "approveDeck", "revokeApproval"].includes(input.command)) return;
  const value = input as any;
  if (value.author?.kind !== "user") throw new Error(`${input.command} requires a human review author; Codex/system may reply or propose changes but cannot self-approve or close review authority.`);
}

export class ReviewWorkspaceRuntime {
  readonly service: PitchWorkspaceService;
  constructor(projectRoot: string) { this.service = new PitchWorkspaceService(projectRoot); }

  async state() {
    const current = await this.service.state();
    const reviewHead = headByKind(current, "review");
    const document = reviewHead ? (await this.service.store.read<ReviewDocument>(reviewHead.id, reviewHead.version)).payload : emptyReviewDocument(current.deck);
    if (document.deckId !== current.deck.id) throw new Error(`Review document belongs to ${document.deckId}, not ${current.deck.id}`);
    const history = reviewHead ? await this.service.journal.status(current.manifest.activeBranchId, reviewHead.id) : { canUndo: false, canRedo: false, depth: 0, cursor: -1 };
    return {
      deckHash: current.deckHash,
      activeBranchId: current.manifest.activeBranchId,
      reviewHash: reviewHead?.contentHash,
      reviewVersion: reviewHead?.version,
      document,
      threads: reviewThreadViews(current.deck, document),
      approvals: reviewApprovalViews(current.deck, document),
      summary: reviewSummary(current.deck, document),
      blockingThreads: unresolvedBlockingThreads(current.deck, document),
      history,
    };
  }

  async command(input: WorkspaceReviewCommand) {
    assertHumanReviewAuthority(input);
    const current = await this.service.state();
    if (input.expectedDeckHash && input.expectedDeckHash !== current.deckHash) throw new Error(`Deck changed since review command was authored: expected ${input.expectedDeckHash}, got ${current.deckHash}`);
    const reviewHead = headByKind(current, "review");
    if (input.expectedReviewHash && input.expectedReviewHash !== reviewHead?.contentHash) throw new Error(`Review document changed since command was authored: expected ${input.expectedReviewHash}, got ${reviewHead?.contentHash ?? "<none>"}`);
    const baseline = reviewHead ? (await this.service.store.read<ReviewDocument>(reviewHead.id, reviewHead.version)).payload : emptyReviewDocument(current.deck);
    const { expectedDeckHash: _deck, expectedReviewHash: _review, ...command } = input as any;
    const executed = executeReviewCommand(current.deck, baseline, command as ReviewCommand);
    if (!executed.changed) return { ...(await this.state()), ...executed, commandReason: executed.reason };

    let activeHead = reviewHead;
    const artifactId = reviewHead?.id ?? "review_current";
    if (!activeHead) {
      const created = await this.service.store.write({ id: artifactId, kind: "review", payload: baseline, producer: { type: "deterministic" } });
      activeHead = { id: created.id, kind: created.kind, version: created.version, contentHash: created.contentHash, status: created.status };
      await this.service.journal.record(current.manifest.activeBranchId, activeHead);
    } else {
      await this.service.journal.record(current.manifest.activeBranchId, activeHead);
    }
    const producer = "author" in command && command.author?.kind === "codex" ? "codex" : "user";
    const artifact = await this.service.store.write({ id: artifactId, kind: "review", payload: executed.document, producer: { type: producer }, inputs: [activeHead] });
    const nextHead: BranchArtifactHead = { id: artifact.id, kind: artifact.kind, version: artifact.version, contentHash: artifact.contentHash, status: artifact.status };
    await this.service.journal.record(current.manifest.activeBranchId, nextHead);
    return { ...(await this.state()), ...executed, commandReason: executed.reason };
  }

  async undo() {
    const current = await this.service.state();
    const head = headByKind(current, "review");
    if (!head) throw new Error("No review history on active branch");
    await this.service.journal.undo(current.manifest.activeBranchId, head.id);
    return this.state();
  }

  async redo() {
    const current = await this.service.state();
    const head = headByKind(current, "review");
    if (!head) throw new Error("No review history on active branch");
    await this.service.journal.redo(current.manifest.activeBranchId, head.id);
    return this.state();
  }
}
