# Pitch Pro Editor command map

Use this reference after reading `pitch_project_state`.

## Canonical object commands — `pitch_editor_command`

### nudge
Required: `slideId`, `selectedIds`, `dx`, `dy`.
Use for exact keyboard-like movement.

### align
Required: `slideId`, `selectedIds`, `alignment`.
Values: `left`, `horizontalCenter`, `right`, `top`, `verticalCenter`, `bottom`.

### distribute
Required: `slideId`, `selectedIds`, `axis`.
Axis: `horizontal` or `vertical`. Use for 3+ selected root objects.

### duplicate / delete / group / ungroup / arrange / lock
Operate only on selected roots and canonical hierarchy. `arrange` accepts `bringToFront`, `bringForward`, `sendBackward`, `sendToBack`.
Never silently unlock an object.

### setInspector
Required: `slideId`, `elementId`.
May atomically include geometry, presentation and text-style patches. Prefer this for exact X/Y/W/H/rotation/opacity/type values.

### insertText / insertShape / insertFrame
Create basic editable native scene objects. Use the returned selection IDs rather than guessing generated IDs.

## Storyboard commands — `pitch_editor_command`

### newSlide
Optional: `afterSlideId`, `title`. Returns `nextSlideId`.

### duplicateSlide
Required: `slideId`. Deep-clones scene hierarchy with new IDs. Claims/evidence/assets remain linked; QA issue IDs do not carry over.

### deleteSlide
Required: `slideId`. Fails if this would remove the last slide.

### moveSlide
Required: `slideId`, zero-based `toIndex`.

### renameSlide
Required: `slideId`, non-empty `title`.

## Image/media — `pitch_media_command`

Use this tool instead of raw image-object edits.

### setImageFit
Required: `slideId`, `elementId`, `fit`.
Fit values: `cover`, `contain`, `stretch`.

### setImageCrop
Required: `slideId`, `elementId`, `crop`.
Crop uses normalized `left`, `top`, `right`, `bottom` values from 0 to <1. Opposing sides must leave visible width/height. Pass `null` to reset crop.

### replaceImageAsset
Required: `slideId`, `elementId`, `assetId`. Optional `alt`.
Preserves the image object, geometry, dependencies and editability.

### setImageCornerRadius
Required: `slideId`, `elementId`, `cornerRadiusDU`.
Use `null` to remove the explicit radius.

The visual editor may batch fit/crop/asset/radius into one canonical version; MCP currently exposes the bounded media commands above.

## Motion — `pitch_motion_command`

Motion lives in a branch-local `MotionDocument`, not in transient DOM/CSS. Read `motion`, `motionHash` and `motionHistory` from `pitch_project_state` first.

### setSlideTransition
Required: `slideId`, `transition`.
Transition types: `none`, `fade`, `push`, `wipe`, `dissolve`. Pass `null` to remove the transition.

### addBuild
Required: `slideId`, `elementIds`, `kind`, `effect`, `trigger`, `durationMs`.
Kinds: `entrance`, `emphasis`, `exit`.
Effects: `appear`, `fade`, `scale`, `slide`, `wipe`, `pulse`.
Triggers: `onClick`, `withPrevious`, `afterPrevious`.
Optional: delay/direction/distance/easing/buildId.

### updateBuild / deleteBuild / reorderBuild
Use stable `buildId` handles from current motion state. `toIndex` is zero-based.

### setTrack
Required: `slideId`, `elementId`, `property`, `keyframes`.
Properties: `x`, `y`, `width`, `height`, `rotation`, `opacity`, `scaleX`, `scaleY`.
Each keyframe has `timeMs`, `value`, optional easing.

### deleteTrack
Required: `slideId`, `trackId`.

### clearSlideMotion
Required: `slideId`. Clears that slide's transition/builds/tracks only.

### pitch_motion_undo / pitch_motion_redo
Motion history is intentionally independent from deck history. Use these for animation mistakes; do not call `pitch_undo` unless the deck itself should change.

## Components — `pitch_component_command`

Component definitions are branch-aware artifacts, not pasted UI templates.

### createFromSelection
Required: `slideId`, `selectedIds`, `name`.
Optional: `componentId`, `description`.
The authoring layer closes selected frame/group descendants, localizes geometry and detects text/image/fill/stroke slots.

### insert
Required: `slideId`, `componentId`, `transform` (`x`, `y`, optional scaleX/scaleY).
Optional: `overrides`, `instanceId`.
Returns the created instance and selection IDs. Re-read state because instance element IDs are new.

### detach
Required: `slideId`, `instanceId`.
Removes component linkage tags but keeps the instantiated scene objects editable.

## Deck history

### pitch_undo / pitch_redo
Branch-local history for canonical deck versions. Use immediately after an unintended deck mutation rather than reverse-math edits.

## State-reading discipline

`pitch_project_state` is intentionally compact for deck objects, while returning canonical motion state and reusable component summaries. Re-read after operations that change IDs, hierarchy, slide order, component instances or history heads.

When a task needs deep text/chart/table/vector data, use the narrow scoped-read capabilities in the active Pitch toolset rather than asking for raw project files.

## Implemented below the transport but not yet in this MCP schema

Do **not** invent these tool calls:
- custom vector insertion through `pitch_editor_command` (Pen/Pencil engine exists in the editor);
- chart data editing through this MCP tool family;
- table structural editing through this MCP tool family;
- the visual editor's atomic multi-property image batch command.

Treat the live MCP schema as authoritative even when a lower-level package already exists.
