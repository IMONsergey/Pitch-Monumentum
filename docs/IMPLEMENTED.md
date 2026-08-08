# Implemented state

This document tracks what is actually present in the repository. It is intentionally stricter than the product vision: a feature is listed here only when there is a concrete canonical model, runtime path, editor/tool integration, or test coverage behind it.

## 1. Canonical project platform

Implemented:

- TypeScript-first presentation domain model with stable deck, slide and scene-object IDs.
- Versioned filesystem `ArtifactStore` with SHA-256 content hashes and immutable artifact versions.
- Branch metadata, branch checkout and non-destructive branch forks.
- `VersionJournal`-based branch-local undo/redo for canonical deck state.
- Dependency graph and stale/downstream invalidation primitives.
- Deterministic QA and export invalidation after editor mutations.
- Source ingestion foundations and evidence/source anchors.
- Codex App Server gateway/transport foundations.

The project model remains the source of truth. HTML, DOM state, PPTX and preview surfaces are projections of that model.

## 2. Professional editor engine

Implemented:

- Moveable/Selecto/Guides/InfiniteViewer-backed editor canvas.
- Stable selection and canonical geometry commits.
- Drag, resize, rotate, nudge, exact geometry, arrange, align and distribute.
- Group/ungroup, lock/unlock, copy/paste and duplicate semantics.
- Frames and deterministic hierarchy validation.
- Yoga-backed Auto Layout with direction, gap and padding controls.
- Slide creation, duplication, deletion, reorder and rename.
- Right-side Inspector with exact properties.
- Rich text editing and typography controls.
- Appearance engine with native fills/gradients, stroke and shadows where supported by the scene/export model.
- Vector engine with Pen/Pencil authoring, path data and node editing.
- Native editable line, table and chart scene primitives.
- Editor context preservation across project-state reloads so the current slide/selection does not reset after tool-driven edits.
- Command Palette for common insert/edit/storyboard/presentation actions.

## 3. Asset library and image/media production

Implemented:

- project-local content-addressed PNG/JPEG asset store under `.project/assets`;
- SHA-256 deduplication and stable asset IDs;
- byte-level PNG/JPEG validation instead of trusting client MIME labels;
- canonical image dimensions decoded from stored bytes;
- source metadata, file size, usage counts and safe deletion;
- protection against deleting image/icon/video/poster assets still referenced by scene objects;
- Assets Library UI with search, import and reuse;
- drag/drop images directly onto a slide;
- clipboard image paste;
- canonical `insertImage` editor command with ordinary deck history and asset dependency references;
- actual asset-byte rendering on the editor canvas and in Presenter;
- visible missing-asset failure state;
- image fit: `cover`, `contain`, `stretch`;
- normalized non-destructive crop bounds;
- image corner radius;
- linked asset replacement without recreating the image object;
- alt text updates;
- atomic multi-property media update in the visual editor;
- Media Inspector UI;
- Codex/MCP bounded media commands;
- PPTX export resolution through the same project asset store into native PowerPoint picture objects;
- export fails loudly when a canonical image reference has missing/unreadable bytes.

Still open in advanced media editing:

- direct crop handles/focal-point editing on canvas;
- arbitrary vector image masks;
- background-removal/generative-media adapters;
- richer image treatments/blend modes;
- production video/audio ingestion/playback/export semantics.

## 4. Reusable components — Component System 2.0 core

Implemented:

- validated `ComponentDefinition` artifacts;
- create component from current selected scene roots;
- descendant closure for selected frames/groups;
- geometry localization into component coordinates;
- automatic text, image, fill and stroke slots;
- component insertion with stable instance IDs and optional slot overrides;
- linked instance tags for instance ID, component definition ID and source/master element identity;
- inserted instances are placed above existing slide content while preserving internal z-order;
- component-instance registry/summaries derived from canonical deck state;
- master update from a selected object tree;
- propagation of master structural/visual changes into all linked instances;
- stable instance element IDs across master refresh where possible;
- preservation of local text/image/fill/stroke slot overrides during master propagation;
- removed master slots safely drop stale overrides instead of breaking refresh;
- `Sync all` / refresh linked instances;
- reset one instance to master, clearing its local slot overrides;
- detach instance while preserving ordinary editable scene content;
- branch-aware component artifacts;
- Components 2.0 library UI with instance counts and Update Master / Sync All / Reset / Detach actions;
- Codex/MCP parity for create, insert, master update, sync, reset and detach.

