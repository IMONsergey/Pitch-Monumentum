import { createHash, randomUUID } from "node:crypto";
import type { DeckDocument, Geometry, SceneElement, SlideDocument } from "../../deck-model/src/index.js";
import { stableStringify } from "../../shared/src/index.js";

export type ReviewAuthorKind = "user" | "codex" | "system";
export type ReviewThreadType = "comment" | "changeRequest" | "question";
export type ReviewThreadPriority = "nit" | "normal" | "blocking";
export type ReviewThreadStatus = "open" | "resolved";
export type ReviewApprovalScope = "slide" | "deck";

export interface ReviewAuthor {
  kind: ReviewAuthorKind;
  id?: string;
  displayName: string;
}

export interface ReviewAnchor {
  scope: "deck" | "slide" | "element";
  slideId?: string;
  elementId?: string;
  /** Optional normalized point inside the slide for visual comments not tied to one object. */
  point?: { x: number; y: number };
  /** Geometry snapshot helps reviewers understand where an object lived when the thread was opened. */
  geometrySnapshot?: Geometry;
}

export interface ReviewMessage {
  id: string;
  author: ReviewAuthor;
  body: string;
  createdAt: string;
  editedAt?: string;
}

export interface ReviewThread {
  id: string;
  type: ReviewThreadType;
  priority: ReviewThreadPriority;
  status: ReviewThreadStatus;
  anchor: ReviewAnchor;
  createdAt: string;
  createdBy: ReviewAuthor;
  messages: ReviewMessage[];
  resolvedAt?: string;
  resolvedBy?: ReviewAuthor;
}

export interface ReviewApproval {
  id: string;
  scope: ReviewApprovalScope;
  slideId?: string;
  fingerprint: string;
  approvedAt: string;
  approvedBy: ReviewAuthor;
  note?: string;
}

export interface ReviewDocument {
  schemaVersion: "0.1";
  deckId: string;
  threads: ReviewThread[];
  approvals: ReviewApproval[];
}

export interface ReviewThreadView extends ReviewThread {
  anchorState: "valid" | "missingSlide" | "missingElement";
}

export interface ReviewApprovalView extends ReviewApproval {
  state: "current" | "stale" | "missingSlide";
}

export interface ReviewSummary {
  openThreads: number;
  blockingThreads: number;
  unresolvedChangeRequests: number;
  orphanedThreads: number;
  slideApprovalsCurrent: number;
  slideApprovalsStale: number;
  deckApprovalCurrent: boolean;
  deckApprovalStale: boolean;
}

export type ReviewCommand =
  | { command: "addThread"; anchor: ReviewAnchor; type?: ReviewThreadType; priority?: ReviewThreadPriority; body: string; author: ReviewAuthor; threadId?: string }
  | { command: "reply"; threadId: string; body: string; author: ReviewAuthor; messageId?: string }
  | { command: "editMessage"; threadId: string; messageId: string; body: string; author: ReviewAuthor }
  | { command: "resolve"; threadId: string; author: ReviewAuthor }
  | { command: "reopen"; threadId: string; author: ReviewAuthor }
  | { command: "approveSlide"; slideId: string; author: ReviewAuthor; note?: string; approvalId?: string }
  | { command: "approveDeck"; author: ReviewAuthor; note?: string; approvalId?: string }
  | { command: "revokeApproval"; approvalId: string };

