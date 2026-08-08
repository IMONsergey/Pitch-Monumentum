---
name: pitch-slide-masters
description: Operate Pitch Monumentum Slide Masters and Smart Layouts. Use when the user asks to create reusable slide layouts, apply or switch layouts without losing content, update a master everywhere, audit master consistency, detach a slide from its layout, or select the best existing layout for current slide content.
---

# Pitch Slide Masters + Smart Layouts

## Core principle

A slide master owns **layout and base visual treatment**. Placeholders own **semantic content**. Unmatched freeform objects remain ordinary editable scene elements unless the user explicitly wants a destructive reset.

Never implement a layout change by deleting the slide and recreating its content manually when a master command can preserve and remap it.

## Required loop

1. Read `pitch_master_state` for the target slide.
2. Inspect `currentMasterId`, available masters, recommendations and master QA.
3. Read current deck hash.
4. Choose one bounded master command.
5. Execute it with the current deck hash.
6. Re-read master state and the affected slides.
7. For `updateMasterFromSlide`, verify every reported affected slide because propagation is intentionally wide-scope.
8. Use ordinary Pitch deck undo if the result is wrong.

There is no separate master undo stack.

## Commands

### createMaster
Use when the current slide should become a reusable layout/master definition.

Required:
- `slideId`;
- `name`.

Optional:
- `masterId`;
- `description`;
- `autoDetectPlaceholders`.

Creating a master definition does not require destroying the source slide.

### applyMaster
Use to apply or switch a slide to one master.

Required:
- `slideId`;
- `masterId`.

Optional:
- `preserveUnmatched` (default preserves freeform content);
- `instanceId`.

The engine maps current semantic content into compatible placeholders, takes geometry/style from the master, preserves unmatched freeform objects, repairs hierarchy and keeps compatible placeholder element IDs stable where possible.

### updateMasterFromSlide
Use only when the current linked slide has intentionally been edited as the new master source.

Required:
- `slideId`;
- `masterId`.

Optional:
- `name`;
- `description`.

This command is intentionally broad: it updates the master definition and refreshes **all linked slides in one ordinary deck version**.

Do not use it for a one-off local slide tweak.

### detachMaster
Use when the current slide should stop receiving layout/master updates but keep all current objects editable.

Required:
- `slideId`.

Detaching removes relationship tags; it does not rasterize or delete objects.

### deleteMaster
Required:
- `masterId`.

Deletion fails closed while any slide still uses the master. Detach or switch those slides first.

## Smart Layout recommendations

`pitch_master_state` can return deterministic recommendations for the target slide.

Score considers:
- compatible placeholder matches;
- required placeholder misses;
- unmatched semantic content.

Prefer a high-scoring existing master when it fits the request instead of inventing a new layout merely because one can be created.

Recommendation is assistance, not a forced choice. Respect explicit user art direction.

## Placeholder semantics

Supported kinds:
- title;
- subtitle;
- body;
- image;
- chart;
- table;
- metric;
- footer;
- other.

Content remapping is semantic/type-aware.

For text placeholders, preserve content but let the master govern:
- geometry;
- base font family;
- size;
- color;
- letter spacing;
- paragraph alignment/spacing;
- vertical alignment;
- insets;
- fit policy.

Preserve explicit inline emphasis such as bold/italic/underline where the content authored it.

For image placeholders, preserve:
- asset ID;
- alt;
- explicit crop;
- focal point.

Let the master govern visual framing treatment such as geometry, fit, clip shape and radius.

## Stable identities

Master/source/placeholder identity is canonical through tags. When switching layouts, compatible placeholders try to keep existing element IDs.

This is important for:
- selection;
- motion references;
- agent handles;
- future comments/collaboration anchors.

Do not invent new placeholder IDs when current state already exposes usable handles.

## Authoring a master

Master-owned objects remain ordinary Pitch scene objects. Edit them with the same Inspector, Moveable, Rich Text, Media, Appearance, Design System and other editor tools.

When those edits should become the reusable layout, run `updateMasterFromSlide`.

A manual edit to one linked slide is not automatically a master update.

## Master QA

Interpret QA deliberately:

Critical/major integrity issues:
- missing master;
- unknown source/placeholder;
- placeholder/source mismatch;
- mixed master IDs inside one instance;
- duplicate source identity;
- invalid master definition;
- missing required placeholder.

Minor drift:
- master-owned geometry differs from current master;
- master-owned base style differs from current master.

Drift is not automatically corruption because it can be an intentional pre-Update-Master edit. Decide whether to **Update Master**, **Reapply**, or leave it local based on user intent.

## Design System interaction

Master elements can carry normal live token bindings. Do not strip them during master creation or propagation.

Design tokens express brand intent; masters express slide-level composition/layout intent. Both remain materialized into ordinary native scene values.

## Components interaction

Components inside a master remain ordinary linked component scene objects. Master propagation should preserve component linkage unless the selected authoring edit explicitly changed/detached it.

Do not flatten components to create a layout.

## Motion interaction

Stable placeholder IDs reduce motion-reference churn. After a layout switch/update, re-read motion state if affected elements were targets of builds/tracks.

Never retarget stale motion to a different placeholder by guesswork.

## Completion

A master/layout edit is complete only when:
- intended slides use the intended master;
- placeholder content survived;
- master-owned layout/style is current;
- hierarchy validates;
- master QA has no critical corruption;
- unmatched freeform content was preserved unless destructive scope was requested;
- standard deck undo can reverse the operation;
- the slide remains manually editable and compatible with Presenter/PPTX.
