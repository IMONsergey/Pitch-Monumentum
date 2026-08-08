# Pitch Editor Engine — Implementation Roadmap

Status: active
Date: 2026-08-08

The target is not a slide template editor. The target is a professional, AI-native visual authoring environment with manual editing quality approaching Keynote/Figma Design while preserving Pitch semantic state and export fidelity.

## E0 — Interaction foundation

**Status: in spike / PR #1**

Deliver:
- DOM/SVG scene renderer remains canonical visual renderer
- Moveable transforms: drag/resize/rotate
- Selecto marquee and shift multi-select
- element and group transforms
- object-to-object and slide snapping
- canvas bounds
- Guides/Ruler
- InfiniteViewer pan/zoom
- ephemeral interaction preview
- one `DeckMutation` per committed gesture
- browser E2E drag acceptance

Exit gate:
- moving/resizing/rotating a real scene object updates the canonical artifact exactly once
- undo/redo/branches still work
- Codex and manual edits use the same mutation format

## E1 — Professional selection and geometry

Deliver:
- selection box
- nested selection / enter group
- lock/hide
- group/ungroup
- align left/center/right/top/middle/bottom
- distribute horizontally/vertically
- equal spacing smart guides
- duplicate while dragging
- keyboard nudging: 1 DU / 10 DU modifier
- direct numeric geometry editing
- transform origin
- flip H/V
- maintain aspect ratio modifier
- smart snapping priority engine
- visible distance measurements
- rulers/grid/guides persistence

Add domain types:
- `EditorSelection`
- `GuideDocument`
- `GroupElement` semantics upgrade
- transform batch mutation helpers

## E2 — Rich text engine

Use Lexical as editing runtime, not persistence.

Deliver:
- double-click text edit
- caret and native selection
- inline formatting
- font family/size/weight/style
- text color/highlight
- underline/strike
- bullets/numbering
- alignment
- line spacing
- paragraph spacing
- text box insets
- vertical alignment
- auto fit / shrink-to-fit / grow-box
- text-on-shape editing
- keyboard shortcuts
- clipboard interoperability
- IME / Cyrillic / mixed-language support

Canonical flow:
`Pitch TextParagraph/TextRun → Lexical → edit → normalized Pitch text → DeckMutation`

Exit gate:
- no Lexical JSON/HTML is required to reconstruct the Pitch document
- export to PPTX and Figma remains deterministic

## E3 — Frames and Auto Layout

Use Pitch-owned `LayoutSpec`, Yoga execution adapter.

Add:
- `FrameElement`
- horizontal/vertical/grid layout
- padding and gap
- alignment/justify
- fixed / hug / fill sizing
- nested frames
- wrapping
- min/max constraints
- detach from layout
- absolute child inside layout frame

AI value:
Codex can issue semantic layout actions rather than fragile coordinate rewrites:
- “make these 4 metrics an equal row”
- “turn the cards into a 2×2 grid”
- “make this frame hug content”

Exit gate:
- manual and Codex layout operations produce the same deterministic geometry
- browser, PPTX and Figma exporters see only the resulting canonical model

## E4 — Shapes, vectors and drawing

Deliver:
- shape library
- line/arrow styles
- editable corner radius
- polygon/star controls
- vector pen tool
- vector node editing
- Bezier handles
- boolean union/subtract/intersect/exclude
- convert shape to vector
- masks / clipping frames
- freehand pen/highlighter via perfect-freehand
- SVG import with editable vector preservation where possible
- icon search/insert

Vector strategy:
- basic presentation shapes stay typed native primitives for clean PPTX export
- advanced vector paths stay SVG/path-based and export as vector fallback when PowerPoint has no native equivalent

## E5 — Images and media

Deliver:
- drag/drop and paste image
- crop / contain / cover
- masks
- replace image preserving geometry
- opacity
- brightness/contrast/saturation
- duotone/tint
- background removal action through Codex/image tooling
- AI generate image from selected frame/placeholder
- AI edit image
- image upscale
- stock/search/import workflows
- video/audio objects

