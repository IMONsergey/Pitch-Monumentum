# Vector Engine v1

## Status

Implemented on `feat/editor-e2-pro-core` as the canonical vector subsystem for Pitch Monumentum.

This document defines the contract. New vector work must extend this system rather than introducing a second SVG/canvas model.

## Product goal

Pitch vectors must behave like first-class design objects:

- draw manually with Pen or Pencil;
- remain editable after creation;
- edit anchors and Bezier handles directly on canvas;
- add/remove anchors without replacing the object;
- preserve stable object identity and version history;
- be editable by Codex through bounded tools;
- import common SVG geometry as editable paths rather than bitmap images;
- export as vector to PowerPoint and map cleanly to Figma VectorNode payloads;
- share the same Paint / Stroke / Effects model as the rest of Pitch.

A vector is never canonically represented only by a bitmap or opaque SVG string.

---

## Canonical architecture

```text
Pen / Pencil / SVG Import / Codex
              │
              ▼
      @pitch/vector-path
              │
              ▼
ShapeElement(shape="custom")
        pathData = M/L/Q/C/Z
              │
              ├───────────────┐
              ▼               ▼
       Browser SVG       VectorExchange
              │               │
              ▼               ├── Figma payload
      Node / handle UI         └── portable SVG
              │
              ▼
      EditorCommandService
              │
              ▼
        DeckMutation
        updateVectorPath
              │
              ▼
 ArtifactStore / Version DAG / QA
              │
              ▼
  PPTX vector SVG + stable pitch:id
```

## Ownership boundaries

### `packages/vector-path`
Owns geometry and serialization.

No DOM, PowerPoint, Figma, Codex, or freehand implementation belongs here.

Capabilities:

- validation;
- SVG path parsing;
- SVG path serialization;
- exact quadratic/cubic Bezier bounds;
- anchor and handle enumeration;
- move anchor;
- move handle;
- translate/normalize;
- nearest-segment hit testing;
- exact segment splitting with De Casteljau;
- anchor deletion;
- rotation-aware fit/rebase after intrinsic bounds change.

### `packages/vector-engine`
Producer layer.

- Pen builder;
- Pencil / `perfect-freehand` builder.

`perfect-freehand` is replaceable. It is not the canonical vector model.

### `DeckDocument`
Canonical vector document state.

```ts
ShapeElement {
  type: "shape";
  shape: "custom";
  pathData: VectorPathData;
  svgPath?: string; // compatibility derivative / legacy fallback
  geometry: Geometry;
  fillPaint?: Paint;
  fill?: string;
  stroke?: StrokeStyle;
  effects?: VisualEffect[];
}
```

`pathData` takes precedence for structured vectors.

`svgPath` remains supported so older/imported vectors can still render/export without forced destructive conversion.

---

## Path data

Editable Vector Engine v1 commands:

- `M` — move;
- `L` — line;
- `Q` — quadratic Bezier;
- `C` — cubic Bezier;
- `Z` — close.

Fill rules:

- `nonzero`;
- `evenodd`.

### SVG parser

Canonical parser normalizes:

- `M/m`;
- `L/l`;
- `H/h`;
- `V/v`;
- `C/c`;
- `S/s`;
- `Q/q`;
- `T/t`;
- `Z/z`.

`A/a` elliptical arc commands are deliberately not guessed in v1. An unsupported arc is rejected/skipped with a clear warning instead of being silently approximated.

---

## Geometry quality

### Exact curve bounds

Bounds are based on quadratic/cubic derivative extrema, not merely anchor/control point bounds.

This matters for:

- correct selection boxes;
- fit-bounds editing;
- SVG viewBox;
- import layout;
- vector export.

### Segment split

Splitting `Q`/`C` segments uses De Casteljau subdivision.

The curve before and after insertion is mathematically identical.

### Fit bounds

When an edited anchor extends outside the old intrinsic path bounds:

1. the path is normalized back to local origin;
2. scene geometry expands/moves;
3. unchanged vector points retain their world-space positions;
4. stable element ID remains unchanged;
5. if the vector is inside Auto Layout, existing layout reflow runs in the same editor transaction.

The fitting routine supports rotated vectors. It rebases intrinsic center deltas through the element rotation matrix before calculating new scene geometry.

---

## Editor UX

### Pen

- toolbar `Pen`;
- keyboard `P`;
- click anchors;
- click first anchor to close;
- `Enter` completes open path;
- `Esc` cancels.

### Pencil

- toolbar `Pencil`;
- keyboard `N`;
- freehand points / pressure samples;
- `perfect-freehand` generates outline;
- outline is converted immediately to canonical `Q` path commands.

### Select

- keyboard `V`.

### Node Mode

Enter with:

- double-click custom structured vector; or
- select one vector and press `Enter`.

Supports:

- visible anchors;
- visible in/out Bezier handles;
- drag anchor;
- drag handle;
- `Delete` / `Backspace` selected anchor;
- double-click path segment to insert an exact new anchor;
- rotated vector editing;
- `Esc` exits.

During pointer movement only a local preview changes.

On pointer-up exactly one `setVectorPath` editor command is committed.

One physical vector gesture = one project version.

---

## Transactions and identity

The canonical mutation is:

```text
updateVectorPath
```

It:

- accepts only `shape:"custom"`;
- validates `pathData`;
- preserves element ID;
- stores structured `pathData`;
- synchronizes compatibility `svgPath`;
- invalidates visual/readability/export QA.

Node edits do not remove and recreate elements.

That old workaround is deprecated because it breaks parent relationships, stable identity, and clean version history.

---

## Codex

