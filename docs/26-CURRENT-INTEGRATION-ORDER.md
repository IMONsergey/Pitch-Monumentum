# Pitch Monumentum — current integration order after the production-core hardening pass

This document is the authoritative linear merge order through Collaboration, Delivery and Desktop Full.

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

The cross-branch checkpoint ancestry fix is implemented on the current integration branch: restore uses `checkpoint.sourceBranchId`, keeps exact snapshot `baseHeads`, initializes history from checkpoint heads, and has a regression covering restore while another branch is active. Issue #8 remains the CI/rebase tracking gate until that fix is validated in sequence.

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

## 7. Delivery & Interop Center + Desktop Full

Branch: `feat/delivery-interop-center`

Product version on this branch: `0.3.0-preview.1`.

- unified review/QA/asset preflight;
- production PPTX surfaced through Delivery Center;
- editable Figma Bridge document;
- local Figma importer plugin with stable Pitch metadata and mixed rich-text range transfer;
- embedded-assets standalone Web presentation;
- canonical frame/group DOM hierarchy for Web/PDF/PNG;
- canonical `duPerInch` typography/spacing;
- vector `pathData`, gradients and drop shadows in Web delivery;
- macOS Keynote adapter through installed Keynote;
- deterministic file/package artifact SHA-256 inspection;
- Delivery UI/MCP;
- stable Desktop Runtime + Desktop Full release entrypoint;
- Electron-native PDF and PNG slide-set renderer using canonical canvas dimensions;
- one manual Intel Desktop Full DMG workflow.

### Stable product entrypoints

- Full workspace: `apps/workspace/src/full-server.ts`
- Full MCP: `apps/pitch-mcp-full/src/server.ts`
- Desktop release entry: `apps/desktop-full/src/main.ts`
- Desktop implementation: `apps/desktop-runtime/src/main.ts`
- Full builder: `electron-builder.full.yml`
- Full package guard: `scripts/package-desktop-full.mjs`
- Full Intel workflow: `.github/workflows/desktop-full-macos.yml`

Default npm commands now resolve to the Full product surface:

- `npm run workspace`
- `npm run desktop`
- `npm run package:mac:x64`
- `npm run pitch:mcp`

Legacy production-core commands are explicitly named `*:core` and are no longer the default user path.

The temporary Desktop Next packaging configs/scripts/workflow have been deleted. `apps/desktop-next/*` remains only as a compatibility code alias and must not become a release target again.

### Figma validation gates

- create a development plugin in Figma and use its generated ID;
- prepare local manifest from `manifest.template.json`;
- validate mixed fonts/styles, custom vectors, image treatment and hierarchy on real Figma Desktop;
- do not call structured chart/table/diagram fallbacks native parity until their importer expansion is implemented.

### Keynote validation gates

- run on macOS with installed Keynote;
- convert a corpus of supported PPTX decks;
- support either ordinary `.key` files or package-directory output in artifact accounting;
- inspect native editability/visual parity;
- retain `adapter-unverified` until that real test succeeds.

### Web/PDF/PNG validation gates

- browser corpus across Chrome/Safari;
- exact keyframe tracks remain warned/not parity;
- frame/group clipping and nested geometry are now canonical DOM hierarchy but still need browser corpus validation;
- PDF page size derives from `widthDU/heightDU/duPerInch`;
- PNG capture derives from canonical width/height rather than 1920×1080 constants;
- validate real Electron PDF/PNG output before claiming static-delivery parity.

### Desktop Full validation gate

Tracked in issue #9.

The manual workflow must prove:

1. complete Full build emitted all guarded runtimes;
2. native `macos-15-intel` job actually ran;
3. electron-builder produced a DMG;
4. packaged Mach-O reports `x86_64`;
5. DMG SHA-256 recorded;
6. real Intel Mac install/launch smoke test;
7. full UI controls present;
8. delivery smoke tests pass.

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

## Dependency chain

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
Desktop Runtime / Desktop Full
```

This order preserves one source of truth instead of creating parallel editor, AI, review and export document models.