AI UX examples:
- “generate a cinematic factory photo for this frame”
- “remove the background from this object”
- “replace this image but preserve crop and composition”

Every AI asset becomes a normal asset with provenance, prompt metadata and version history.

## E6 — Data, tables and diagrams

Deliver:
- native editable table editing
- rows/columns/merge cells
- table themes
- chart data editor
- CSV/XLSX bind
- chart-type switching
- chart annotations/callouts
- diagrams/process maps
- ELK automatic graph layout
- smart connectors
- Mermaid import/semantic diagram conversion

The existing Data Storytelling layer remains responsible for what a chart is trying to prove.

## E7 — Motion and presentation runtime

Canonical Pitch animation model, Scene.js browser adapter.

Deliver:
- slide transitions
- object entrance/exit/emphasis
- motion path
- keyframes
- timeline
- easing
- duration/delay
- trigger sequencing
- autoplay/self-running decks
- presenter view
- speaker notes
- remote/presenter controls later

Export compilers declare target fidelity:
- browser
- PPTX animation subset
- Keynote subset
- video export later

## E8 — Native export ecosystem

### PPTX
Continue current native-first OOXML compiler.
Add editor features only with explicit PPTX export strategy.

### Figma / Figma Slides
Build Pitch Importer plugin:
- SlideNode / FrameNode
- native TextNode
- vectors/shapes/images
- auto-layout Frames
- Pitch IDs stored as plugin data
- future reviewed round-trip sync

### Keynote
macOS adapter:
- production PPTX
- round-trip QA
- open in Keynote
- save native `.key`
- reopen/export preview validation
- later optimize direct Apple Events for supported native features

### PDF / HTML / PNG / video
Remain first-class target adapters.

## E9 — Collaboration and review

Yjs only for live session synchronization.

Deliver:
- multiplayer cursors
- selections/presence
- text/object concurrent editing
- comments/threads
- share/review mode
- accepted live state snapshots into ArtifactStore

Version DAG remains durable history.

## E10 — AI-native editor actions

Codex may operate at scopes:
- object
- multi-selection
- region
- slide
- section
- deck
- narrative node
- claim/evidence

Actions:
- add/remove/rearrange objects
- build diagrams
- generate/edit images
- change typography
- create visual hierarchy
- make selected items a layout frame
- restyle section
- create alternate slide
- branch alternate deck
- fix QA issue
- bind data/chart
- find and insert assets
- generate speaker notes
- animate selection

Hard rule:
Codex does not bypass editor transactions. Its output commits through the same typed mutation/asset/layout APIs as manual editing.

## E11 — Professional QA and performance

Deliver:
- Playwright browser interaction suite
- visual golden tests with pixel/perceptual diff
- text reflow fixtures
- 100/500/1000-object stress decks
- large-image memory tests
- input latency metrics
- transform FPS metric
- undo/redo soak tests
- branch isolation tests
- browser↔PPTX geometry comparisons
- font substitution reports

Performance targets to calibrate:
- 60fps direct manipulation on normal slides
- interaction feedback <16ms frame budget where practical
- no full-deck rerender on a local object transform
- slide virtualization for large decks
- heavy previews/assets loaded lazily

## Product UI modes

### Slides
Simple, opinionated, fast:
- insert
- arrange
- quick style
- layouts
- Ask Pitch
- notes/present

### Design
Full professional surface:
- layers
- frames/auto layout
- vector editing
- exact geometry
- rulers/guides
- advanced typography
- masks/effects
- timeline
- export diagnostics

### Codex is not a third mode
Ask Pitch is contextual everywhere. The UI reveals the agent’s proposed changes, scopes and QA impact without exposing internal IDE/tool noise.

## Order of implementation

1. E0 Interaction
2. E1 Geometry/selection
3. E2 Rich text
4. E3 Auto Layout
5. E5 Image/asset flow
6. E6 Tables/charts/diagrams
7. E4 advanced vectors/drawing
8. E7 motion
9. E8 Figma + Keynote
10. E9 collaboration

PPTX and Codex integration evolve continuously through every phase rather than waiting until the end.