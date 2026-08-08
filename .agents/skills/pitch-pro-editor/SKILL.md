---
name: pitch-pro-editor
description: Operate the Pitch Monumentum visual presentation editor through canonical professional tools. Use for manual-equivalent object edits, layout, storyboard operations, branching-safe undo/redo, slide creation/duplication/reordering, exact geometry/typography changes, or when the user asks Codex to work directly on a Pitch presentation. Prefer Pitch tools over raw JSON/file edits.
---

# Pitch Pro Editor

## Core rule

Pitch is a visual document system, not a JSON editing exercise.

**Never rewrite `DeckDocument` files directly when an equivalent Pitch tool exists.**

The same command path is shared by the visual editor and Codex so that:
- stable object/slide IDs remain valid;
- VersionJournal gets one intentional undo point per operation;
- branch isolation remains intact;
- QA/export invalidation is correct;
- Auto Layout containers reflow deterministically;
- the user can continue manually after an agent edit.

## Required operating loop

1. Call `pitch_project_state` before meaningful editing.
2. Resolve exact `slideId` / `elementId` handles from current state.
3. Choose the narrowest bounded command.
4. Pass the current `deckHash` as `expectedDeckHash` for mutations when available.
5. Execute one coherent atomic edit.
6. Re-read state whenever IDs, slide order, hierarchy, or selection could have changed.
7. Verify that only intended slide/object scope changed.
8. If a change is wrong, use `pitch_undo` immediately rather than attempting ad-hoc reverse math.

## Scope discipline

- One selected object → change only that object unless the user's request explicitly implies a wider layout change.
- Multi-selection → act only on selected roots; descendants follow hierarchy/container rules.
- A slide-level request may edit that slide, not neighboring slides.
- A deck-level request may change storyboard structure, but preserve accepted evidence/content unless explicitly asked otherwise.
- Never silently unlock objects.
- Never guess element IDs from names. Read current state first.

## Preferred tool mapping

Read `references/commands.md` for the full command map.

Typical mapping:
- “move 8 px right” → `nudge`
- “align these left” → `align`
- “same spacing horizontally” → `distribute`
- “make another one” → `duplicate`
- “group these” → `group`
- “lock background” → `lock`
- “bring forward” → `arrange`
- exact X/Y/W/H/rotation/opacity/font → `setInspector`
- new basic content → `insertText` / `insertShape` / `insertFrame`
- new slide → `newSlide`
- clone current slide → `duplicateSlide`
- reorder slide → `moveSlide`
- rename slide → `renameSlide`
- remove slide → `deleteSlide`

## Storyboard operations

Storyboard changes are normal canonical versions.

After `newSlide` or `duplicateSlide`, use the returned `nextSlideId` for subsequent work. Do not assume a generated ID.

When deleting a slide:
- do not delete the final remaining slide;
- re-read state because the active/next slide handle may change.

When reordering:
- use zero-based `toIndex`;
- re-read state before a sequence of multiple moves.

## Geometry and hierarchy

The editor uses 1920×1080 Design Units for standard widescreen.

- Keep geometry finite and dimensions > 0.
- Use normal commands for movement/size, not DOM/CSS hacks.
- Group/frame children are canonical hierarchy; do not mutate child IDs manually.
- Auto Layout parent reflow is owned by the command engine.
- Do not manually recalculate Yoga geometry after a bounded command.

## Typography

`setInspector` is for whole-box text styling.

Use the in-canvas Lexical editing path for mixed inline formatting when exposed by the active toolset. Do not flatten rich text into one style merely because the requested change concerns one run.

## Data/evidence safety

Geometry/style commands must not alter factual meaning.

If a text, table, or chart object is linked to claim/evidence/dataset dependencies:
- preserve those dependencies;
- do not invent replacement values;
- if the user asks to change a factual number, ensure the source/evidence workflow supports the new value.

## Version/branch behavior

Every command is branch-local.

For an experiment such as “CFO version” or “bolder design”:
- fork the appropriate branch through the product's version workflow when available;
- keep accepted main work intact;
- use diff/merge tooling rather than copying presentation files.

## Completion

An edit is complete only when:
- the intended canonical object/slide changed;
- no unrelated scope changed;
- the deck remains valid;
- the result can still be manually edited;
- export/QA state is allowed to become stale and re-run normally rather than being bypassed.
