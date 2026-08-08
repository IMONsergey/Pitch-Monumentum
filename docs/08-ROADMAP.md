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

- Deck/Slide/Scene document contracts;
- artifact store and content hashes;
- branch heads;
- dependency/stale graph;
- deterministic QA;
- source/evidence foundations;
- Codex gateway foundations;
- native PPTX/HTML foundations.

Exit condition reached: a presentation exists as a stable, versioned semantic project rather than a collection of rendered slide screenshots.

## M1 — Pro Editor & editable output parity — DONE

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

Exit condition reached: Pitch behaves like an actual editor rather than a generated-deck viewer.

## M2 — Motion, Components & Presenter — DONE

- canonical `MotionDocument` sidecar;
- transitions;
- builds and build order;
- keyframe tracks;
- independent motion history;
- reusable component definitions;
- text/image/fill/stroke component slots;
- component insertion/detach;
- Media Inspector and non-destructive image crop/fit;
- live Motion Studio;
- Component Library UI;
- Presenter/motion preview;
- speaker notes/fullscreen/navigation;
- Codex/MCP tools for motion, media and components;
- context preservation across state reloads.

Exit condition reached: the same presentation can be authored, animated, componentized and presented without leaving the canonical Pitch project.

## M3 — Asset & Media Production — CORE DONE / ADVANCED MEDIA NEXT

### Completed asset production core

- project-local content-addressed image asset store;
- PNG/JPEG byte validation and canonical dimension extraction;
- SHA-256 duplicate detection;
- drag/drop, file picker and clipboard image import;
- searchable/reusable Assets Library;
- usage counts and safe deletion;
- replace asset while preserving ImageElement geometry/crop;
- real image rendering in editor and Presenter;
- canonical `insertImage` editor/Codex path;
- project asset resolution into native PPTX picture objects;
- missing-byte integrity failure instead of silent export degradation.

### Remaining advanced image work

- direct crop mode with handles;
- focal point;
- arbitrary vector clipping/masks;
- background removal adapter;
- generative image adapter with provenance/prompt history;
- image treatments/blend controls tied to design tokens;
- thumbnail/cache optimization for very large libraries;
- folders/tags/brand asset collections.

### Remaining video/audio work

- production video ingestion;
- poster-frame authoring;
- trim/start/autoplay semantics;
- audio objects;
- presenter playback semantics;
- explicit export fallbacks for formats without native media parity.

Core exit condition reached for still images: imported media uses one project-native asset system. Full M3 closes after advanced still-image and video/audio production are finished.

## M4 — Component System 2.0 & Design Systems — CORE DONE / DESIGN SYSTEM LAYER NEXT

### Completed Component 2.0 core

- linked master/instance identity;
- stable source-element mapping;
- instance registry derived from canonical deck state;
- master update from selected object tree;
- master structural/visual change propagation to all linked instances;
- preservation of text/image/fill/stroke slot overrides;
- safe stale-override removal when slots disappear;
- Sync All;
- Reset Instance to master;
- detach while preserving normal editable objects;
- instance insertion above existing scene content with preserved internal z-order;
- manual UI and Codex/MCP parity;
- regression coverage for propagation and reset.

### Remaining design-system layer

- typed component properties/variants;
- nested component instances;
- shared/team component libraries;
- first-class color/type/spacing/effect tokens;
- deck-wide themes;
- brand locks and design-system QA;
- reusable slide templates/archetypes built on components.

Core exit condition reached: linked components can be maintained as masters rather than copied objects. Full M4 closes when variants/tokens/shared libraries are production-ready.

## M5 — AI Creative Director / Agentic production loop — NEXT MAJOR PRODUCT MILESTONE

Turn Codex from an editor operator into an autonomous but inspectable presentation production partner.

- intent-aware edit planner;
- object/slide/deck scope selection;
- reference-aware art direction;
- brand-context retrieval;
- source-grounded copy editing;
- layout critique with actionable fixes;
- automatic adaptation from a master slide/KV;
- visual dependency tracking;
- master/component-aware deck-wide update proposals;
- side-by-side alternatives/branches;
- agent change preview before commit for wide-scope actions;
- quality/evidence gates before export.

Exit condition: a user can ask for a strategic or visual change in natural language and Codex can plan, execute and verify it through the same editor/assets/components model.

## M6 — Collaboration, branches and review

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

## Immediate order from the current branch

1. **Release freeze / Desktop Preview** — get strict CI green, package and smoke-test verified x86_64 DMG, then merge the milestone.
2. **Advanced Media** — crop handles, focal point, masks, generation/background removal and video/audio.
3. **Variants & Design Tokens** — finish Component/Design System 2.0 beyond the linked-instance core.
4. **AI Creative Director loop** — exploit canonical assets/components/motion for high-value deck-wide agentic changes.
5. **Collaboration/visual branches** — parallel human/agent workflows.
6. **Figma/Keynote/PPTX hardening** — professional interoperability.

This order keeps the production core ahead of marketplace, template-community, growth and other peripheral layers.
