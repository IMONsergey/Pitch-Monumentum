# Scene hierarchy integrity — `childIds` + legacy `groupId`

Pitch currently has two hierarchy signals on scene elements:

- canonical container `childIds` on `frame` / `group`;
- legacy/convenience `groupId` on any `SceneElementBase`.

The Pro Editor and several import/export surfaces inherited both forms. A renderer that reads only one form can disagree with another renderer about parentage.

## Current hardening

Standalone Web and Figma Bridge importer now defensively build one parent map from the union of:

1. container `childIds`;
2. `groupId` when the target exists.

They:

- deduplicate the same parent relation;
- reject multiple different parents;
- avoid duplicate root rendering;
- guard cycles / unrendered nodes.

This prevents silent delivery loss even before the core model migration lands.

## Remaining canonical gap

`packages/mutations/src/index.ts::validateSceneHierarchy()` currently validates only `childIds`.

Therefore a malformed `groupId` may still enter canonical state and be interpreted differently by surfaces that honor it.

## Required core behavior

During the core rebase, make hierarchy validation treat both forms as one relation:

- `groupId` target must exist;
- `groupId` target must be a `frame` or `group`;
- if a child is present in a container `childIds` and has `groupId`, both must name the same parent;
- one element cannot have two parents;
- `groupId` relations participate in cycle detection;
- container `childIds` remain the canonical serialized ownership list;
- commands that establish/move parentage should keep `groupId` synchronized or deprecate it in a migration-safe way.

## Migration direction

Preferred end state:

- `childIds` is the only canonical ownership relation;
- `groupId` becomes derived compatibility metadata or is removed in a future schema version;
- old decks containing only `groupId` are migrated by reconstructing container `childIds` deterministically;
- importers should never create contradictory parent signals.

## Regression corpus

Required tests:

1. `childIds` only;
2. `groupId` only legacy scene;
3. both forms agree;
4. both forms disagree;
5. missing groupId target;
6. groupId target is not container;
7. multiple parents;
8. cycle formed only through groupId;
9. cycle formed through mixed childIds/groupId;
10. Web/Figma/PPTX consume the migrated hierarchy consistently.

Do this during a core rebase with real TypeScript/unit/E2E execution, not as an isolated delivery-branch patch that bypasses the main mutation tests.
