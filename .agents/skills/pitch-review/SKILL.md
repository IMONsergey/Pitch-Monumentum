---
name: pitch-review
description: Read and participate in Pitch Monumentum branch-local comments/review without impersonating human approval. Use for critique threads, questions, change requests, replies, delivery-gate checks and review-aware agent work. Codex may not approve, revoke approval, resolve or reopen human review authority.
---

# Pitch Collaboration Review

## Authority boundary

Review data is not permission theater.

Codex can add/reply/edit its own comments, but cannot:
- approve slide;
- approve deck;
- revoke approval;
- resolve/reopen review authority.

Do not emulate these human-only actions through raw artifact writes.

## Read first

Call `pitch_review_state` before review work.

Use:
- stable thread IDs;
- slide/object anchor state;
- reviewHash for concurrent review edits;
- deckHash for anchor correctness;
- approval current/stale status;
- delivery gate.

## Add review

Use `pitch_review_add` for:
- visual critique;
- questions needing human decision;
- explicit change requests;
- blockers that should prevent delivery.

Prefer an element anchor when the issue refers to one stable object. Use slide/deck scope only when the concern is genuinely broader.

## Reply

Use `pitch_review_reply` to:
- explain what was changed;
- ask for clarification;
- report a limitation;
- state that a requested fix is implemented and ready for human verification.

Do not resolve the thread yourself after making a fix. Human review decides closure.

## Delivery

Use `pitch_review_delivery_gate` before saying a deck is review-cleared or ready for production delivery.

A successful PPTX compiler is not enough when review blockers or stale approvals exist.

## Branches

Review is branch-local and inherited on fork.

After branch checkout, re-read review state. A reply made on one branch should not be assumed to exist on another.

Creative Preview can carry review sidecar changes into its target only through the guarded preview-accept path.

## Stale approvals

Approval state is derived from content fingerprints. If an approved slide/deck changes, approval becomes stale without rewriting the original approval record.

Never describe a stale approval as current.

## Completion

When working from a review thread:
1. read current thread and target;
2. make canonical edits through the proper Pitch tool family;
3. verify the requested scope;
4. reply with what changed;
5. leave resolution/approval to the human reviewer;
6. re-check delivery gate when relevant.
