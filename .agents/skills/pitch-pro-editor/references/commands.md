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
Create basic editable native scene objects. Use returned selection IDs rather than guessing generated IDs.

### insertImage
Required: `slideId`, `assetId`, `geometry`.
Optional: `alt`, `fit`, `name`.
The `assetId` must already exist in the project Asset Library and should be read from `pitch_project_state`. The command creates a normal editable ImageElement with an asset dependency and deck undo/version semantics.

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

### setImageProperties
Required: `slideId`, `elementId`, `changes`.
Atomically updates any supported combination of `fit`, `crop`, `assetId`, `alt`, `cornerRadiusDU` in one deck version. Use this for coherent multi-property image edits.

### setImageFit
Required: `slideId`, `elementId`, `fit`.
Fit values: `cover`, `contain`, `stretch`.

### setImageCrop
Required: `slideId`, `elementId`, `crop`.
Crop uses normalized `left`, `top`, `right`, `bottom` values from 0 to <1. Opposing sides must leave visible width/height. Pass `null` to reset crop.

### replaceImageAsset
Required: `slideId`, `elementId`, `assetId`. Optional `alt`.
Preserves the image object, geometry and editability. The replacement `assetId` must exist in current project state.

### setImageCornerRadius
Required: `slideId`, `elementId`, `cornerRadiusDU`.
Use `null` to remove the explicit radius.

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

Component definitions are branch-aware master artifacts. Linked instances expose stable component/instance/source handles in project state.

### createFromSelection
Required: `slideId`, `selectedIds`, `name`.
Optional: `componentId`, `description`.
The authoring layer closes selected frame/group descendants, localizes geometry, validates the definition and detects text/image/fill/stroke slots.

### insert
Required: `slideId`, `componentId`, `transform` (`x`, `y`, optional scaleX/scaleY).
Optional: `overrides`, `instanceId`.
Returns the created linked instance and selection IDs. The instance is placed above existing slide content while preserving the component's internal z-order. Re-read state because instance element IDs are new.

### updateFromSelection
Required: `slideId`, `selectedIds`, `componentId`.
Optional: `name`, `description`.
Turns the selected object tree into the new version of the existing component master and propagates that master to every linked instance. Existing text/image/fill/stroke instance overrides are preserved. Re-read project state because multiple slides and instance element sets may change.

### refreshInstances
Required: `componentId`.
Rebuilds all linked instances from the current master without changing the master definition. Current transform and supported slot overrides are preserved. Use after suspected drift or when explicitly asked to sync instances.

### resetInstance
Required: `componentId`, `instanceId`.
Rebuilds one linked instance from the current master and clears its local slot overrides. It remains linked.

### detach
Required: `slideId`, `instanceId`.
Removes component linkage/source tags but keeps the instantiated scene objects editable. Detached objects no longer receive master updates.

## Deck history

### pitch_undo / pitch_redo
Branch-local history for canonical deck versions. Use immediately after an unintended deck mutation rather than reverse-math edits.

## State-reading discipline

`pitch_project_state` is intentionally compact for deck objects while returning canonical motion state, project image assets, component masters and `componentInstances`. Re-read after operations that change IDs, hierarchy, slide order, assets, component masters/instances or history heads.

When a task needs deep text/chart/table/vector data, use the narrow scoped-read capabilities in the active Pitch toolset rather than asking for raw project files.

## Implemented below the transport but not yet in this MCP schema

Do **not** invent these tool calls:
- custom vector insertion through `pitch_editor_command` (Pen/Pencil engine exists in the editor);
- chart data editing through this MCP tool family;
- table structural editing through this MCP tool family;
- binary asset upload through MCP (assets are currently imported through the Workspace/Desktop asset path, while existing asset IDs can be inserted/replaced through Codex).

Treat the live MCP schema as authoritative even when a lower-level package already exists.
