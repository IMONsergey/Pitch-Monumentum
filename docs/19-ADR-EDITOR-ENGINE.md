# ADR-019 — Pitch Editor Engine

**Status:** Proposed for implementation

**Date:** 2026-08-08

## Decision

Build and own a first-class `Pitch Editor Engine` rather than embedding an all-in-one commercial/editor SDK.

The canonical slide renderer will be **DOM/SVG hybrid**, driven directly from PitchOS `DeckDocument` / `SceneGraph`.

The initial interaction stack will use MIT-licensed Daybrush primitives behind adapters:

- Moveable
- Selecto
- Guides/Ruler
- InfiniteViewer

Supporting adapters:

- Lexical for rich text editing
- Yoga for constrained/auto layout
- Paper.js / owned SVG geometry for vector paths
- perfect-freehand for drawing
- Scene.js for animation playback
- Yjs later for live collaboration

## Why this decision

### 1. The editor is part of the moat

Pitch Monumentum is intended to be better than a generic AI deck generator. A professional manual editor plus deterministic AI manipulation is a core product capability, not commodity infrastructure.

### 2. Human and Codex edits need one mutation path

The product already has:
- stable scene IDs
- scoped DeckMutation operations
- optimistic hash checks
- versioned artifacts
- QA invalidation
- branch DAG

A human drag and a Codex instruction must both end as the same domain mutation.

### 3. DOM/SVG fits professional presentation content

Presentation scenes are dominated by editable text, vectors, images, charts and tables. DOM/SVG preserves browser text behavior and maps cleanly to PPTX and Figma native objects.

### 4. Avoid a second canonical scene model

Fabric/Konva/tldraw/Polotno-style stores are useful, but allowing them to become canonical would force Pitch to synchronize two document models forever.

### 5. Licensing/control

- Daybrush interaction packages are MIT.
- Lexical/Yoga/Yjs/Paper.js/perfect-freehand are permissive candidates.
- Polotno currently forbids use to build/assist competing editors.
- tldraw production requires licensing.
- PPTist/ONLYOFFICE have copyleft constraints for the relevant current distributions.

## Architecture

```text
DeckDocument / SceneGraph
          │
          ├─────────────── Codex DeckMutation
          │
          ▼
  Editor Transaction API
          ▲
          │
   Manual interactions
          │
┌─────────┴──────────────────────────────────────┐
│                  Editor Engine                 │
│                                               │
│ DOM/SVG Renderer                              │
│ Moveable     → transform preview              │
│ Selecto      → selection sets                 │
│ Guides       → guide/grid/snap UI             │
│ InfiniteView → viewport                       │
│ Lexical      → active text editing            │
│ Yoga         → constrained frame layout       │
│ Paper/SVG    → vector geometry                │
│ Scene.js     → animation preview              │
└───────────────────────────────────────────────┘
```

## Editor modes

### Slides mode
Optimized for speed and presentation work:
- slide thumbnails/storyboard
- insert text/image/chart/table/shape
- simple alignment and arrange
- layout suggestions
- speaker notes
- Ask Pitch contextual actions

### Design mode
Professional controls:
- layers
- nested frames/groups
- rulers/guides/grid
- coordinates/dimensions/rotation
- Auto Layout
- fills/strokes/effects
- advanced text
- vector/path editing
- masks/clips
- image adjustments
- animation timeline
- export diagnostics

The two modes operate on the same objects. They are UI complexity modes, not two data models.

## Scene model extensions required

Add/strengthen:

### Frame
```ts
interface FrameElement extends SceneElementBase {
  type: 'frame';
  childIds: string[];
  clipContent: boolean;
  layout?: LayoutSpec;
}
```

### LayoutSpec
```ts
type LayoutMode = 'free' | 'horizontal' | 'vertical' | 'grid';
interface LayoutSpec {
  mode: LayoutMode;
  padding: { top:number; right:number; bottom:number; left:number };
  gap: number;
  align: 'start'|'center'|'end'|'stretch';
  justify: 'start'|'center'|'end'|'space-between';
  wrap?: boolean;
}
```

