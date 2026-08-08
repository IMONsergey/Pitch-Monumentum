# Native Export Architecture — Figma Slides and Keynote

Date: 2026-08-08

## Principle

PitchOS `DeckDocument` / `SceneGraph` is canonical.

Exporters compile the same object graph into target-native objects. No target format becomes the editor's source of truth.

---

# Figma / Figma Slides

## Decision

Build an official **Pitch Monumentum Figma plugin**.

The plugin receives a serialized Pitch export package and creates editable native Figma nodes.

When running in Figma Slides, use the Slides Plugin API and create native `SlideNode`s. When running in Figma Design, create ordinary `FrameNode` slide frames.

## Why a plugin instead of a `.fig` writer

Figma's Plugin API officially allows plugins to create and update file contents, including text, frames, vectors and Slides-specific nodes. The proprietary `.fig` file format should not be reverse engineered or used as an interchange target.

## Pitch → Figma mapping

| Pitch Scene element | Figma target |
|---|---|
| slide | `SlideNode` in Figma Slides / `FrameNode` in Figma Design |
| text | `TextNode` |
| shape rect/ellipse | Rectangle/Ellipse/Vector node |
| freeform vector | `VectorNode` |
| image | rectangle/frame with image fill |
| group | `GroupNode` or `FrameNode` depending semantics |
| auto-layout frame | `FrameNode` with Figma auto-layout properties |
| line | vector/line node |
| icon | vector node |
| chart | editable group/vector by default; optional chart-plugin metadata |
| table | nested auto-layout frames + text |
| diagram | frames/vectors/groups |

## Preserve Pitch identity

Write Pitch IDs into Figma plugin data:

```text
pitch.projectId
pitch.deckId
pitch.slideId
pitch.elementId
pitch.claimIds
pitch.sourceRefs
pitch.versionHash
```

This enables future **round-trip sync** rather than one-way export.

## Export package

```text
pitch-figma-export/
├── manifest.json
├── deck.json
├── assets/
├── fonts.json
└── evidence-summary.json
```

Plugin flow:
1. user opens Pitch Importer in Figma/Figma Slides
2. chooses export package or connects to local Pitch app
3. plugin resolves fonts/assets
4. creates native slide/frame nodes
5. records Pitch IDs as plugin metadata
6. renders warnings for unsupported effects
7. returns Figma node IDs to Pitch when live connection exists

## Long-term round trip

Phase 1: one-way Pitch → Figma.

Phase 2:
- plugin detects changed Pitch-owned Figma nodes
- translates compatible changes into `DeckMutation`s
- user reviews import diff
- approved changes become a new Pitch artifact version

Do not silently sync arbitrary Figma structure back into Pitch.

---

# Keynote `.key`

## Constraint

`.key` is an Apple-owned format and should not become a format we write by reverse engineering.

Apple officially supports opening Microsoft PowerPoint `.pptx` presentations in Keynote and then saving/editing them as Keynote presentations.

## v1 path

```text
Pitch SceneGraph
      ↓
Production PPTX compiler
      ↓
round-trip PPTX QA
      ↓
Keynote Automation Adapter (macOS)
      ↓
open .pptx in Keynote
      ↓
save as native Keynote presentation
      ↓
reopen / export preview for validation
      ↓
.key
```

This leverages our native-first PPTX work: text, images, tables and supported charts arrive in Keynote as editable presentation objects instead of a deck of screenshots.

## Automation adapter

Implement in the desktop macOS helper using:
- AppleScript / JXA via `osascript`, or
- Apple Events through a small native helper later

The adapter must:
- verify Keynote is installed
- open the generated PPTX
- save the imported document as a Keynote document at a chosen path
- close without overwriting source PPTX
- reopen the output
- export PDF/slide images for validation
- surface Keynote conversion warnings where available

Exact save automation must be validated against the current Keynote scripting dictionary on supported macOS versions before production release.

## Why PPTX bridge is acceptable

Our PPTX is already a first-class native object compiler, not a screenshot wrapper. For common presentation primitives, PowerPoint is the most practical interoperable bridge accepted by Keynote.

## Future direct Keynote adapter

After the v1 bridge is stable, evaluate creating supported Keynote elements directly through AppleScript/JXA for:
- text
- shapes
- images
- tables/charts where scripting APIs are sufficient
- presenter notes
- transitions

This can improve fidelity for specific Keynote-only capabilities, but should remain an optimization rather than the canonical export path.

---

# Export capability matrix

Every scene element must declare target strategies:

```ts
interface TargetExportCapability {
  pptx: 'native' | 'vector' | 'raster' | 'unsupported';
  figma: 'native' | 'vector' | 'raster' | 'unsupported';
  keynote: 'native-via-pptx' | 'native-direct' | 'vector' | 'raster' | 'unsupported';
}
```

The Export Center shows the user before export:
- native/editable percentage
- vector fallbacks
- raster fallbacks
- unsupported elements
- font substitutions
- animation downgrades

A target should never silently flatten editable content.

---

# Design implication

Do not implement editor-only effects that have no declared export behavior.

New effects/features are allowed, but their schema must state what happens in each target. This keeps Pitch creative without making external export unpredictable.