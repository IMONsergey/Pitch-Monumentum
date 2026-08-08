import test from "node:test";
import assert from "node:assert/strict";
import type { DeckDocument } from "../packages/deck-model/src/index.js";
import { emptyReviewDocument, executeReviewCommand, reviewApprovalViews, reviewSummary, reviewThreadViews } from "../packages/review-engine/src/index.js";

function deck(): DeckDocument {
  return {
    schemaVersion: "0.1", id: "deck_review", title: "Review",
    canvas: { widthDU: 1920, heightDU: 1080, duPerInch: 160, aspectRatio: "16:9" },
    briefId: "brief", narrativeId: "narrative", designSystemId: "design", sourceIds: [], claimIds: [], activeBranchId: "branch_main",
    createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z",
    slides: [{ id: "s1", order: 0, title: "Review slide", archetype: "freeform", semantic: { purpose: "review", takeaway: "Approved message", questionAnswered: "What?", narrativeRole: "test", claimIds: [], evidenceRefs: [], audienceRelevance: "test", density: "sparse" }, scene: [{ id: "title", type: "text", paragraphs: [{ runs: [{ text: "Approved title", fontSizePt: 40 }] }], semanticRole: "title", geometry: { x: 120, y: 100, width: 1100, height: 140 }, zIndex: 1, origin: "user", exportStrategy: "native", dependencies: [] }], status: "draft", qaIssueIds: [], dependencyIds: [] }],
  };
}

const sergey = { kind: "user" as const, id: "sergey", displayName: "Sergey" };
const codex = { kind: "codex" as const, id: "codex", displayName: "Codex" };

test("review threads support object anchor replies and resolution while retaining geometry snapshot", () => {
  const d = deck();
  let doc = emptyReviewDocument(d);
  const added = executeReviewCommand(d, doc, { command: "addThread", threadId: "thread_1", anchor: { scope: "element", slideId: "s1", elementId: "title" }, type: "changeRequest", priority: "blocking", body: "Move this title down.", author: sergey });
  doc = added.document;
  assert.deepEqual(doc.threads[0].anchor.geometrySnapshot, d.slides[0].scene[0].geometry);
  doc = executeReviewCommand(d, doc, { command: "reply", threadId: "thread_1", body: "I can preserve the hierarchy and move only this object.", author: codex }).document;
  assert.equal(doc.threads[0].messages.length, 2);
  assert.equal(reviewSummary(d, doc).blockingThreads, 1);
  doc = executeReviewCommand(d, doc, { command: "resolve", threadId: "thread_1", author: sergey }).document;
  assert.equal(reviewSummary(d, doc).blockingThreads, 0);
  assert.equal(doc.threads[0].status, "resolved");
  doc = executeReviewCommand(d, doc, { command: "reopen", threadId: "thread_1", author: sergey }).document;
  assert.equal(doc.threads[0].status, "open");
});

test("slide and deck approvals become stale automatically after canonical content changes", () => {
  const d = deck();
  let doc = emptyReviewDocument(d);
  doc = executeReviewCommand(d, doc, { command: "approveSlide", slideId: "s1", author: sergey, approvalId: "approval_slide" }).document;
  doc = executeReviewCommand(d, doc, { command: "approveDeck", author: sergey, approvalId: "approval_deck" }).document;
  assert.deepEqual(reviewApprovalViews(d, doc).map((approval) => approval.state), ["current", "current"]);
  const changed = structuredClone(d);
  const title: any = changed.slides[0].scene[0];
  title.paragraphs[0].runs[0].text = "Changed after approval";
  const states = reviewApprovalViews(changed, doc);
  assert.equal(states.find((approval) => approval.id === "approval_slide")?.state, "stale");
  assert.equal(states.find((approval) => approval.id === "approval_deck")?.state, "stale");
  const summary = reviewSummary(changed, doc);
  assert.equal(summary.slideApprovalsStale, 1);
  assert.equal(summary.deckApprovalStale, true);
});

test("deleted review targets remain as orphaned review history rather than disappearing", () => {
  const d = deck();
  const doc = executeReviewCommand(d, emptyReviewDocument(d), { command: "addThread", threadId: "thread_deleted", anchor: { scope: "element", slideId: "s1", elementId: "title" }, body: "Keep history even if object disappears.", author: sergey }).document;
  const changed = structuredClone(d);
  changed.slides[0].scene = [];
  const views = reviewThreadViews(changed, doc);
  assert.equal(views[0].anchorState, "missingElement");
  assert.equal(reviewSummary(changed, doc).orphanedThreads, 1);
});

test("only the original author can edit a review message", () => {
  const d = deck();
  const doc = executeReviewCommand(d, emptyReviewDocument(d), { command: "addThread", threadId: "thread_edit", anchor: { scope: "slide", slideId: "s1" }, body: "Original", author: sergey }).document;
  const messageId = doc.threads[0].messages[0].id;
  assert.throws(() => executeReviewCommand(d, doc, { command: "editMessage", threadId: "thread_edit", messageId, body: "Hijacked", author: codex }), /original review-message author/);
  const edited = executeReviewCommand(d, doc, { command: "editMessage", threadId: "thread_edit", messageId, body: "Edited by owner", author: sergey }).document;
  assert.equal(edited.threads[0].messages[0].body, "Edited by owner");
  assert(edited.threads[0].messages[0].editedAt);
});
