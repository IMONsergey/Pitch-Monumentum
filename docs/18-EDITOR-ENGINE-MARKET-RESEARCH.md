# Editor Engine Market Research — Pitch Monumentum

Date: 2026-08-08

## Executive conclusion

Pitch Monumentum should **not** adopt a ready-made editor SDK as its core.

The editor itself is part of the product moat: it must be equally usable by a human and by Codex, preserve semantic object identity, expose deterministic mutations, round-trip to PPTX, map cleanly to Figma nodes, and support a branch/version DAG. Existing all-in-one SDKs either introduce licensing/competitive restrictions or make their own scene/document schema the center of the product.

The recommended foundation is a **Pitch-owned DOM/SVG editor engine** with a permissive interaction stack:

- `daybrush/moveable` — transform handles, resize, rotate, scale, warp, clip, group, snap
- `daybrush/selecto` — marquee and multi-selection
- `daybrush/guides` + `daybrush/ruler` — rulers, guides, grid
- `daybrush/infinite-viewer` — pan/zoom/workspace viewport
- `daybrush/gesto` + `daybrush/keycon` — pointer/gesture/keyboard utilities where useful
- `daybrush/scenejs` — animation runtime; timeline later
- `facebook/lexical` — rich text editing adapter
- `react/yoga` — Auto Layout / flex-like layout engine
- `paperjs/paper.js` and/or owned SVG geometry — vector paths/boolean/path editing
- `steveruizok/perfect-freehand` — pencil/highlighter/freehand
- `yjs/yjs` — later collaboration/presence layer

The canonical document remains **PitchOS `DeckDocument` / `SceneGraph`**. Every third-party library is an adapter around it, never the source of truth.

---

## 1. Product benchmark: what “better than Gamma/Pitch” now means

### Keynote
Benchmark for:
- direct manipulation quality
- beautiful default typography/layout
- shapes, images, charts, tables, media
- animation and presenter workflows
- extremely low-friction manual authoring

### Figma Slides
The strongest UX reference for our editor modes. Figma explicitly separates:
- **Slides mode** — simple presentation interface
- **Design mode** — Auto Layout, layers, advanced properties and detailed design control

Pitch should use the same principle, but add a third intelligence layer rather than a third separate editor:
- **Slides** — fast and simple
- **Design** — professional controls
- **Ask Pitch / Codex** — available contextually in both modes

### Pitch (2026)
Pitch Agent already supports:
- prompt + files + template → deck
- block selection / quick actions
- editable generated slides
- branded templates
- AI image generation/editing

Therefore these are table stakes, not moat.

### Gamma (2026)
Gamma now supports agent-based creation/editing, AI images, manual editing and PPTX export. Its own help center still documents export differences between editor/present mode and PowerPoint output. Our opportunity is a stronger professional editor and native-first export fidelity.

---

## 2. All-in-one editor SDKs

### Polotno
**Technical fit:** high for a Canva-style editor.

Strengths:
- mature canvas/editor UX
- templates
- text/image/video
- programmatic automation
- AI hooks
- rendering/export

Fatal issue for Pitch:
- current license explicitly prohibits using the SDK to build or assist a competing editor, SDK or design platform.

**Decision:** reject as foundation; use only as product/UX reference.

### IMG.LY Creative Editor SDK (CE.SDK)
**Technical fit:** extremely high.

Strengths:
- production design/photo/video editor
- vector paths
- timeline/video
- AI plugins including image/video generation and background removal
- programmable engine
- broad platform coverage

Problems:
- commercial SDK/license dependency
- editor/rendering engine remains vendor-owned
- strategic lock-in on the exact layer that should differentiate Pitch

**Decision:** reference and benchmark. Do not make it the core unless strategy changes from “own the editor” to “ship fastest at any cost”.

### tldraw SDK
**Technical fit:** high for whiteboard/infinite-canvas interaction, lower for slide typography/export.

Problems:
- current production use requires a license key/commercial or other qualifying license
- its store/shape system would become another major document abstraction

**Decision:** reference. Do not use as core.

### ONLYOFFICE
**Technical fit:** strongest Office-editor compatibility reference.

