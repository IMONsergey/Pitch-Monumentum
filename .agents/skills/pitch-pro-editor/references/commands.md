# Pitch Pro Editor command map

Use this reference after reading `pitch_project_state`.

## Object commands

### nudge
Use for keyboard-like movement.
Required: `slideId`, `selectedIds`, `dx`, `dy`.
Prefer small exact DU deltas when the user gives a precise adjustment.

### align
Required: `slideId`, `selectedIds`, `alignment`.
Alignment values: `left`, `horizontalCenter`, `right`, `top`, `verticalCenter`, `bottom`.

### distribute
Required: `slideId`, `selectedIds`, `axis`.
Axis: `horizontal` or `vertical`.
Use only for 3+ selected root objects.

### duplicate
Required: `slideId`, `selectedIds`.
Optional `offsetDU`.
Returns new stable IDs; re-read state before editing the duplicate.

### delete
Required: `slideId`, `selectedIds`.
Deleting a selected container also removes its selected closure according to current editor command semantics.

### group / ungroup
Required: `slideId`, `selectedIds`.
Grouping preserves parent and sibling order when selected siblings share a parent.

### arrange
Required: `slideId`, `selectedIds`, `arrangement`.
Values: `bringToFront`, `bringForward`, `sendBackward`, `sendToBack`.

### lock
Required: `slideId`, `selectedIds`, `locked`.
Do not unlock without explicit user intent.

### setInspector
Required: `slideId`, `elementId`.
At least one of:
- `geometry`: x/y/width/height/rotation
- `presentation`: name/opacity/locked
- `textStyle`: fontFamily/fontSizePt/color/bold/italic/underline/letterSpacingPt

This is the preferred exact-properties command. It should be one atomic version even when changing several fields.

### insertText
Required: `slideId`, `geometry`.
Optional `text`.

### insertShape
Required: `slideId`, `geometry`.
Optional `shape`, `fill`.
Supported basic shapes depend on the active tool schema.

### insertFrame
Required: `slideId`, `geometry`.
Optional `fill`.

## Storyboard commands

### newSlide
Optional: `afterSlideId`, `title`.
Returns `nextSlideId`.

### duplicateSlide
Required: `slideId`.
Deep-clones scene hierarchy with new IDs and returns `nextSlideId`.
Claims/evidence/assets stay linked; QA issue IDs do not carry over.

### deleteSlide
Required: `slideId`.
Fails if this would remove the last slide.

### moveSlide
Required: `slideId`, `toIndex`.
`toIndex` is zero-based.

### renameSlide
Required: `slideId`, non-empty `title`.

## History

### pitch_undo
Branch-local undo to the previous canonical deck head.
Use after an unintended mutation rather than manually reversing geometry.

### pitch_redo
Branch-local redo when available.

## State-reading discipline

`pitch_project_state` is intentionally compact. It provides handles and geometry but not every large object payload or asset byte.

When a task requires deep chart/table/text/vector contents, use the narrow scoped-read capability available in the current Pitch toolset rather than requesting the full deck or files.

## Commands staged in the codebase but not yet in the live MCP schema

Do **not** call these until they appear in `pitch_editor_command` or a dedicated tool:
- custom vector insertion (Pen/Pencil backend builder exists)
- chart data editing
- table structural editing
- image crop/fit commands
- motion timeline editing
- component instance operations

The implementation may exist in packages before transport integration. Treat the live tool schema as authoritative.
