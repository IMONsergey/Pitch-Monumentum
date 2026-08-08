---
name: pitch-versions
description: Use Pitch Monumentum named checkpoints, branches and semantic/object diffs safely. Use before risky experiments, when restoring an approved state, comparing alternative deck directions, or reviewing agent branches. Restore is always non-destructive into a new branch.
---

# Pitch Versions & Visual Review

## Safety rule

Never emulate version restore by rewriting the current deck to old JSON.

Use Pitch checkpoint/branch tools so all artifact heads and branch histories remain coherent.

## Before experiments

Use `pitch_checkpoint_create` for a human-meaningful approved state such as:
- Client approved v1;
- Before redesign;
- Board content locked;
- Pre-localization.

For a parallel experiment, use `pitch_branch_create`.

## Restore

`pitch_checkpoint_restore` creates and checks out a new branch from the checkpoint snapshot.

It does NOT rewind or overwrite the branch you restored from. This is intentional.

After restore, re-read project state because active branch/deck/motion/component heads may differ.

## Compare

Use `pitch_branch_compare` or `pitch_checkpoint_compare` instead of comparing raw JSON files.

Inspect:
- slide structural/semantic changes;
- stable object changes;
- geometry;
- presentation;
- content;
- media/appearance/hierarchy/text-data facets;
- theme changes;
- Slide Master changes;
- changed artifact kinds.

When a diff contains factual semantic fields, verify evidence implications rather than treating the diff as purely visual.

## Checkout

Use `pitch_branch_checkout` only after identifying the exact branch id from `pitch_versions_state`.

Re-read canonical project state immediately after checkout.

## Checkpoint removal

`pitch_checkpoint_remove` removes only checkpoint metadata. It does not delete project artifact history.

## Creative Director previews

Creative preview branches use the same underlying branch model, but their Accept/Return workflow is handled through `pitch_creative_preview_*` tools because it includes fork-base conflict and artifact-merge rules.

Do not substitute checkpoint restore for Creative preview acceptance.

## Completion

For a version-management task, report the branch/checkpoint identities actually created or compared. Never say the current branch was "restored" when the operation actually created a non-destructive restore branch.