Problems:
- Community edition AGPLv3
- architecture optimizes for Office compatibility, not AI-native semantic authoring
- far too much Office-suite surface for our product

**Decision:** compatibility reference only.

### PPTist
**Technical fit:** excellent presentation editor reference.

Problems:
- current main project AGPL-3.0 unless separately commercially licensed
- would make us inherit another slide document model

**Decision:** use for UX/feature research; do not copy into proprietary core without explicit commercial licensing.

### LidoJS
**Technical fit:** high as a Canva-like editor reference.

Public repository advertises layers, masks, frames, shapes, painting, presentation use and export. However a clear repository license was not found during this audit.

**Decision:** reference only until license is unambiguous.

---

## 3. Open editor references worth mining

### `salgum1114/react-design-editor` — MIT
Useful because it already implements many PowerPoint-like details:
- drag/resize/reorder/copy/paste
- group/ungroup
- crop and filters
- rulers and guides
- alignment and equal-spacing helpers
- grid snapping
- context menus
- animation/video
- SVG/charts
- undo/redo

It is Fabric-based, so we should not inherit the full architecture, but it is a very good feature checklist and source of isolated implementation patterns.

### Graphite — Apache 2.0
A sophisticated vector/raster engine with nondestructive editing and a node-graph core.

Best use for Pitch:
- study path tooling, boolean/vector algorithms, non-destructive effects and future graphics architecture
- potentially compile selected Rust/WASM modules later

Do not import Graphite as the whole slide editor; its scope and architecture are much broader than presentation authoring.

### Penpot — MPL 2.0
A complete professional design editor and valuable reference for:
- layout systems
- component architecture
- collaboration
- vector UX
- design system concepts

Not recommended as the Pitch core because of stack/scale and file-level copyleft obligations.

### Excalidraw
Excellent UX reference for:
- fast selection
- keyboard interaction
- freehand
- collaboration
- simple shape manipulation

Use patterns selectively, not as the presentation document model.

---

## 4. Core rendering decision: DOM/SVG over canvas-first

### Why not Fabric/Konva as the primary renderer

Fabric and Konva are both mature MIT canvas libraries and are valid choices for many design products. For Pitch, however, a canvas-first canonical editing surface creates extra work in the hardest areas:
- rich text caret/selection usually needs DOM overlays
- accessibility and native browser text behavior are weaker
- exact text metrics become more bespoke
- mapping back to editable PPTX/Figma nodes becomes a second translation layer
- semantic object inspection by Codex becomes separated from rendered DOM

### Why DOM/SVG is a better fit

Pitch slides are primarily:
- text
- vector geometry
- images
- tables
- charts
- diagrams

All of these map naturally to DOM/SVG while keeping:
- native text editing
- stable object DOM identifiers
- accessible structure
- direct screenshot/print rendering
- clean Figma/PPTX exporters
- CSS-like visual styling

The scene object remains a `SceneElement`; DOM/SVG is only its renderer.

### Where Pixi/WebGL belongs

Use PixiJS or a dedicated WebGL layer only for:
- particles
- blur/effects that are expensive in DOM/SVG
- advanced live image/video processing
- rich motion effects

Such elements must still be represented by a canonical Pitch scene object, with an explicit export fallback.

---

## 5. Recommended open-source stack

### Interaction

#### Moveable — MIT
Use for:
- drag
- resize
- rotate
- scale
- warp
- clipping
- border radius handles
- grouped transforms
- snapping
- custom interaction handles (“ables”)

#### Selecto — MIT
Use for:
- marquee selection
- modifier-based multi-select
- selection sets

#### Guides/Ruler — MIT
Use for:
- rulers
- draggable guides
- grid display

#### InfiniteViewer — MIT
Use for:
- pan
- zoom
- workspace navigation

### Text

#### Lexical — MIT
Use as the text-editing runtime for a selected text box.

Pitch remains canonical:
`TextParagraph[] / TextRun[]`

Adapter flow:
`Pitch Text → Lexical state → editing → Pitch Text patch`

This avoids persisting opaque editor HTML as the slide format.

### Auto Layout

#### Yoga — MIT
Use as a deterministic flexbox-like layout engine for Pitch Frames.