### Sizing
Each child may specify:
- fixed
- hug
- fill

### Effects
Use a typed, export-aware effect list instead of arbitrary CSS.

### Animation
Canonical Pitch keyframes independent of browser/PPTX/Keynote runtimes.

## Interaction transaction contract

Continuous pointer movement must not create hundreds of artifact versions.

1. `interaction:start`
2. update ephemeral preview geometry
3. snap/guides resolve continuously
4. `interaction:commit`
5. emit one `DeckMutation`
6. ArtifactStore writes one version
7. affected QA lanes become stale
8. canonical render replaces preview

Cancel returns to the pre-interaction state with no artifact version.

## Selection semantics

Selection is a domain object, not only DOM focus:

```ts
interface EditorSelection {
  slideId: string;
  elementIds: string[];
  primaryElementId?: string;
  textRange?: TextRange;
  vectorPointIds?: string[];
  mode: 'element'|'text'|'vector'|'table'|'chart';
}
```

This object is also the default Codex edit scope.

## Snapping

Snap candidates:
- slide edges/center
- sibling edges/centers
- selected group bounds
- explicit guides
- grid
- layout-frame rules
- spacing/equal-distance guides

The snap engine returns both geometry corrections and UI guide descriptors.

## Rich text model

Lexical is an editor runtime, not persistence.

On edit start:
`Pitch TextParagraph/TextRun → Lexical state`

On commit:
`Lexical state → normalized Pitch TextParagraph/TextRun → DeckMutation`

This keeps PPTX/Figma export deterministic.

## Auto Layout

Yoga should execute layout constraints, but the Pitch `LayoutSpec` remains canonical.

Codex can therefore issue semantic changes such as:
- “turn these cards into a 3-column grid”
- “make this row hug content”
- “increase the spacing between these metrics”

without manually rewriting every absolute coordinate.

## Vector architecture

Basic slide shapes remain typed Pitch primitives for clean PPTX mapping.

Advanced vectors use:
- SVG path representation
- node/handle metadata in editing mode
- Paper.js/geometry adapter for boolean/path operations

When a vector cannot map to a PowerPoint native shape, export as SVG/vector, not raster by default.

## Animation architecture

Pitch animation data is canonical. Scene.js is the browser preview runtime.

Animation compiler targets:
- browser/Scene.js
- PowerPoint animation subset
- Keynote subset after macOS adapter validation
- video render later

Unsupported target behavior must be reported in the export manifest.

## Collaboration

Do not introduce Yjs into the canonical artifact model yet.

Future model:
- branch has a live collaborative session
- object/text edits sync through Yjs
- accepted/idle snapshots compact into normal artifact versions
- Version DAG remains durable project history

## Consequences

### Positive
- strategic ownership
- no competing-editor license restriction
- precise AI scope
- easiest route to Figma/PPTX native exports
- rich manual editing remains first-class
- third-party pieces remain replaceable

### Negative
- more engineering than embedding Polotno/CE.SDK
- we own selection edge cases, text fidelity, snapping, masks, performance and input handling
- requires serious editor QA and performance work

These costs are justified because they directly create product differentiation.

## Rejected alternatives

### Polotno as editor core
Rejected: license prohibits competing editor/design platform use.

### tldraw as editor core
Rejected: production license dependency and whiteboard-first model.

### Fabric.js as editor core
Rejected: useful canvas engine but rich text/export/semantic synchronization would become a permanent extra layer.

### Konva as editor core
Same fundamental issue as Fabric; better suited to lower-level interactive canvas products.

### PixiJS as editor core
Excellent rendering performance, wrong default abstraction for text-heavy editable presentations. Keep optional for rich effects.

### PPTist fork
Rejected for core: current AGPL/commercial licensing plus duplicate document model. Continue studying UX/import/export solutions.

### ONLYOFFICE fork
Rejected: office-suite architecture and AGPL are both poor fits for Pitch’s intended differentiated editor.