# Pitch Monumentum — Production Core milestone report — 2026-08-08

This report records the large post-PR-#5 development pass. It distinguishes implemented repository capabilities from environment-dependent release validation.

## Release candidate discipline

PR #5 remains the frozen first Desktop Preview candidate at:

`8f7b14b644aec78c8e18176b5ba3f7e1117c21d7`

It is intentionally not merged or described as released until hosted CI actually runs and a real macOS Intel artifact is produced/verified as `x86_64`.

All later work is isolated on stacked branches. Development PRs were closed/avoided when necessary to avoid creating additional hosted Actions pressure; branches remain intact.

## Editor/system capabilities built after the frozen candidate

### Advanced Media

- direct canvas crop handles;
- focal point;
- image clip shapes;
- shared image-layout math;
- PPTX/Presenter parity improvements;
- media-aware linked component overrides.

### Design System 2.0

- live tokens;
- materialized native values;
- token propagation with ordinary deck Undo;
- Brand QA/coverage;
- migration inference;
- component variants.

### Slide Masters / Smart Layouts

- typed placeholders;
- content-preserving layout switch;
- stable compatible object identity;
- master updates across linked slides;
- Master QA;
- integrated Layouts tooling.

## AI production control

### Creative Director

Implemented as a guarded controller over existing canonical Pitch command families.

- deterministic multi-lane production review;
- evidence as a first-class quality lane;
- server-issued plan;
- branch/deck-hash stale-plan protection;
- scope validation;
- global/high-risk command detection;
- deterministic exact Safe Fixes;
- preview-branch execution;
- post-review;
- immutable execution audits;
- per-action deck hashes/errors/reasons;
- run-history UI and MCP;
- object/system preview diff;
- exact-hash Accept / Return;
- conflict detection from fork base heads;
- independent motion/review sidecar acceptance where safe;
- refusal of unsupported component-artifact partial merge.

## Version safety

### Named checkpoints

- exact artifact-head snapshots;
- no destructive rewind;
- restore creates a new branch;
- checkpoint compare;
- branch compare;
- semantic/object/system diff;
- Versions UI and MCP.

Known integration item before merge: cross-branch checkpoint restore ancestry must be validated/fixed so restored branch ancestry always follows the checkpoint's source branch.

## Collaboration / review governance

- branch-local review artifact with independent Review Undo/Redo;
- deck/slide/object anchors;
- canvas review pins;
- comment/question/change-request threads;
- normal/nit/blocking priorities;
- replies;
- orphaned-thread retention;
- human-only resolve/reopen/approve/revoke authority;
- Codex may comment/reply/edit its own messages but cannot self-approve;
- slide/deck approval fingerprints;
- automatic stale approval state after canonical edits;
- delivery review gate;
- ordinary production PPTX route returns `409` while review blockers/stale approvals exist;
- review sidecar can move through conflict-free Creative Preview acceptance with independent review history.

## Delivery / interop

### Unified Delivery Center

Shared preflight checks:

- review gate;
- deterministic critical QA;
- asset byte integrity;
- format-specific blockers/warnings.

Outputs:

- PPTX — existing mature native production compiler;
- Figma Bridge — structured editable bridge JSON;
- Standalone Web — self-contained HTML with embedded assets/builds;
- Keynote — macOS adapter through installed Keynote, explicitly `adapter-unverified` until real validation.

### Figma Bridge

Bridge retains:

- stable Pitch IDs;
- slide frames;
- hierarchy;
- rich text/ranges;
- shapes/vectors/lines;
- image bytes/media treatment;
- token bindings;
- component/master metadata;
- theme/master metadata;
- structured fallback payloads.

A local Figma plugin imports common nodes as editable Figma nodes and stores Pitch IDs/plugin metadata for future update/re-export. Plugin setup uses a Figma-issued development plugin ID template rather than inventing a production ID.

### Standalone Web

- one HTML file;
- embedded data-URI images;
- no workspace `/api/assets` dependency;
- responsive canonical-canvas scaling;
- keyboard/click navigation;
- progress;
- basic rich text/shapes/images/tables/charts;
- speaker notes hidden;
- print CSS;
- click-build entrance/exit/emphasis.

Exact Motion keyframe tracks remain explicitly warned rather than silently approximated.

## Desktop Full / Desktop Next

Post-stack desktop shell now targets the full local stack rather than PR-#5's older base workspace:

Delivery → Review → Versions → Creative Director → Masters → Design → Pro Editor.

Desktop-only static delivery additionally uses Electron-native rendering for:

- PDF;
- PNG slide set.

A narrow preload bridge exposes only delivery/reveal commands while the editor window retains context isolation, no Node integration and sandboxing.

## Full-stack stable entrypoints

Added:

- `apps/workspace/src/full-server.ts`;
- `apps/pitch-mcp-full/src/server.ts`;
- `apps/desktop-full/src/main.ts`.

The internal `next*` server chain remains implementation history, not the intended long-term product naming surface.

## Intel packaging after stack merge

Authoritative prepared files:

- `electron-builder.full.yml`;
- `scripts/package-desktop-full.mjs`;
- `.github/workflows/desktop-full-macos.yml`.

The full package script verifies that the build emitted the required full-stack workspace/review/versions/director/MCP/preload entries before electron-builder runs.

The manual Intel workflow verifies:

- packaged app executable exists;
- `file` reports `x86_64`;
- DMG exists;
- SHA-256 is generated;
- DMG + architecture report + checksum become a workflow artifact.

The workflow is manual-only until the stack is merged; it intentionally does not create more PR Actions jobs now.

## Regression corpus added in this pass

Coverage includes:

- Creative Director planning/execution/audit/safe-fix/preview branches;
- preview accept/return/conflict handling;
- Versions checkpoint/restore/compare UI/runtime;
- review engine/history/governance/export gate/UI;
- Figma bridge identity/rich media payload;
- Figma importer contract;
- self-contained Web output;
- Keynote adapter command contract;
- Delivery Runtime preflight/artifacts/blocking review/missing assets;
- Delivery UI downloads;
- Desktop full package/workflow contract.

These tests are repository work awaiting the sequential CI/rebase process; they are not being described as green until they actually execute.

## What must happen next

1. unblock/observe PR #5 hosted CI and native Intel DMG validation;
2. merge #5 only if its actual gates pass;
3. rebase Advanced Media onto main and run its complete regression corpus;
4. repeat linearly through Design → Masters → Director → Versions → Review → Delivery;
5. resolve the cross-branch checkpoint ancestry integration item during Versions rebase;
6. validate Figma importer in actual Figma Desktop;
7. validate Keynote adapter against installed Keynote and a fidelity corpus;
8. validate Desktop Full PDF/PNG rendering on real Intel macOS;
9. run `desktop-full-macos.yml` after the full stack is green;
10. only then publish the post-stack Intel DMG.

The product should keep moving through validated canonical layers rather than trading the current architecture for a single unreviewable mega-merge.
