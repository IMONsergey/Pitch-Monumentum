# Pitch Monumentum

**AI-native presentation development environment with a real professional editor under the agent layer.**

Pitch Monumentum is not a prompt-to-slides toy and not a PowerPoint clone. The product is being built around a canonical presentation project that both a human visual editor and Codex can operate directly.

The target is a single environment for:

```text
sources / brand / old decks / prompt
                ↓
 evidence · brief · narrative · storyboard
                ↓
        editable SceneGraph editor
                ↓
 human editing ⇄ Codex editing ⇄ QA
                ↓
 components · motion · presenter · versions
                ↓
      PPTX · Figma · Keynote · PDF · web
```

The internal project model — not PPTX, DOM, React or screenshots — is the source of truth.

## Current product state

The repository is well past its original Phase 0 foundation.

### Canonical project platform

- versioned artifact store and content hashes;
- branch heads and non-destructive forks;
- branch-local deck history;
- dependency/stale propagation;
- source/evidence foundations;
- deterministic QA/export invalidation;
- Codex gateway/tool infrastructure.

### Pro Editor

- Moveable/Selecto/Guides/InfiniteViewer canvas;
- drag/resize/rotate/nudge;
- align/distribute/arrange;
- frames, groups, locking and Auto Layout;
- exact Inspector;
- rich text;
- gradients/shadows/appearance controls;
- Pen/Pencil vector engine and node editing;
- editable line/table/chart primitives;
- storyboard create/duplicate/delete/reorder/rename;
- native editable PPTX production path for supported primitives.

### Motion & Components Studio

The current major milestone adds:

- branch-aware canonical `MotionDocument`;
- slide transitions, builds and keyframes;
- motion-specific undo/redo;
- reusable component artifacts and instances;
- text/image/fill/stroke component slots;
- non-destructive image crop/fit/media controls;
- live Motion Studio;
- Component Library UI;
- Presenter preview with builds, keyframes, speaker notes and fullscreen;
- Codex/MCP tools for motion, media and components.

See [`docs/IMPLEMENTED.md`](docs/IMPLEMENTED.md) for the strict implementation matrix.

## Run locally

```bash
npm install
npm run check
npm run demo
npm run serve
```

For the professional editor use the editor route exposed by the workspace server. The repository CI also runs Chromium E2E coverage for the editor after the main `npm run check` gate.

## Key documents

- [`docs/00-EXECUTIVE-BLUEPRINT.md`](docs/00-EXECUTIVE-BLUEPRINT.md)
- [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md)
- [`docs/03-DECK-MODEL.md`](docs/03-DECK-MODEL.md)
- [`docs/04-AGENTS-AND-WORKFLOWS.md`](docs/04-AGENTS-AND-WORKFLOWS.md)
- [`docs/05-CANVAS-UX.md`](docs/05-CANVAS-UX.md)
- [`docs/06-PPTX-PIPELINE.md`](docs/06-PPTX-PIPELINE.md)
- [`docs/07-QA-EVALS.md`](docs/07-QA-EVALS.md)
- [`docs/08-ROADMAP.md`](docs/08-ROADMAP.md)
- [`docs/12-BACKLOG.md`](docs/12-BACKLOG.md)
- [`docs/IMPLEMENTED.md`](docs/IMPLEMENTED.md)

## Codex operation

The repository contains project-specific agent skills under `.agents/skills/`.

The professional editor skill instructs Codex to:

1. read current Pitch project state and stable handles;
2. use bounded canonical tool commands instead of rewriting deck JSON;
3. use deck hashes/motion hashes for optimistic concurrency;
4. re-read state after ID/hierarchy/history changes;
5. use deck undo for deck mistakes and motion undo for animation mistakes.

This keeps human and agent editing on the same project model.

## Next milestone

After Motion & Components Studio, the next implementation target is **Asset & Media Production**:

- real project asset storage/import;
- thumbnails/search/metadata;
- actual image rendering across editor/presenter/export;
- interactive crop/focal point/masks;
- generated images entering the same asset pipeline;
- video/audio primitives;
- stronger component-instance propagation and presenter fidelity.

See [`docs/08-ROADMAP.md`](docs/08-ROADMAP.md) for the full milestone order through design systems, AI creative direction, collaboration, Figma/Keynote/PPTX interop and large-scale presentation intelligence.
