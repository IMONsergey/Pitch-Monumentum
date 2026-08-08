# Pitch Monumentum — current integration order after the large production-core pass

This document supersedes the earlier stack snapshot by extending it through Collaboration, Delivery and Desktop Next.

## 0. Frozen release gate — PR #5

Branch: `feat/motion-components-studio`

Frozen head:

`8f7b14b644aec78c8e18176b5ba3f7e1117c21d7`

Contains the first installable Desktop Preview production core:

- Pro Editor foundation inherited from main;
- Motion Studio / Presenter;
- real Assets;
- Component System 2.0;
- Codex parity;
- Intel DMG workflow.

**Must merge first.**

Gate remains:

- normal CI actually executed and green;
- at least one real x86_64 macOS DMG artifact;
- architecture report confirms `x86_64`;
- no claim of a verified DMG while hosted jobs are only queued/pending.

## 1. Advanced Media Studio

Branch: `feat/advanced-media-design-system`

- on-canvas Crop Mode;
- focal point;
- image clip shapes;
- shared image-layout engine;
- Presenter/PPTX parity;
- media-aware component overrides.

## 2. Design System 2.0

Branch: `feat/design-system-tokens-v2`

- live color/font/type/spacing tokens;
- native materialized values;
- token bindings + propagation;
- Brand QA and coverage;
- migration inference/dry-run;
- component variants;
- Design UI/MCP.

## 3. Slide Masters + Smart Layouts

Branch: `feat/slide-masters-smart-layouts`

- deck-local masters;
- typed placeholders;
- content-preserving layout switch;
- stable compatible object IDs;
- Update Master propagation;
- Master QA;
- Layouts UI/MCP.

## 4. Creative Director

Branch: `feat/creative-director-engine`

- multi-lane deterministic production review;
- evidence-first acceptance gate;
- server-issued plans;
- stale-plan protection;
- guarded canonical execution;
- deterministic Safe Fixes;
- high-risk preview branches;
- immutable execution audits;
- object/system preview diff;
- conflict-safe Accept / Return;
- run-history UI/MCP.

## 5. Versions & Visual Branch Review

Branch: `feat/versions-visual-review`

- named immutable checkpoints;
- restore into a new branch;
- branch compare/checkout;
- semantic/object/system diff;
- Versions UI/MCP.

Validation item before merge: restore ancestry must always reflect the checkpoint source branch when restoring from a different currently checked-out branch.

## 6. Collaboration & Review core

Branch: `feat/collaboration-review`

- branch-local review artifact/history;
- object/slide/deck threads;
- canvas pins;
- comments/questions/change requests;
- human-only resolution/approval authority;
- slide/deck approval fingerprints;
- stale approval detection;
- production export review gate;
- review-sidecar Creative Preview acceptance;
- Comments UI/MCP.

## 7. Delivery & Interop Center

Branch: `feat/delivery-interop-center`

- unified review/QA/asset preflight;
- production PPTX surfaced through Delivery Center;
- editable Figma Bridge document;
- local Figma importer plugin;
- embedded-assets standalone Web presentation;
- macOS Keynote adapter through installed Keynote;
- Delivery UI/MCP;
- Desktop Next shell;
- Electron-native PDF and PNG slide-set renderer;
- post-stack manual Intel DMG workflow.

### Figma validation gates

- create a development plugin in Figma and use its generated ID;
- prepare local manifest from `manifest.template.json`;
- validate rich text fonts, custom vectors, image treatment and hierarchy on real Figma Desktop;
- do not call structured chart/table/diagram fallbacks native parity until their importer expansion is implemented.

### Keynote validation gates

- run on macOS with installed Keynote;
- convert a corpus of supported PPTX decks;
- inspect native editability/visual parity;
- retain `adapter-unverified` until that real test succeeds.

### Web validation gates

- browser corpus across Chrome/Safari;
- exact keyframe tracks remain warned/not parity;
- validate printing before treating print CSS as production PDF equivalent outside Desktop Next.

### Desktop Next validation gates

Authoritative packaging files:

- `electron-builder.next.safe.yml`;
- `scripts/package-desktop-next-safe.mjs`;
- `.github/workflows/desktop-next-macos.yml`.

The earlier `electron-builder.next.yml` / non-safe packaging script are superseded drafts because they guessed an Electron version before dependency validation.

Desktop Next must not become the release shell until the linear stack above is merged and independently green.

## Merge procedure

For every layer:

1. merge the previous layer;
2. rebase/retarget the next branch onto current main;
3. inspect conflicts semantically, not by choosing `ours/theirs` wholesale;
4. run strict TypeScript + unit tests;
5. run all accumulated Chromium E2E relevant to the layer;
6. run format-specific integration validation;
7. merge the layer only when green;
8. continue to the next branch.

Do not collapse this stack into one giant unreviewable merge.

## Why the stack is linear

Each milestone intentionally builds canonical infrastructure that the next one consumes:

```text
Assets / Motion / Components
        ↓
Advanced Media
        ↓
Design System
        ↓
Slide Masters
        ↓
Creative Director
        ↓
Versions / Branch Review
        ↓
Collaboration / Approval
        ↓
Delivery / Interop
        ↓
Desktop Next
```

This order preserves one source of truth instead of creating parallel editor, AI, review and export document models.