export interface ReviewCommandResult {
  document: ReviewDocument;
  changed: boolean;
  reason: string;
  affectedThreadIds: string[];
  affectedApprovalIds: string[];
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function withoutReviewVolatileSlideFields(slide: SlideDocument) {
  return {
    id: slide.id,
    order: slide.order,
    sectionId: slide.sectionId,
    title: slide.title,
    archetype: slide.archetype,
    recipeId: slide.recipeId,
    semantic: slide.semantic,
    scene: slide.scene,
    speakerNotes: slide.speakerNotes,
  };
}

export function slideReviewFingerprint(slide: SlideDocument): string {
  return hash(withoutReviewVolatileSlideFields(slide));
}

export function deckReviewFingerprint(deck: DeckDocument): string {
  return hash({
    id: deck.id,
    title: deck.title,
    canvas: deck.canvas,
    briefId: deck.briefId,
    narrativeId: deck.narrativeId,
    designSystemId: deck.designSystemId,
    slides: deck.slides.map(withoutReviewVolatileSlideFields),
    sourceIds: deck.sourceIds,
    claimIds: deck.claimIds,
    theme: (deck as any).theme,
    slideMasters: (deck as any).slideMasters,
  });
}

export function emptyReviewDocument(deck: DeckDocument): ReviewDocument {
  return { schemaVersion: "0.1", deckId: deck.id, threads: [], approvals: [] };
}

function author(value: ReviewAuthor): ReviewAuthor {
  if (!value.displayName?.trim()) throw new Error("Review author displayName is required");
  if (!(["user", "codex", "system"] as const).includes(value.kind)) throw new Error(`Unsupported review author kind ${value.kind}`);
  return { kind: value.kind, id: value.id?.trim() || undefined, displayName: value.displayName.trim() };
}

function text(value: string, label: string): string {
  const body = value.trim();
  if (!body) throw new Error(`${label} is required`);
  if (body.length > 20_000) throw new Error(`${label} exceeds 20,000 characters`);
  return body;
}

function slide(deck: DeckDocument, slideId: string): SlideDocument {
  const found = deck.slides.find((item) => item.id === slideId);
  if (!found) throw new Error(`Unknown review slide ${slideId}`);
  return found;
}

function element(deck: DeckDocument, slideId: string, elementId: string): SceneElement {
  const target = slide(deck, slideId).scene.find((item) => item.id === elementId);
  if (!target) throw new Error(`Unknown review element ${elementId} on ${slideId}`);
  return target;
}

function normalizedAnchor(deck: DeckDocument, input: ReviewAnchor): ReviewAnchor {
  const anchor: ReviewAnchor = structuredClone(input);
  if (anchor.scope === "deck") {
    anchor.slideId = undefined; anchor.elementId = undefined; anchor.geometrySnapshot = undefined;
  } else {
    if (!anchor.slideId) throw new Error(`${anchor.scope} review anchor requires slideId`);
    slide(deck, anchor.slideId);
    if (anchor.scope === "element") {
      if (!anchor.elementId) throw new Error("Element review anchor requires elementId");
      const target = element(deck, anchor.slideId, anchor.elementId);
      anchor.geometrySnapshot = structuredClone(target.geometry);
    } else {
      anchor.elementId = undefined; anchor.geometrySnapshot = undefined;
    }
  }
  if (anchor.point) {
    if (![anchor.point.x, anchor.point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("Review anchor point must use normalized 0..1 coordinates");
  }
  return anchor;
}

function thread(document: ReviewDocument, id: string): ReviewThread {
  const found = document.threads.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown review thread ${id}`);
  return found;
}

function sameAuthor(a: ReviewAuthor, b: ReviewAuthor): boolean {
  return a.kind === b.kind && (a.id ? a.id === b.id : a.displayName === b.displayName);
}

export function executeReviewCommand(deck: DeckDocument, document: ReviewDocument, command: ReviewCommand): ReviewCommandResult {
  if (document.deckId !== deck.id) throw new Error(`Review document belongs to ${document.deckId}, not ${deck.id}`);
  const next = structuredClone(document);
  let reason = "Review update";
  const affectedThreadIds: string[] = [];
  const affectedApprovalIds: string[] = [];

  if (command.command === "addThread") {
    const id = command.threadId?.trim() || `review_thread_${randomUUID()}`;
    if (next.threads.some((item) => item.id === id)) throw new Error(`Review thread id already exists: ${id}`);
    const createdBy = author(command.author);
    const message: ReviewMessage = { id: `review_message_${randomUUID()}`, author: createdBy, body: text(command.body, "Review comment"), createdAt: new Date().toISOString() };
    next.threads.push({ id, type: command.type ?? "comment", priority: command.priority ?? "normal", status: "open", anchor: normalizedAnchor(deck, command.anchor), createdAt: message.createdAt, createdBy, messages: [message] });
    reason = `Add review thread ${id}`; affectedThreadIds.push(id);
  } else if (command.command === "reply") {
    const target = thread(next, command.threadId);
    const messageId = command.messageId?.trim() || `review_message_${randomUUID()}`;
    if (target.messages.some((message) => message.id === messageId)) throw new Error(`Review message id already exists: ${messageId}`);
    target.messages.push({ id: messageId, author: author(command.author), body: text(command.body, "Review reply"), createdAt: new Date().toISOString() });
    reason = `Reply to review thread ${target.id}`; affectedThreadIds.push(target.id);
  } else if (command.command === "editMessage") {
    const target = thread(next, command.threadId);
    const message = target.messages.find((item) => item.id === command.messageId);
    if (!message) throw new Error(`Unknown review message ${command.messageId}`);
    const editor = author(command.author);
    if (!sameAuthor(message.author, editor)) throw new Error("Only the original review-message author may edit that message");
    message.body = text(command.body, "Review message"); message.editedAt = new Date().toISOString();
    reason = `Edit review message ${message.id}`; affectedThreadIds.push(target.id);
  } else if (command.command === "resolve" || command.command === "reopen") {
    const target = thread(next, command.threadId);
    if (command.command === "resolve") {
      target.status = "resolved"; target.resolvedAt = new Date().toISOString(); target.resolvedBy = author(command.author); reason = `Resolve review thread ${target.id}`;
    } else {
      target.status = "open"; target.resolvedAt = undefined; target.resolvedBy = undefined; reason = `Reopen review thread ${target.id}`;
    }
    affectedThreadIds.push(target.id);
  } else if (command.command === "approveSlide") {
    const target = slide(deck, command.slideId);
    const id = command.approvalId?.trim() || `review_approval_${randomUUID()}`;
    if (next.approvals.some((item) => item.id === id)) throw new Error(`Approval id already exists: ${id}`);
    const approval: ReviewApproval = { id, scope: "slide", slideId: target.id, fingerprint: slideReviewFingerprint(target), approvedAt: new Date().toISOString(), approvedBy: author(command.author), note: command.note?.trim() || undefined };
    next.approvals = next.approvals.filter((item) => !(item.scope === "slide" && item.slideId === target.id));
    next.approvals.push(approval); reason = `Approve slide ${target.id}`; affectedApprovalIds.push(id);
  } else if (command.command === "approveDeck") {
    const id = command.approvalId?.trim() || `review_approval_${randomUUID()}`;
    if (next.approvals.some((item) => item.id === id)) throw new Error(`Approval id already exists: ${id}`);
    const approval: ReviewApproval = { id, scope: "deck", fingerprint: deckReviewFingerprint(deck), approvedAt: new Date().toISOString(), approvedBy: author(command.author), note: command.note?.trim() || undefined };
    next.approvals = next.approvals.filter((item) => item.scope !== "deck"); next.approvals.push(approval); reason = "Approve deck"; affectedApprovalIds.push(id);
  } else {
    const index = next.approvals.findIndex((item) => item.id === command.approvalId);
    if (index < 0) throw new Error(`Unknown approval ${command.approvalId}`);
    next.approvals.splice(index, 1); reason = `Revoke approval ${command.approvalId}`; affectedApprovalIds.push(command.approvalId);
  }

  return { document: next, changed: !sameDocument(document, next), reason, affectedThreadIds, affectedApprovalIds };
}

function sameDocument(a: ReviewDocument, b: ReviewDocument): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function reviewThreadViews(deck: DeckDocument, document: ReviewDocument): ReviewThreadView[] {
  return document.threads.map((thread) => {
    if (thread.anchor.scope === "deck") return { ...structuredClone(thread), anchorState: "valid" as const };
    const targetSlide = deck.slides.find((slide) => slide.id === thread.anchor.slideId);
    if (!targetSlide) return { ...structuredClone(thread), anchorState: "missingSlide" as const };
    if (thread.anchor.scope === "element" && !targetSlide.scene.some((element) => element.id === thread.anchor.elementId)) return { ...structuredClone(thread), anchorState: "missingElement" as const };
    return { ...structuredClone(thread), anchorState: "valid" as const };
  });
}

export function reviewApprovalViews(deck: DeckDocument, document: ReviewDocument): ReviewApprovalView[] {
  return document.approvals.map((approval) => {
    if (approval.scope === "deck") return { ...structuredClone(approval), state: approval.fingerprint === deckReviewFingerprint(deck) ? "current" as const : "stale" as const };
    const target = deck.slides.find((slide) => slide.id === approval.slideId);
    if (!target) return { ...structuredClone(approval), state: "missingSlide" as const };
    return { ...structuredClone(approval), state: approval.fingerprint === slideReviewFingerprint(target) ? "current" as const : "stale" as const };
  });
}

export function reviewSummary(deck: DeckDocument, document: ReviewDocument): ReviewSummary {
  const threads = reviewThreadViews(deck, document);
  const approvals = reviewApprovalViews(deck, document);
  const open = threads.filter((thread) => thread.status === "open");
  const deckApproval = approvals.find((approval) => approval.scope === "deck");
  return {
    openThreads: open.length,
    blockingThreads: open.filter((thread) => thread.priority === "blocking").length,
    unresolvedChangeRequests: open.filter((thread) => thread.type === "changeRequest").length,
    orphanedThreads: threads.filter((thread) => thread.anchorState !== "valid").length,
    slideApprovalsCurrent: approvals.filter((approval) => approval.scope === "slide" && approval.state === "current").length,
    slideApprovalsStale: approvals.filter((approval) => approval.scope === "slide" && approval.state === "stale").length,
    deckApprovalCurrent: deckApproval?.state === "current",
    deckApprovalStale: deckApproval?.state === "stale",
  };
}

export function unresolvedBlockingThreads(deck: DeckDocument, document: ReviewDocument): ReviewThreadView[] {
  return reviewThreadViews(deck, document).filter((thread) => thread.status === "open" && thread.priority === "blocking");
}
