# Advanced Media Studio

Status: implemented on stacked PR #6 (`feat/advanced-media-design-system`) on top of the frozen Desktop Preview production-core branch.

## Why this milestone exists

The first Asset Library milestone made image bytes project-native and editable, but media treatment was still mostly Inspector-driven. Advanced Media makes image art direction a first-class canonical editing surface rather than a DOM preview trick.

The core rule is:

```text
Asset bytes
   ↓
ImageElement
   ├─ fit
   ├─ explicit normalized crop
   ├─ normalized focal point
   ├─ clip geometry
   ├─ corner radius
   └─ alt / semantic metadata
   ↓
shared image-layout semantics
   ↓
Editor ⇄ Presenter ⇄ Components ⇄ Codex ⇄ PPTX
```

No crop, focal-point or mask state is allowed to exist only in the browser.

## Canonical image model

`ImageElement` now supports:

- `fit`: `cover | contain | stretch`;
- `crop`: normalized source-space `left/top/right/bottom`;
- `focalPoint`: normalized `{x,y}` source-space point of interest;
- `clipShape`: `rect | roundRect | ellipse`;
- `cornerRadiusDU`;
- stable `assetId`;
- `alt`.

### Explicit crop

Crop is non-destructive and source-relative. Opposing crop edges must always leave visible content.

### Focal point

Focal point is semantic art-direction state, not another crop rectangle. For `cover`, the shared image-layout engine computes the additional crop required to fill the authored frame and positions that window around the focal point as far as source bounds permit.

Examples:

- portrait → focus on face;
- product shot → bias crop to product;
- wide photograph → keep subject on right third.

### Clip geometry

`clipShape` is native picture geometry where possible:

- `rect`;
- `roundRect`;
- `ellipse`.

Legacy images with a positive `cornerRadiusDU` and no explicit clip shape behave as `roundRect`.

## Shared image-layout engine

`packages/image-layout` is the single pure geometry layer for media fitting/export calculations.

It owns:

- crop normalization;
- focal-point clamping inside explicit crop;
- implicit `cover` source crop;
- `contain` visual geometry;
- effective clip shape;
- normalized crop → OOXML percent conversion.

This exists specifically to avoid separate formulas slowly diverging between browser and export code.

## Direct Crop Mode

A selected image can enter Crop Mode by:

- double-clicking the selected image;
- choosing **Edit crop on canvas** in Media Inspector.

Crop Mode provides:

- left/right/top/bottom source-crop handles;
- draggable focal target;
- Cover / Contain / Stretch actions;
- crop readout;
- Reset;
- Done;
- Enter/Escape exit.

During pointer movement only the browser preview changes. Pointer-up produces one canonical media command. This avoids creating hundreds of history versions during a drag.

## Media Inspector

The Inspector exposes the same canonical treatment numerically:

- Asset ID;
- alt text;
- fit;
- clip shape;
- radius;
- focal X/Y;
- crop L/T/R/B;
- direct Crop Mode entry;
- atomic Apply;
- reset crop/focal.

`setImageProperties` remains the preferred transaction for a coherent multi-property change.

## Presenter parity

Editor and Presenter both use the same asset renderer and canonical ImageElement media state. Focal point and clip geometry are not re-authored for presentation mode.

## Component System 2.0 integration

Image slots now preserve the full local media treatment as an instance override:

- asset;
- alt;
- fit;
- crop;
- focal point;
- clip shape;
- corner radius.

Therefore:

1. a master image can change structurally/visually;
2. linked instances receive master changes;
3. locally art-directed image slots keep their crop/focal/mask treatment;
4. `Reset Instance` clears those local media overrides and returns to current master state.

An explicit `null` override can clear a master focal/clip/radius property without detaching the component.

## Codex / MCP parity

`pitch_media_command` supports:

- `setImageProperties`;
- `setImageFit`;
- `setImageCrop`;
- `setImageFocalPoint`;
- `setImageClipShape`;
- `replaceImageAsset`;
- `setImageCornerRadius`.

Project-state object summaries expose fit/crop/focal/clip handles so an agent can inspect current art direction before editing.

MCP version for this milestone is `0.5.0`.

## PowerPoint export

The rich PPTX compiler now receives canonical asset dimensions from the Asset Store and uses the shared image-layout engine.

### Cover

For `cover`, the exporter computes the same focal-aware source crop and writes native `a:srcRect` values.

### Contain

For `contain`, the picture geometry is letterboxed inside the authored Pitch image frame rather than stretched.

### Clip geometry

The exporter writes native PowerPoint picture preset geometry:

- `rect`;
- `roundRect`;
- `ellipse`.

Exact authored `cornerRadiusDU` cannot be mapped 1:1 to PowerPoint's round-rectangle preset geometry, so that remains an explicit minor fidelity approximation rather than being silently claimed as exact.

## Regression coverage

The milestone includes tests for:

- focal validation;
- clip-shape commands;
- atomic advanced-media updates/reset;
- focal-aware cover crop math;
- explicit crop + cover interaction;
- contain geometry;
- focal constraint inside crop;
- legacy radius clip fallback;
- direct browser focal drag;
- direct browser crop-edge drag;
- canonical state after drag/reload;
- ellipse rendering;
- native OOXML focal `srcRect`;
- native OOXML ellipse geometry;
- PowerPoint contain geometry;
- Advanced Media tool schema parity;
- Component image-slot media override preservation;
- Component Reset restoring current master media treatment.

## Explicit non-goals / next media work

Not part of this milestone yet:

- arbitrary vector-path image masks;
- destructive bitmap crop;
- background-removal service adapter;
- generative-image service adapter and provenance UI;
- blend modes / advanced filters;
- video/audio production timeline;
- full pixel-level cross-render fidelity benchmark.

Those can now build on stable canonical image semantics instead of inventing another media model.