Strict tool:

```text
pitch_edit_vector
```

Allowed operations:

- `moveAnchor`;
- `moveHandle`;
- `deleteAnchor`;
- `splitSegment`.

The tool cannot submit arbitrary SVG or rewrite unrelated slide objects.

It performs geometry through `@pitch/vector-path`, then routes the result through the same `EditorCommandService.setVectorPath` used by human Node Mode.

Therefore human and Codex vector edits share:

- fit-bounds behavior;
- Auto Layout reflow;
- optimistic deck hash;
- ArtifactStore versions;
- QA invalidation;
- stable scene identity.

---

## SVG import

`packages/svg-import` imports supported SVG geometry into editable Pitch vectors.

Supported geometry:

- `path`;
- `rect` / rounded rect;
- `circle`;
- `ellipse`;
- `polygon`;
- `polyline`;
- `line`.

Supported common styling:

- SVG default black fill;
- none/solid fill;
- basic linear gradients;
- fill opacity;
- `evenodd`;
- solid stroke;
- basic dashed stroke.

Import behavior:

- preserves source layout from `viewBox`;
- imports all supported paths in one project version;
- imported objects have `origin:"import"`;
- current slide is restored after import;
- imported vector layers are multi-selected.

### Explicit import boundaries

Vector Engine v1 does not silently flatten:

- group transforms;
- clip paths;
- masks;
- unsupported element transforms;
- elliptical arc commands.

When safe editable import is impossible, Pitch warns/refuses rather than corrupting geometry.

---

## VectorExchange

`packages/vector-exchange` defines a portable vector DTO independent of editor UI/runtime:

```text
VectorExchangeV1
├── pathData
├── dimensions
├── Paint
├── Stroke
├── Effects
└── stable metadata
```

Uses:

- inter-project clipboard;
- future external share/import;
- standalone SVG;
- Figma bridge;
- test fixtures.

It intentionally contains no:

- DOM state;
- Moveable state;
- selection state;
- browser implementation fields.

---

## Figma bridge

`packages/figma-vector` converts structured Pitch vectors into a Figma-ready payload:

```text
vectorPaths[]
  windingRule: NONZERO | EVENODD
  data: SVG path data
```

Paint/stroke/effects remain separate properties.

The adapter deliberately refuses legacy-only opaque SVG vectors instead of guessing an editable Figma mapping.

The E3 Figma plugin should consume this payload to create native `VectorNode` objects.

---

## PowerPoint

Structured and legacy custom shapes export as SVG vector media.

For structured vectors:

- `pathData` is source of truth;
- intrinsic path bounds become SVG `viewBox`;
- scene geometry controls on-slide size;
- `preserveAspectRatio="none"` matches Pitch geometry scaling;
- solid fill is preserved;
- linear gradient and stop opacity are embedded in SVG media;
- stroke/dash preserved;
- outer `pitch:id:<stable-id>` metadata is injected by PPTX Identity pass.

The vector remains vector, not raster.

### Current PPTX fidelity boundary

Pitch drop-shadow/effects on custom SVG vector media are not yet treated as production-safe across PowerPoint/Keynote SVG rendering. Export preflight reports this as a fidelity warning.

This limitation is explicit; paint is already preserved.

---

## Tests / acceptance authored for v1

Unit/domain coverage includes:

- Pen/Pencil structured output;
- path validation;
- relative/shorthand SVG parsing;
- exact cubic extrema;
- anchor/handle editing;
- anchor deletion;
- nearest segment hit testing;
- exact De Casteljau split;
- unrotated fit-bounds;
- rotated fit-bounds;
- arbitrary-angle fit-bounds;
- SVG import primitives/gradient/evenodd;
- SVG unsafe transform/mask rejection;
- VectorExchange round-trip;
- Figma payload;
- PPTX vector media;
- PPTX vector gradient;
- PPTX stable identity;
- Codex vector provenance.

Browser acceptance authored:

```text
Pen
→ create structured vector
→ double-click
→ Node Mode
→ physical anchor drag
→ canonical pathData changes
→ geometry fits
→ stable ID remains
```

### CI note

The E2 branch is deliberately not advertised as CI-green until GitHub Actions actually executes it. The current hosted runner blockage is outside the vector module and has prevented closed E2 feature branch checks from running.

---

## Non-goals of v1

These are intentionally deferred rather than implemented as low-quality approximations:

### Boolean operations

- Union;
- Subtract;
- Intersect;
- Exclude;
- Divide/compound-path operations.

These belong to **Vector Engine v2** and should use a robust Bezier boolean solver behind a replaceable adapter. Do not write naive polygon-only boolean code into the canonical model.

### Full SVG specification

Deferred:

- arbitrary transform stacks;
- clipping/masking authoring;
- filters;
- patterns;
- arc-native editable command;
- text-on-path.

### Advanced point types

Future v2/v1.1:

- smooth/symmetric handle constraints;
- corner ↔ smooth point conversion;
- multi-anchor marquee selection;
- keyboard nudge for points;
- snapping nodes to guides/other vector anchors.

---

## Definition of done for Vector Engine v1

The module is architecturally complete when:

1. structured vectors are canonical;
2. Pen/Pencil create them;
3. SVG import creates them;
4. Node Mode edits them without changing IDs;
5. rotated vector nodes are editable;
6. Codex uses the same path command/runtime;
7. vector export remains vector;
8. gradient paint survives PPTX SVG export;
9. Figma mapping is deterministic;
10. v1 limitations are explicit rather than silently approximated.

This is the foundation for Vector Engine v2, not a disposable editor experiment.
