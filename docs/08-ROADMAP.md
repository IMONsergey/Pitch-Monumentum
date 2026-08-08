# Pitch Monumentum — product roadmap

The roadmap is organized around one product rule: every major capability must become part of the canonical project model and be operable both manually and through Codex. UI-only demos do not count as finished milestones.

## Product target

Pitch Monumentum should become an AI-native presentation environment with the manual power of a serious visual editor and the agentic power of Codex:

```text
Sources / brand / existing deck / prompt
                ↓
        grounded project context
                ↓
    strategy · narrative · storyboard
                ↓
        editable visual scene graph
                ↓
  human editing ⇄ Codex editing ⇄ QA
                ↓
 motion · presenter · collaboration · export
                ↓
      PPTX · Figma · Keynote · PDF · PNG
```

The canonical project is the source of truth. Export formats are outputs, not the editing database.

---

## M0 — Canonical PitchOS foundation — DONE

Core platform:

- Deck/Slide/Scene document contracts;
- artifact store and content hashes;
- branch heads;
- dependency/stale graph;
- deterministic QA;
- source/evidence foundations;
- Codex gateway foundations;
- native PPTX/HTML foundations.

Exit condition: a presentation can exist as a stable, versioned semantic project rather than a collection of rendered slide screenshots.

## M1 — Pro Editor & editable output parity — DONE

Professional visual editing:

- production canvas interaction engine;
- selection/transform/arrange/alignment/distribution;
- hierarchy, frames and Auto Layout;
- exact Inspector;
- rich text;
- Appearance engine;
- gradients/shadows;
- Vector Pen/Pencil + node editing;
- editable table/chart/line primitives;
- slide storyboard operations;
- branch-safe history;
- Codex editor-command parity;
- expanded native PPTX parity.

Exit condition: Pitch behaves like an actual editor rather than a generated-deck viewer.

## M2 — Motion, Components & Presenter — CURRENT MILESTONE

This milestone turns static editing into a presentation-production environment.

Scope:

- canonical `MotionDocument` sidecar;
- transitions;
- builds and build order;
- keyframe tracks;
- independent motion history;
- reusable component definitions;
- text/image/fill/stroke component slots;
- component insertion and detach;
- Media Inspector and non-destructive image crop/fit;
- live Motion Studio;
- Component Library UI;
- Presenter/motion preview;
- speaker notes/fullscreen/navigation;
- Codex/MCP tools for motion, media and components;
- context preservation across state reloads.

Exit condition: the same presentation can be authored, animated, componentized and presented without leaving the canonical Pitch project.

## M3 — Asset & Media Production — NEXT

This is the next highest-value gap because professional decks are media-heavy and current image objects still need a full production asset path.

### Asset system

- project asset store;
- drag/drop and file picker upload;
- paste/import from clipboard;
- thumbnail generation;
- metadata, dimensions, checksum, source/provenance;
- duplicate detection;
- folders/tags/search/recent assets;
- replace asset while preserving object geometry/crop;
- brand asset collections.

### Image editing

- real image rendering in canvas/presenter/export;
- interactive crop mode;
- focal point;
- masks and arbitrary vector clipping;
- background removal adapter;
- opacity/blend controls where export supports them;
- image treatments tied to design tokens.

### Generative media

- create image from Codex/editor command;
- reference-image workflows;
- generated result enters the same asset store, never a special one-off path;
- provenance and prompt history;
- regenerate/variation/replace while preserving layout.

### Video/audio

- video element type;
- poster frame;
- trim/start behavior;
- autoplay/manual playback presentation semantics;
- audio object and speaker/presenter use cases;
- export fallbacks for formats that cannot preserve native media.

Exit condition: generated, imported and manually edited media all use one production-grade asset system.

## M4 — Component system 2.0 & Design Systems

Move from reusable local objects to scalable presentation systems.

- master component update propagation;
- variants and typed component properties;
- nested instances;
- controlled instance overrides;
- detach/reset override;
- shared component libraries;
- design tokens for color/type/spacing/effects;
- theme switch across a deck;
- brand-lock rules;
- design-system QA;
- reusable slide templates/archetypes built on components rather than hard-coded layouts.

Exit condition: a 100-slide deck can be restyled and maintained as a system, not edited slide by slide.

## M5 — AI Creative Director / Agentic production loop

Turn Codex from an editor operator into an autonomous but inspectable presentation production partner.

- intent-aware edit planner;
- object/slide/deck scope selection;
- reference-aware art direction;
- brand-context retrieval;
- source-grounded copy editing;
- layout critique with actionable fixes;
- automatic adaptation from a master slide/KV;
- visual dependency tracking;
- “change master → propose updates to dependent slides”;
- side-by-side alternatives/branches;
- agent change preview before commit for wide-scope actions;
- quality/evidence gates before export.

Exit condition: a user can ask for a strategic or visual change in natural language and Codex can plan, execute and verify it through the same editor model.

## M6 — Collaboration, branches and review

Bring Git-like safety into a visual presentation workflow without exposing Git complexity to normal users.

- named versions/checkpoints;
- branch browser;
- visual slide/object diff;
- accept/reject agent changes;
- branch comparison;
- controlled merge of non-conflicting edits;
- comments and review threads;
- approval states;
- multi-user presence and conflict strategy;
- project activity log.

Exit condition: teams and agents can work in parallel without duplicating PPTX files or overwriting accepted work.

## M7 — Interop & export hardening

Professional output must not lock the user into Pitch.

### PowerPoint

- stronger native object parity;
- master/theme parity;
- charts/tables/media hardening;
- animation mapping where possible;
- import → edit → export round-trip structural tests;
- automated PPTX fidelity corpus.

### Figma

- editable Figma export using frames/text/vectors/images/components where possible;
- stable object mapping;
- design-token/component translation;
- update/re-export strategy.

### Keynote

- production Keynote-compatible delivery path;
- preserve editable primitives where technically possible;
- document unsupported feature fallbacks explicitly.

### Static/delivery

- PDF;
- PNG/JPEG slide assets;
- web presentation package;
- presenter links/share mode;
- optional video render for motion-heavy decks.

Exit condition: Pitch can be the creation environment even when the client requires another delivery format.

## M8 — Presentation intelligence & large-scale production

- semantic slide search;
- presentation memory/reuse;
- approved-slide library;
- reusable claims/evidence blocks;
- organization-level brand/context layer;
- localization and language variants;
- adaptation to audience/meeting type;
- automatic executive-summary variants;
- bulk deck generation from structured data;
- production analytics and quality benchmarks.

Exit condition: Pitch scales from one deck to a company's presentation operating system.

---

## Near-term order after M2

The practical implementation order is:

1. **Asset & Media Production** — unblock real image-heavy professional work.
2. **Component System 2.0 / Design Systems** — make large decks maintainable.
3. **AI Creative Director loop** — exploit the canonical editor model for high-value agentic work.
4. **Collaboration/visual branches** — support real team workflows.
5. **Figma/Keynote/PPTX hardening** — finish professional interoperability.

This order intentionally favors the editor's production core before adding marketplace, growth, template-community or other peripheral product layers.
