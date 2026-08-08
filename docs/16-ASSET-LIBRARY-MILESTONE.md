# Asset Library & Real Image Production milestone

This milestone removes one of the largest prototype gaps in the current Pitch Monumentum editor: image objects are no longer placeholder boxes backed only by string IDs.

## Shipped in this milestone

### Project-native asset storage

- PNG/JPEG bytes live under `.project/assets/<assetId>/`.
- Asset IDs are content-addressed from SHA-256 and duplicate uploads collapse to one canonical asset.
- Metadata stores original filename, MIME type, dimensions, byte size, source and checksum.
- The current preview limit is 40 MB per image.
- Deleting an asset is blocked while the canonical deck still references it.

### Editor workflow

- `Assets` library in the editor toolbar.
- Import multiple images.
- Drag PNG/JPEG files directly onto the slide at the drop location.
- Paste clipboard images directly into the deck.
- Insert an existing project asset multiple times.
- Replace the currently selected ImageElement from the asset library.
- Search by asset filename or ID.
- Show per-asset usage count and source dimensions.

### Canonical scene behavior

`insertImage` is a normal EditorCommand, not an asset-specific UI shortcut.

That means image insertion shares the same:

- stable SceneGraph identity;
- deck versioning and undo/redo;
- selection behavior;
- manual/Codex command path;
- QA/export invalidation;
- image Media Inspector.

ImageElement dependencies contain the referenced asset ID.

### Real canvas and Presenter rendering

ImageElement nodes now resolve `/api/assets/<assetId>/content` and render the real source bytes in both the editor canvas and Presenter. Fit, normalized crop and corner radius remain editable canonical properties.

Missing asset bytes fail visibly instead of silently producing an empty box.

### PowerPoint export

The workspace builds a `RichAsset` map directly from project assets before calling the existing production PPTX pipeline. PNG/JPEG ImageElements therefore export as native PowerPoint picture objects, including existing normalized crop support in the rich PPTX compiler.

### Codex parity

`pitch_project_state` now exposes project asset handles and ImageElement asset IDs. `pitch_editor_command` supports `insertImage` for existing assets, and `pitch_media_command` exposes atomic `setImageProperties` alongside the narrower image commands.

## Explicit limits of this release

This is the first production asset slice, not the final media system.

Still pending:

- WebP/HEIC conversion;
- generated-image provenance and prompt history;
- background removal / segmentation;
- interactive crop handles and focal-point UI;
- thumbnails/derivatives for very large libraries;
- video/audio project assets;
- cloud/sync storage;
- Figma image-fill interoperability.

Those belong to the next Asset Production iterations rather than being hidden behind fake placeholders now.
