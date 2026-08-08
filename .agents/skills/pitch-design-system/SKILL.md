---
name: pitch-design-system
description: Operate Pitch Monumentum Design System 2.0: live theme tokens, brand coverage/QA, migration suggestions, token bindings and component variants. Use when the user asks to change brand colors/fonts/type scale globally, connect existing styles to brand tokens, audit brand consistency, initialize a live theme from the project DesignSystem, or reason about component states/variants.
---

# Pitch Design System 2.0

## Core principle

A live token is **design intent**, while each scene object still contains the current materialized native value.

Never replace the Pitch scene with CSS variables, theme-only render state, or an export-only palette lookup. Token changes must remain compatible with manual editing, Presenter and native PPTX export.

## Required loop

1. Read `pitch_design_state`.
2. Use the returned current deck hash.
3. If no live theme exists and `suggestedTheme` is available, prefer `pitch_design_bootstrap` over inventing a new palette.
4. Inspect coverage, Brand QA and binding suggestions.
5. Execute one coherent `pitch_design_command`.
6. Re-read design state and verify intended scope.
7. Use ordinary Pitch deck undo if the result is wrong.

Design changes do **not** have a separate undo stack.

## Commands

### initializeTheme
Use only when the project intentionally needs a different theme than the canonical DesignSystem artifact. Otherwise use bootstrap.

### setToken
Use for a global token change or to create a new named token.

A token update automatically propagates to every object bound to that token in one ordinary deck version.

### bindToken
Bind compatible selected objects to a named token target:
- `fill`;
- `strokeColor`;
- `textColor`;
- `fontFamily`;
- `fontSizePt`.

Do not bind an incompatible object just because a value is visually similar.

### unbindToken
Stops future propagation but keeps the current concrete materialized value.

### deleteToken
Only after all bindings are removed. Bound token deletion must fail closed.

### renameTheme
Metadata-only theme rename.

## Existing deck migration

Do not bulk-bind styles blindly.

Use migration/inference results to distinguish:
- exact brand-value matches;
- near-exact type-scale matches;
- mixed rich-text boxes;
- off-brand values.

Exact high-confidence matches are strong candidates for migration. Mixed rich text requires inline-aware treatment and should not be collapsed into one box token.

Migration should begin with a dry-run showing predicted coverage, affected objects and remaining major Brand QA issues.

## Brand QA interpretation

- **bound**: value is live and governed by theme intent;
- **hardcoded-brand-value**: visually correct but disconnected from theme;
- **unknown-brand-value**: outside current theme and needs review;
- **mixed-text-style**: box-level binding is unsafe;
- **materialized-value-mismatch**: object has a token binding but its concrete value drifted from the token.

## Component behavior

Token bindings belong to scene elements and therefore survive component master authoring, linked instance creation and master refresh.

Do not strip bindings during component edits unless explicitly asked.

## Component variants

Variants reuse the ordinary component definition and slot override system. They are not separate masters.

A variant set contains axes such as:
- `state`: default / hover / disabled;
- `tone`: primary / neutral / danger;
- `size`: small / medium / large.

Rules may match one or multiple axes. More-specific matching rules override broader rules for the same slot. The resolved result still instantiates ordinary editable component objects.

## Scope discipline

- Global token edit → deck-wide propagation is intended scope.
- Binding edit → only selected compatible objects.
- Migration → review dry-run before large scope.
- Component variant selection → one instance unless explicitly applying a variant system more broadly.
- Never invent token names when existing semantic tokens already fit the request.

## Completion

A Design System edit is complete only when:
- canonical token/theme state is valid;
- materialized scene values match live bindings;
- Brand QA/coverage are re-read;
- manual editor state remains native/editable;
- component links survive;
- standard deck undo can reverse the change;
- Presenter/PPTX can consume the result without resolving a second styling model.
