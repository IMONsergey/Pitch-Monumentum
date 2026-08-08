import type { DeckDocument } from "../../deck-model/src/index.js";
import type { ReviewDocument, ReviewThreadView } from "./index.js";
import { reviewApprovalViews, reviewSummary, unresolvedBlockingThreads } from "./index.js";

export interface ReviewDeliveryPolicy {
  requireDeckApproval?: boolean;
  requireSlideApprovalIds?: string[];
  blockOnOrphanedBlockingThreads?: boolean;
}

export interface ReviewDeliveryIssue {
  severity: "warning" | "blocker";
  code: "blocking-thread" | "orphaned-blocking-thread" | "deck-approval-missing" | "deck-approval-stale" | "slide-approval-missing" | "slide-approval-stale";
  message: string;
  threadId?: string;
  slideId?: string;
  approvalId?: string;
}

export interface ReviewDeliveryGate {
  ready: boolean;
  issues: ReviewDeliveryIssue[];
  summary: ReturnType<typeof reviewSummary>;
}

export function reviewDeliveryGate(deck: DeckDocument, document: ReviewDocument, policy: ReviewDeliveryPolicy = {}): ReviewDeliveryGate {
  const issues: ReviewDeliveryIssue[] = [];
  const approvals = reviewApprovalViews(deck, document);
  const blocking = unresolvedBlockingThreads(deck, document);
  for (const thread of blocking) {
    const orphaned = thread.anchorState !== "valid";
    const severity: ReviewDeliveryIssue["severity"] = orphaned && policy.blockOnOrphanedBlockingThreads === false ? "warning" : "blocker";
    issues.push({ severity, code: orphaned ? "orphaned-blocking-thread" : "blocking-thread", threadId: thread.id, slideId: thread.anchor.slideId, message: orphaned ? `Blocking review thread ${thread.id} targets a missing slide/object and must be reconciled.` : `Blocking review thread ${thread.id} is unresolved.` });
  }

  const deckApproval = approvals.find((approval) => approval.scope === "deck");
  if (policy.requireDeckApproval && !deckApproval) issues.push({ severity: "blocker", code: "deck-approval-missing", message: "Deck approval is required before delivery." });
  if (deckApproval?.state === "stale") issues.push({ severity: "blocker", code: "deck-approval-stale", approvalId: deckApproval.id, message: "Deck changed after its approval; re-review and approve the current version." });

  for (const slideId of policy.requireSlideApprovalIds ?? []) {
    const approval = approvals.find((item) => item.scope === "slide" && item.slideId === slideId);
    if (!approval) issues.push({ severity: "blocker", code: "slide-approval-missing", slideId, message: `Slide ${slideId} approval is required before delivery.` });
    else if (approval.state === "stale") issues.push({ severity: "blocker", code: "slide-approval-stale", approvalId: approval.id, slideId, message: `Slide ${slideId} changed after approval; re-review it.` });
  }
  // Existing approvals are commitments. If they become stale, surface that even when the policy did not require approval initially.
  for (const approval of approvals.filter((item) => item.scope === "slide" && item.state === "stale")) {
    if (issues.some((issue) => issue.approvalId === approval.id)) continue;
    issues.push({ severity: "blocker", code: "slide-approval-stale", approvalId: approval.id, slideId: approval.slideId, message: `Previously approved slide ${approval.slideId} changed after approval.` });
  }

  return { ready: !issues.some((issue) => issue.severity === "blocker"), issues, summary: reviewSummary(deck, document) };
}
