# Pitch Monumentum — Delivery & Interop Center

Delivery is a guarded projection of the canonical Pitch project. Export formats are not editing databases and are never allowed to bypass review/evidence/integrity gates.

## Unified preflight

Every Delivery Center request checks:

- Collaboration Review delivery gate;
- deterministic Pitch QA critical issues;
- canonical asset-byte integrity;
- format-specific production warnings/blockers;
- Keynote/macOS availability where relevant.

A format is shown as ready only when its required gates pass.

## PowerPoint

PPTX remains the primary mature production delivery path.

It uses the existing native/editable compiler, production preflight, object identity and round-trip QA. Delivery Center adds the same review/asset gate used by other formats.

## Figma Bridge

Figma delivery is intentionally **not** an SVG/image flatten.

Pitch generates a `pitch-figma-bridge` JSON document containing:

- stable Pitch slide/object IDs;
- geometry, layer order and hierarchy;
- rich text characters/ranges;
- native shape/vector/line data;
- embedded image bytes and media treatment;
- token bindings;
- component instance/master metadata;
- Slide Master/source/placeholder metadata;
- deck theme and master metadata;
- explicit fidelity warnings.

### Local importer plugin

`apps/figma-bridge-plugin` contains a development Figma plugin that imports the bridge as editable nodes.

Current native imports:

- slide frames;
- text;
- rectangle/roundRect/ellipse/triangle;
- custom vector path where bridge path data is directly representable;
- lines;
- project images/icons;
- frame/group containers.

Pitch identity and structured source payload remain attached as Figma plugin data so later update/re-export can be identity-aware.

Charts, tables and diagrams currently become editable fallback containers with the structured Pitch payload attached. The importer does not silently rasterize them and the bridge emits warnings.

Figma plugin APIs used by the importer are intentionally isolated in this plugin package so core Pitch does not depend on Figma runtime globals.

## Standalone Web

Web delivery produces one self-contained HTML file:

- embedded project image bytes via data URI;
- no `/api/assets` runtime dependency;
- responsive scaling of the canonical Pitch canvas;
- rich text/basic shape/frame/line/image/table/chart rendering;
- keyboard/click navigation;
- slide counter/progress;
- speaker notes embedded but hidden;
- print stylesheet;
- entrance/exit/emphasis click-build playback.

Exact Motion keyframe tracks are currently an explicit warning. Use the native Pitch Presenter for full keyframe playback until Web parity is implemented.

## Keynote

Pitch does not pretend to synthesize a `.key` file on non-macOS systems.

Current adapter contract:

1. production-export editable PPTX;
2. confirm macOS + installed Apple Keynote;
3. invoke Keynote through `osascript`;
4. ask Keynote itself to open the PPTX and save the result as `.key`;
5. require a real output path to exist.

The adapter is marked `adapter-unverified` until exercised against an actual installed Keynote build in release validation. This is deliberate: tool-level AppleScript tests do not prove Keynote visual/editability parity.

## Delivery artifacts

Generated files live under:

`.project/exports/`

A delivery manifest records:

- deck identity/hash;
- preflight;
- generated artifacts;
- byte size;
- SHA-256;
- warnings;
- adapter status where applicable.

Browser downloads are restricted to basenames inside this export directory. Arbitrary filesystem paths are never accepted by the download route.

## Editor UI

`Deliver` drawer shows:

- PPTX;
- Figma Bridge;
- Standalone Web;
- Keynote;
- review/QA/asset readiness;
- format blockers and warnings;
- generated artifact hashes/downloads.

A blocked format cannot be exported through the UI button.

## MCP parity

Unified MCP adds:

- `pitch_delivery_state`;
- `pitch_delivery_export`.

The same preflight applies. Agent execution cannot bypass review approval or missing-asset blockers.

## Next interop work

After current delivery paths are validated:

- direct Figma update/re-export using stored Pitch IDs;
- native chart/table expansion in Figma importer;
- full Web keyframe/easing parity;
- production PDF and PNG slide rendering through a validated renderer;
- real macOS Keynote conversion corpus;
- Keynote/PPTX/Figma structural fidelity benchmarks.
