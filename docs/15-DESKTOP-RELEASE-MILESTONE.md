# Desktop Release Milestone

Goal: turn the current Pitch Monumentum editor into an installable Intel macOS product preview while closing the most visible daily-use gaps.

## Scope

1. Desktop shell
   - Electron app for macOS x64.
   - Starts the local Pitch workspace server inside the app process.
   - Native menu and keyboard shortcuts.
   - Safe external-link handling.
   - Persistent recent-project path and first-run project bootstrap.

2. Asset production foundation
   - Project-local asset registry and binary asset directory.
   - Upload/import endpoint for PNG/JPEG/WebP/SVG/GIF.
   - Asset metadata, checksums, dimensions and usage references.
   - Asset library UI with thumbnails/search and insert-to-slide.
   - Real image rendering in editor/presenter when an asset exists.

3. Release engineering
   - macOS x64 DMG via electron-builder.
   - GitHub Actions build on Intel macOS runner.
   - Unsigned/ad-hoc developer preview packaging for internal inspection.
   - Build artifact uploaded as `Pitch-Monumentum-mac-x64`.

## Non-goals for this preview

- Apple notarization / Developer ID signing.
- Cloud collaboration.
- Production AI image generation provider wiring.
- Keynote/Figma export.

These remain later release milestones; this build is meant to inspect the actual editor product locally on an Intel Mac.
