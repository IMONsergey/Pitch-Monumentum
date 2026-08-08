# Pitch Monumentum — stacked milestone integration order

This file records the current development stack while the frozen Intel Desktop Preview release candidate waits for hosted CI/macOS runners.

## Release candidate — merge first

### PR #5 / `feat/motion-components-studio`

Frozen release head:

`8f7b14b644aec78c8e18176b5ba3f7e1117c21d7`

Scope:

- Motion Studio + Presenter;
- real Asset Library / native image bytes;
- Component System 2.0 linked propagation;
- desktop Electron preview;
- Intel macOS x64 packaging workflow;
- Codex parity for the above.

**Gate:** do not merge until normal CI and at least one real verified `x86_64` DMG artifact are green.

## Stack after the release candidate

Merge / rebase order is intentionally linear because each milestone builds on canonical primitives from the previous one.

### 1. `feat/advanced-media-design-system`

Advanced Media Studio:

- direct Crop Mode;
- focal point;
- clip shapes;
- shared image-layout math;
- Presenter/PPTX parity;
- media-aware component overrides.

The former stacked PR was closed only to avoid creating more hosted Actions jobs. The branch is preserved.

### 2. `feat/design-system-tokens-v2`

Design System 2.0:

- live color/font/type/spacing tokens;
- materialized native values;
- binding propagation;
- Brand QA + coverage;
- migration/inference;
- component variants;
- integrated Design UI/MCP.

### 3. `feat/slide-masters-smart-layouts`

Slide Masters + Smart Layouts:

- typed placeholders;
- content-preserving layout switch;
- stable compatible element identity;
- master update propagation;
- Master QA;
- Layouts UI/MCP.

### 4. `feat/creative-director-engine`

Creative Director:

- multi-lane deterministic production review;
- evidence as a first-class quality gate;
- server-issued plan + stale-plan protection;
- guarded canonical execution;
- high-risk preview branches;
- exact Safe Fixes;
- immutable execution audit;
- object/system preview diff;
- conflict-safe Accept / Return;
- run-history UI/MCP.

### 5. `feat/versions-visual-review`

Versions & Visual Branch Review:

- immutable named checkpoints;
- restore into a new branch;
- semantic/object/system diff;
- branch compare/checkout;
- checkpoint compare;
- Versions UI/MCP.

### 6. `feat/collaboration-review`

Collaboration & Review core:

- branch-local review artifact;
- object/slide/deck threads;
- canvas comment pins;
- replies/change requests/questions;
- human-only review authority;
- slide/deck approval fingerprints;
- stale approval detection;
- delivery/export review gate;
- review sidecar preview acceptance;
- Comments UI/MCP.

## Integration rules

For every layer after PR #5:

1. rebase/retarget onto the previous merged milestone;
2. run strict TypeScript + unit tests;
3. run existing Chromium editor E2E plus milestone E2E;
4. inspect any real failure before changing semantics;
5. merge only after the layer itself is green;
6. rebase the next branch and repeat.

Do not squash all branches into one unreviewable mega-merge. Each layer has an explicit product boundary and regression corpus.

## Current intentional limitations

- hosted GitHub runners are an external release dependency; a queued job is not a pass;
- no verified Intel DMG must be claimed until a real artifact exists and architecture verification says `x86_64`;
- component artifacts still block automatic Creative Preview composite merge;
- authenticated multi-user identity/presence is after the review-core milestone;
- Figma/Keynote/PDF/PNG production delivery remains an interop milestone after these editor/review foundations are validated.