Still open for a mature design-system layer:

- typed variants/properties beyond the current automatic slots;
- nested component-instance semantics;
- shared/team component libraries across projects;
- design-token/theme binding and brand locks.

## 5. Motion Studio

Implemented as a branch-aware canonical `MotionDocument` sidecar:

- slide transitions: none/fade/push/wipe/dissolve;
- entrance, emphasis and exit builds;
- `onClick`, `withPrevious`, `afterPrevious` build semantics;
- build order and deterministic phase compilation;
- exact element keyframe tracks for x/y/width/height/rotation/opacity/scale;
- easing support;
- motion validation against current slide and element IDs;
- reconciliation that removes impossible stale motion references after deck edits rather than guessing replacement targets;
- independent motion undo/redo history, separate from deck history;
- Motion Studio UI;
- Codex/MCP motion commands.

## 6. Presenter / motion preview

Implemented:

- Present action from the editor;
- start from the currently active slide;
- click/keyboard navigation through builds and slides;
- back navigation;
- transition preview;
- build-effect preview;
- continuous keyframe sampling from the canonical motion engine;
- auto-advance semantics;
- speaker notes toggle;
- fullscreen presentation mode;
- progress/build counters;
- real project image rendering through the same asset content path as the editor.

Presenter visual parity still needs continued hardening for every advanced Appearance/Vector treatment and future video/audio media.

## 7. Desktop preview

Implemented:

- Electron shell hosting the real local `PitchWorkspaceService` rather than a remote web wrapper;
- built-in four-slide first-run preview project;
- reopen last project;
- native Open Project dialog;
- reset preview project;
- native menu for PPTX export, Finder reveal and Present;
- secure renderer defaults: context isolation on, Node integration off;
- x64 DMG packaging definition for Intel macOS;
- dual macOS build jobs: native Intel reference plus x64 cross-package fallback;
- packaged executable architecture verification via `file` before an artifact is accepted.

Current release limitation: the development DMG is unsigned until Apple Developer ID/notarization credentials are connected.

## 8. Codex / MCP editor parity

Live Pitch tool families include:

- `pitch_project_state`;
- `pitch_editor_command`;
- `pitch_media_command`;
- `pitch_motion_command`;
- `pitch_component_command`;
- `pitch_undo` / `pitch_redo`;
- `pitch_motion_undo` / `pitch_motion_redo`.

`pitch_project_state` exposes slide/object handles, assets, component masters, linked instances and motion state. Component commands cover master update/propagation and instance reset in addition to create/insert/detach.

Codex is instructed to read current object handles and hashes first, make bounded canonical edits, and use the same project state that the human editor consumes. Raw deck-file rewriting is not the normal editing path.

## 9. PPTX and preview/export foundations

Implemented:

- native editable PPTX production pipeline for the supported scene primitives;
- stable PowerPoint object identity where supported;
- native project images and crop data through the RichAsset pipeline;
- native gradients/shadows and expanded primitive parity from the Pro Editor milestone;
- export QA/invalidation integration;
- missing asset integrity checks;
- HTML/project preview foundations.

The long-term interop target remains broader: PPTX round-trip hardening, Figma export, Keynote-compatible delivery, PDF/PNG production surfaces and stronger fidelity evaluation.

## 10. Validation discipline

Repository CI is the release gate:

```bash
npm install
npm run check
npx playwright install --with-deps chromium
npm run test:editor-e2e
```

`npm run check` covers TypeScript, unit tests and build checks configured by the repository. Pull-request CI then runs the Chromium editor E2E job after the main test job succeeds. The desktop workflow separately produces and verifies x86_64 DMG artifacts.

## Current next milestone

The production core now includes Motion, real image Assets, linked Components 2.0 and a Desktop shell. The next product work should be split between release hardening and the remaining high-value production gaps:

1. finish CI/Intel DMG release validation and smoke-test the packaged app;
2. advanced image editing: crop handles, focal point, vector masks and background-removal/generation adapters;
3. typed component variants, nested instances and design tokens/themes;
4. video/audio media production;
5. AI Creative Director loop on top of the now-shared canonical editor/assets/components runtime;
6. collaboration/visual branches;
7. Figma/Keynote/PPTX interoperability hardening.

See `docs/08-ROADMAP.md` for milestone order.
