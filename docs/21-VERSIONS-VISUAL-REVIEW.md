# Pitch Monumentum — Versions & Visual Branch Review

Pitch versions are project snapshots and branches, not copied presentation files.

## Named checkpoints

A named checkpoint stores:

- human-readable name/description;
- source branch identity;
- timestamp;
- runtime deck hash;
- exact artifact heads for the project at that moment.

Checkpoints are immutable metadata. Removing a checkpoint removes only that saved pointer, not historical artifact versions.

## Non-destructive restore

Restore never rewinds the current branch.

`Restore checkpoint` creates a new branch from the checkpoint's exact artifact-head snapshot and checks it out. The branch starts its history at that snapshot. Work made after the checkpoint remains untouched on the source branch.

This removes the common presentation workflow of duplicating files such as `FINAL_v7_REAL.pptx` before experimenting.

## Branches

Normal branches fork the active project and record `baseHeads` at fork time. This provides a reliable base for later conflict detection and preview review.

The editor exposes:

- current branch;
- branch ancestry;
- branch deck hash;
- whether a fork base is tracked;
- artifact count;
- checkout;
- compare-to-current;
- new branch.

## Semantic/object diff

Branch/checkpoint comparison is based on canonical object identity, not screenshots alone.

Diff reports:

- slides added/removed/moved/renamed;
- slide semantic-contract fields changed;
- objects added/removed/type-changed;
- geometry changes;
- presentation changes;
- content changes;
- dependency changes;
- content facets: text/data, appearance, media, hierarchy and metadata;
- live theme changes;
- Slide Master changes;
- changed artifact kinds.

This diff engine is also used by Creative Director preview review.

## Conflict-safe preview acceptance

A preview branch can be one-click accepted only when its parent branch still matches the fork base for non-derived artifacts. If the parent changed in parallel, Pitch refuses overwrite and requires re-plan/rebase.

Unsupported artifact merges also block automatic partial acceptance. The current direct-accept path safely handles deck and motion histories; component-artifact preview changes are deliberately refused until a proper composite merge exists.

## History semantics

- deck Undo/Redo remains branch-local;
- motion history remains branch-local and separate from deck history;
- restored checkpoint branches initialize histories directly from saved heads;
- accepting a preview creates a new target deck version rather than moving target history backward.

## Editor surface

`Versions` drawer provides:

- Save checkpoint;
- New branch;
- Checkout;
- Compare;
- Restore checkpoint into new branch;
- Remove checkpoint metadata;
- slide/object/system diff viewer.

Shortcut: `Cmd/Ctrl + Shift + V`.

## MCP parity

Unified Pitch MCP exposes:

- `pitch_versions_state`;
- `pitch_checkpoint_create`;
- `pitch_checkpoint_remove`;
- `pitch_checkpoint_restore`;
- `pitch_branch_create`;
- `pitch_branch_checkout`;
- `pitch_branch_compare`;
- `pitch_checkpoint_compare`.

There is intentionally no destructive `reset current branch to checkpoint` tool.

## Product principle

Versions should feel like Keynote's version safety plus Git's branching power, without requiring a presentation designer to understand Git. The project remains one canonical Pitch project; branches and checkpoints are alternative histories of that project, not copied documents.
