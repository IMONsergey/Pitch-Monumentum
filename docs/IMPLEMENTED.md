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

## 3. Image/media editing

Implemented in the canonical editor model:

- image fit: `cover`, `contain`, `stretch`;
- normalized non-destructive crop bounds;
- image corner radius;
- linked asset replacement without recreating the image object;
- alt text updates;
- atomic multi-property media update in the visual editor;
- Media Inspector UI;
- Codex/MCP bounded media commands.

The remaining major media gap is the full user-facing asset library and real asset-byte ingestion/render pipeline. The editor currently understands image identity and editable media geometry, but the complete production asset browser/upload/mask workflow is a later milestone.

## 4. Reusable components

Implemented:

- validated `ComponentDefinition` artifacts;
- create component from current selected scene roots;
- descendant closure for selected frames/groups;
- geometry localization into component coordinates;
- automatic text, image, fill and stroke slots;
- component insertion with stable instance IDs and optional slot overrides;
- component-definition and component-instance tags on scene objects;
- detach instance while preserving ordinary editable scene content;
- branch-aware component artifacts;
- Components library UI;
- Codex/MCP component commands.

Not yet complete:

- master-definition change propagation into already-instantiated component instances;
- variants/properties comparable to a mature Figma component system;
- shared/team component libraries across projects.

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
- progress/build counters.

The presenter currently prioritizes motion semantics. Its render layer still needs full pixel-parity with every advanced Appearance/Vector/real-media rendering feature.

## 7. Codex / MCP editor parity

Live Pitch tool families now include:

- `pitch_project_state`;
- `pitch_editor_command`;
- `pitch_media_command`;
- `pitch_motion_command`;
- `pitch_component_command`;
- `pitch_undo` / `pitch_redo`;
- `pitch_motion_undo` / `pitch_motion_redo`.

Codex is instructed to read current object handles and hashes first, make bounded canonical edits, and use the same project state that the human editor consumes. Raw deck-file rewriting is not the normal editing path.

## 8. PPTX and preview/export foundations

Implemented:

- native editable PPTX production pipeline for the supported scene primitives;
- stable PowerPoint object identity where supported;
- native gradients/shadows and expanded primitive parity from the Pro Editor milestone;
- export QA/invalidation integration;
- HTML/project preview foundations.

The long-term interop target remains broader: PPTX round-trip hardening, Figma export, Keynote-compatible delivery, PDF/PNG production surfaces and stronger fidelity evaluation.

## 9. Validation discipline

Repository CI is the release gate:

```bash
npm install
npm run check
npx playwright install --with-deps chromium
npm run test:editor-e2e
```

`npm run check` covers TypeScript, unit tests and build checks configured by the repository. Pull-request CI then runs the Chromium editor E2E job after the main test job succeeds.

## Current next milestone

After Motion & Components Studio, the highest-value gap is **Asset & Media Production**:

1. real asset upload/import and project asset storage;
2. searchable asset library with thumbnails/metadata;
3. actual image rendering in editor/presenter/export;
4. masks, crop handles and focal-point editing;
5. generated-image insertion through the same asset path;
6. video/audio media objects and poster frames;
7. component-instance propagation/variants;
8. stronger presenter/export visual parity.

See `docs/08-ROADMAP.md` for milestone order.
