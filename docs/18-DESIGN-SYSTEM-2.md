# Design System 2.0 — Live Tokens, Brand QA and Component Variants

Status: clean stacked milestone on `feat/design-system-tokens-v2`, based on Advanced Media Studio.

## Product goal

Turn brand/style decisions into reusable canonical intent without sacrificing the native editable scene that Editor, Presenter and PowerPoint already consume.

The system deliberately uses two simultaneous representations:

```text
DeckTheme token       Element binding
     │                       │
     └──────────┬────────────┘
                ↓
       materialized native value
                ↓
   SceneGraph / Editor / Presenter / PPTX
```

A token binding is the source of design intent. The current concrete color/font/size remains materialized on each object so existing rendering/export paths never depend on CSS variables or a hidden runtime resolver.

## Live theme

A `DeckTheme` contains:

- colors;
- fonts;
- type scale in points;
- spacing in Design Units.

Current object binding targets:

- shape/frame fill;
- shape/frame/line stroke color;
- text color;
- text font family;
- text font size.

Spacing tokens are already part of the canonical theme and intentionally reserved for the next Auto Layout / recipe binding pass.

## Commands

### initializeTheme
Creates the deck-local live theme. The recommended bootstrap source is the existing canonical `DesignSystem` artifact, not an invented second palette.

### setToken
Changes or creates one token. Every object bound to that token is updated in the same command result.

### bindToken
Binds one target on one or more objects and immediately materializes the current token value.

### unbindToken
Removes the intent binding but preserves the current concrete value. Future token changes no longer affect the object.

### deleteToken
Allowed only if no object still references the token.

### renameTheme
Changes theme identity metadata without touching visual content.

## Canonical history

`executeWorkspaceDesignCommand` writes through the same `ArtifactStore` and `VersionJournal` as ordinary visual-editor deck mutations.

Consequences:

- one token edit + all propagation = one deck version;
- standard Pitch Undo restores both token definition and all prior materialized values;
- no second design-system history exists;
- branch behavior remains ordinary deck behavior;
- deterministic QA and brand QA are regenerated with the same version.

A regression test explicitly validates token change → propagation → ordinary `PitchWorkspaceService.undo()`.

## Existing-deck migration

Most real presentations begin with literal styles rather than token bindings. Design System 2.0 therefore has an inference layer.

High-confidence suggestions currently include:

- exact fill color match;
- exact stroke color match;
- uniform text color match;
- uniform font family match;
- exact or near-exact type-scale match.

Mixed rich-text boxes are not collapsed into one token binding.

`planDesignMigration` is a pure dry-run that reports:

- all suggestions;
- accepted suggestions above a confidence threshold;
- bounded binding commands;
- current and predicted token coverage;
- current and predicted brand QA;
- affected slides and elements.

It never writes a version. Bulk migration should be reviewed from this plan before application.

## Brand QA

Brand QA distinguishes three important cases:

1. **Bound brand value** — canonical and live.
2. **Hardcoded brand value** — visually correct today, but not connected to the theme.
3. **Unknown/off-brand value** — literal value outside the current theme set.

Coverage is calculated overall and by binding target. Mixed box-level typography is surfaced separately because it needs inline/rich-text handling rather than unsafe box-level tokenization.

## Integrated editor panel

The Design Workspace composition server wraps the existing Workspace server instead of forking it.

It adds:

- `GET /api/design-state`;
- `POST /api/design-bootstrap`;
- `POST /api/design-command`;
- `POST /api/design-migration-plan`;
- the Design System panel appended to the existing editor bundle.

Every original Workspace route is delegated to the original server handler unchanged.

The panel provides:

- top-bar **Design** entry;
- `Cmd/Ctrl + Shift + D` shortcut;
- live token editing;
- add/delete token;
- selection target/token bind and unbind;
- coverage meter;
- Brand QA list;
- migration dry-run;
- theme bootstrap from the current DesignSystem artifact.

## Codex / MCP

A dedicated Design MCP exposes:

- `pitch_design_state`;
- `pitch_design_bootstrap`;
- `pitch_design_command`.

`pitch-mcp-next` composes those same tools into the existing Pitch MCP server so object/media/motion/component/design operations can share one project and one stdio tool catalog.

Recommended agent loop:

1. read design state;
2. bootstrap only if theme is absent and a source DesignSystem is available;
3. inspect coverage / QA / binding suggestions;
4. make one bounded token or binding change with current deck hash;
5. re-read state;
6. use ordinary Pitch Undo if the visual result is wrong.

## Component integration

Token bindings survive:

- component master creation;
- linked instance insertion;
- master refresh.

Component variants are a separate typed layer over existing `ComponentOverride` values.

A `ComponentVariantSet` has:

- named axes (`state`, `tone`, `size`, etc.);
- allowed values and defaults;
- conditional rules;
- slot overrides.

Rules compose from broad to specific; more-specific rules win deterministically for the same slot. Variant instantiation still produces normal editable component elements and the normal `ComponentInstanceRecord`.

This avoids duplicating masters for every state combination.

## Explicit next work

After this milestone:

- wire spacing tokens into Auto Layout gap/padding bindings;
- design recipes and archetype tokens;
- save variant sets as branch-aware artifacts and add Components UI controls;
- migrate the additive Design tools into the primary MCP entry/package script after stacked PRs land;
- theme import/export and brand-package exchange;
- automatic safe migration application as one reviewed transaction;
- token-aware Inspector badges and variable pickers directly beside visual properties;
- semantic roles (`surface`, `accent`, `danger`, `body`, `display`) as higher-level agent constraints.