Add new scene concepts:
- `frame`
- `layoutMode: free | horizontal | vertical | grid`
- `padding`
- `gap`
- `align`
- `justify`
- `sizing: fixed | hug | fill`

This is our answer to Figma Auto Layout and is especially important for Codex: AI can manipulate layout constraints instead of constantly emitting fragile absolute coordinates.

### Vector editing

#### Paper.js — MIT
Candidate for:
- path hit-testing
- curves
- boolean operations
- path manipulation

Long-term alternative/complement:
- owned SVG geometry utilities
- selected Graphite algorithms/WASM where appropriate

### Freehand

#### perfect-freehand — MIT
Use for:
- pen
- highlighter
- pressure-sensitive freehand strokes

### Motion

#### Scene.js — MIT
Use for:
- property animation
- keyframes
- scene playback

A Pitch-specific timeline model should remain canonical and compile into Scene.js for browser playback, PPTX transitions/animations where supported, Keynote where supported, and video render paths later.

### Collaboration

#### Yjs — MIT
Use later for:
- live text/object collaboration
- presence/cursors
- concurrent operations

Do not replace the ArtifactStore/Version DAG with CRDT state. CRDT is the live collaboration layer; accepted snapshots become normal Pitch artifacts.

---

## 6. Missing-capability repository shortlist

### Editor / interaction
- daybrush/moveable
- daybrush/selecto
- daybrush/guides
- daybrush/ruler
- daybrush/infinite-viewer
- daybrush/gesto
- daybrush/keycon
- daybrush/scena (reference integration)
- salgu m1114/react-design-editor (feature reference)
- GraphiteEditor/Graphite (vector/graphics reference)
- SVG-Edit/svgedit (vector editing reference)

### Text / typography
- facebook/lexical
- foliojs/fontkit — inspect for font metrics/subsetting/export
- opentypejs/opentype.js — inspect for font parsing/metrics

### Layout / diagrams
- react/yoga
- kieler/elkjs — graph/diagram automatic layout
- mermaid-js/mermaid — semantic diagram grammar/reference

### Vector / drawing
- paperjs/paper.js
- svgdotjs/svg.js
- steveruizok/perfect-freehand

### Collaboration
- yjs/yjs

### Assets
- iconify/iconify + iconify/icon-sets
- lucide-icons/lucide
- Figma official plugin-samples for exporter/plugin architecture

### PDF/source ingestion
- mozilla/pdf.js — deterministic browser/Node PDF parsing/rendering baseline
- docling-project/docling / opendatalab/MinerU — deeper document understanding pipeline candidates already tracked elsewhere

### Visual QA
- microsoft/playwright — canonical browser screenshots/interactions
- mapbox/pixelmatch — perceptual regression primitives

### Image/raster processing
- lovell/sharp — server/local raster transforms
- resvg/resvg-js — deterministic SVG rasterization/reference

---

## 7. What we should own

Pitch must own these layers permanently:

1. `DeckDocument` / `SceneGraph`
2. selection semantics and mutation contracts
3. layout/frame semantics
4. object identity and provenance
5. ArtifactStore and Version DAG
6. AI edit scope/security model
7. slide/story/evidence semantics
8. exporter contracts
9. QA/evals
10. product editor UX

Third-party libraries may execute transformations, render or assist interaction, but they must be replaceable.

---

## 8. Immediate technical spike

Build `@pitch/editor-engine` with adapters:

```text
EditorEngine
├── SceneRenderer          DOM/SVG
├── InteractionAdapter     Moveable
├── SelectionAdapter       Selecto
├── GuideAdapter           Guides/Ruler
├── ViewportAdapter        InfiniteViewer
├── TextEditorAdapter      Lexical
├── LayoutAdapter          Yoga
├── VectorAdapter          Paper.js
├── FreehandAdapter        perfect-freehand
└── MotionAdapter          Scene.js
```

No adapter owns persistence.

Interaction lifecycle:

```text
pointer move/resize/rotate
        ↓
optimistic preview transform
        ↓
interaction end
        ↓
Pitch DeckMutation
        ↓
ArtifactStore version
        ↓
QA invalidation
        ↓
canonical rerender
```

Codex uses exactly the same `DeckMutation` path.

That symmetry — human action and AI action committing through the same domain API — is the core editor architecture.