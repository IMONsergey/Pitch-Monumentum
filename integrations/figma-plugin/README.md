# Pitch Monumentum → Figma / Figma Slides Importer

This development plugin imports a self-contained `*.pitch-figma.json` export into native Figma objects.

## Why this is a plugin instead of a generated `.fig`

Pitch Monumentum keeps `DeckDocument` as the canonical model. The Figma Plugin API is used to create editable native objects (text, frames, Auto Layout, shapes and images) inside Figma/Figma Slides. Pitch does not reverse-engineer Figma's private file format.

## Register the development plugin once

Figma assigns every plugin its own `id`; the repository deliberately does **not** invent one.

1. In Figma desktop, create a new development plugin (`Plugins → Development → New Plugin…`).
2. Let Figma generate its `manifest.json` so it contains the Figma-assigned `id`.
3. Replace/extend the generated manifest fields using `manifest.example.json` from this directory. Keep the real assigned `id`.
4. Point `main` to this directory's `code.js` and `ui` to `ui.html` (or copy these files into the generated plugin folder).
5. Keep `editorType: ["figma", "slides"]`, `documentAccess: "dynamic-page"`, and `networkAccess.allowedDomains: ["none"]`.
6. Run the development plugin in either a Figma Design file or a Figma Slides file.

## Import

1. Export a Figma bridge bundle from Pitch Monumentum (`*.pitch-figma.json`).
2. Open **Pitch Monumentum Importer** in Figma.
3. Choose/drop the bundle.
4. Click **Import native deck**.

In Figma Slides, each Pitch slide becomes a native `SlideNode`. In Figma Design, each Pitch slide becomes a 1920×1080 `FrameNode` placed horizontally on the current page.

## Native mappings

- `TextElement` → `TextNode`; mixed font/size/color/bold/italic/underline/letter-spacing ranges are applied after `figma.loadFontAsync()`.
- `FrameElement` / `GroupElement` → `FrameNode` with Pitch IDs stored in plugin data.
- `AutoLayoutSpec` → Figma Auto Layout (`layoutMode`, gap, padding, alignment and child layout sizing).
- `ShapeElement` → Rectangle / Ellipse / Polygon / Vector.
- `LineElement` → Line.
- `ImageElement` → Rectangle with an `ImagePaint` created from the **original Asset Registry bytes**.

## Fidelity rules

The importer must not silently degrade canonical objects.

- If a requested font is unavailable to Figma, a fallback is used and a warning is returned.
- Figma's Plugin API rejects images above 4096 px on either side. Pitch keeps the original image untouched; the importer emits a warning/placeholder instead of silently downscaling it.
- Unsupported types (currently charts/tables/diagrams/video) create a visible placeholder and warning instead of disappearing.
- Mixed paragraph alignment, Pitch text insets, exact image crop transforms and some advanced spacing/list semantics are explicit fidelity gaps in this first importer version.

The Pitch bundle remains the source of truth, so improving any of these mappings later does not require changing the deck model or re-generating assets.
