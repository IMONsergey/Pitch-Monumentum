# Pitch Monumentum — Collaboration & Review Core

The first collaboration milestone focuses on accountable review rather than real-time cursors. Comments, change requests, approvals and delivery gates are canonical project data with branch semantics.

## Canonical review artifact

Review state is a separate branch-local `review` artifact. It is intentionally independent from `DeckDocument` history:

- adding/replying/resolving comments does not create deck Undo entries;
- Review Undo/Redo only changes review state;
- normal project forks inherit the review head automatically;
- after a fork, review discussion can diverge independently per branch.

## Anchors

Threads may target:

- whole deck;
- one slide;
- one stable scene element.

Element anchors capture the element's geometry at thread creation. If the target is later deleted, the thread is retained as an orphaned review record rather than silently disappearing.

Optional normalized slide points support visual comments that are not tied to one object.

## Threads

Thread types:

- comment;
- question;
- change request.

Priorities:

- nit;
- normal;
- blocking.

Threads support replies, author-controlled message edits, resolution and reopening.

## Human review authority

Codex may:

- create comments/questions/change requests;
- reply to review threads;
- edit its own review messages;
- read approvals and delivery state.

Codex may NOT:

- resolve/reopen human review authority;
- approve a slide;
- approve the deck;
- revoke approval.

Those commands require a human review author in the runtime. This prevents agent self-approval.

## Approvals

Approvals use immutable content fingerprints rather than mutable green flags.

Slide approval fingerprints the slide's semantic contract, native scene, notes and layout identity. Deck approval fingerprints deck-level content including slides, theme and Slide Masters.

After a canonical edit:

- the review artifact does not need to mutate;
- approval view automatically becomes `stale` if its fingerprint no longer matches;
- missing approved slides become explicit missing targets.

Re-approval replaces the previous approval for that slide/deck with a new fingerprint.

## Delivery gate

Production delivery can be blocked by review state.

Default blockers:

- unresolved blocking thread;
- orphaned blocking thread;
- stale deck approval that was previously granted;
- stale slide approval that was previously granted.

Policies can additionally require:

- a current deck approval;
- current approvals for specific slides.

The enhanced workspace intercepts ordinary `/api/export`: if the review delivery gate is not ready, PPTX production export returns `409` with the review-gate issues instead of silently exporting.

## Editor UI

`Comments` adds:

- current selection/slide/deck composer;
- thread type + priority;
- reply;
- resolve/reopen;
- slide approval;
- deck approval;
- approval current/stale states;
- independent Review Undo/Redo;
- delivery-clear/review-gate indicator.

Open object threads appear as pins directly on the canvas. Blocking pins are visually distinct.

## Creative Preview integration

Review is a supported independent sidecar in conflict-free Creative Preview acceptance.

When a preview adds review comments and its parent review head has not changed after fork:

- Preview Review reports `review` as a changed artifact kind;
- Accept copies the preview review document into the target as a new review version;
- target Review Undo can undo that review acceptance without undoing deck geometry/content.

If the target review changed in parallel, fork-base conflict detection blocks one-click acceptance.

Component artifacts remain deliberately blocked from automatic partial merge until a real component merge engine exists.

## MCP parity

Unified MCP publishes read/comment capabilities:

- `pitch_review_state`;
- `pitch_review_add`;
- `pitch_review_reply`;
- `pitch_review_edit_own_message`;
- `pitch_review_delivery_gate`.

Human-only approval/resolution commands are intentionally absent from the Codex schema.

## Next collaboration layer

After this core is validated, M6 can add:

- user identities / authenticated authors;
- mention/notification routing;
- review assignment;
- visual branch approval workflow;
- activity timeline;
- multi-user presence;
- conflict-aware concurrent editing.

The review model is already designed so those features do not require moving comments into DOM state or presentation files.
