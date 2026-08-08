---
name: pitch-pro-editor
description: Operate the Pitch Monumentum visual presentation editor through canonical professional tools. Use for manual-equivalent object edits, layout, storyboard operations, image crop/media work, reusable components, motion/transitions/keyframes, presenter-ready editing, branch-safe undo/redo, slide creation/duplication/reordering, or when the user asks Codex to work directly on a Pitch presentation. Prefer Pitch tools over raw JSON/file edits.
---

# Pitch Pro Editor

## Core rule

Pitch is a visual document system, not a JSON editing exercise.

**Never rewrite canonical project artifacts directly when an equivalent Pitch tool exists.**

The visual editor and Codex share command layers so that:
- stable object/slide IDs remain valid;
- VersionJournal gets intentional undo points;
- branch isolation remains intact;
- QA/export invalidation stays correct;
- Auto Layout reflows deterministically;
- motion remains presentation-semantic rather than DOM-only;
- reusable components remain editable artifacts rather than pasted screenshots;
- the user can continue manually after an agent edit.

## Required operating loop

1. Call `pitch_project_state` before meaningful editing.
2. Resolve exact `slideId` / `elementId` / component / motion handles from current state.
3. Choose the narrowest bounded tool family.
4. Pass the current `deckHash` for deck mutations and `motionHash` for motion edits when available.
5. Execute one coherent edit.
6. Re-read state whenever IDs, slide order, hierarchy, component instances, motion handles or history heads may have changed.
7. Verify only intended scope changed.
8. If a deck edit is wrong, use `pitch_undo`; if only animation is wrong, use `pitch_motion_undo`.

## Tool-family mapping

Read `references/commands.md` for exact payloads.

- geometry/selection/storyboard → `pitch_editor_command`
- image fit/crop/asset/radius → `pitch_media_command`
- transitions/builds/keyframes → `pitch_motion_command`
- component authoring/insert/detach → `pitch_component_command`
- deck history → `pitch_undo` / `pitch_redo`
- motion history → `pitch_motion_undo` / `pitch_motion_redo`

Typical mappings:
- “move 8 px right” → `nudge`
- “align these left” → `align`
- “same spacing horizontally” → `distribute`
- “group these” → `group`
- exact X/Y/W/H/rotation/opacity/font → `setInspector`
- “crop this image tighter” → `pitch_media_command:setImageCrop`
- “fade this in on click” → `pitch_motion_command:addBuild`
- “animate this from x=200 to x=900” → `pitch_motion_command:setTrack`
- “turn this card into a reusable component” → `pitch_component_command:createFromSelection`
- “insert that component here” → `pitch_component_command:insert`
- new/duplicate/reorder/rename/remove slide → corresponding storyboard command

## Scope discipline

- One selected object → change only that object unless the request explicitly implies wider layout work.
- Multi-selection → act only on selected roots; descendants follow hierarchy/container rules.
- A slide-level request may edit that slide, not neighbors.
- A deck-level request may change storyboard structure, but preserve accepted evidence/content unless asked otherwise.
- Never silently unlock objects.
- Never guess IDs from names. Read current state first.

## Geometry and hierarchy

Standard widescreen uses 1920×1080 Design Units.

- Geometry must stay finite; width/height > 0.
- Use canonical commands, not DOM/CSS hacks.
- Group/frame children are canonical hierarchy; do not mutate child IDs manually.
- Auto Layout parent reflow belongs to the command engine.
- Do not manually recalculate Yoga geometry after a bounded command.

## Image/media semantics

Image crop is normalized asset space, not destructive bitmap editing.

- Keep the image element editable.
- Preserve geometry, dependencies and semantic role unless the task says otherwise.
- Use `replaceImageAsset` rather than deleting/recreating an image when only the linked asset changes.
- Opposing crop sides must leave visible width/height.

## Components

Component definitions are reusable artifacts stored on the active branch.

When creating a component:
- selection closure includes descendants of selected frame/group roots;
- authored geometry is localized into component coordinates;
- definitions are validated before they are stored;
- text/image/fill/stroke slots may be exposed automatically.

When inserting:
- use returned instance IDs/selection IDs;
- do not infer generated child IDs unless state has been re-read;
- overrides must match slot kinds.

Detach only when the user wants the instance to become ordinary editable scene objects.

## Motion and presentation

Motion is stored in `MotionDocument` separately from `DeckDocument` geometry/content.

- slide transitions, click builds and keyframe tracks must use `pitch_motion_command`;
- build order is semantic and deterministic (`onClick`, `withPrevious`, `afterPrevious`);
- keyframes target stable element IDs;
- after object/slide deletion, stale motion references must be reconciled rather than retargeted by guesswork;
- use motion-specific undo/redo for animation-only mistakes.

The editor's Presenter/Preview path consumes this same motion state, so authoring commands must remain compatible with presenter semantics.

## Typography

`setInspector` is for whole-box text styling.
Use the in-canvas rich-text path for mixed inline formatting when exposed. Do not flatten rich text merely because one run is being changed.

## Data/evidence safety

Geometry/style/motion commands must not alter factual meaning.

If text/table/chart content is linked to claim/evidence/dataset dependencies:
- preserve those dependencies;
- do not invent replacement values;
- changing factual values requires the appropriate evidence/data workflow.

## Version and branch behavior

Deck history and motion history are branch-local but intentionally separate.

For experiments such as “CFO version”, “bolder design”, or an alternate animation treatment:
- fork using the product branch workflow when available;
- keep accepted main work intact;
- use diff/merge tooling rather than copying presentation files.

## Completion

An edit is complete only when:
- intended canonical scope changed;
- unrelated scope did not change;
- deck/motion/component data remain valid;
- the result is still manually editable;
- history semantics remain correct;
- presenter/export/QA paths can consume the result without bypasses.
