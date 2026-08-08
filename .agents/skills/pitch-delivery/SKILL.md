---
name: pitch-delivery
description: Validate and generate Pitch Monumentum production delivery artifacts through the unified Delivery Center. Use for PPTX, editable Figma Bridge, self-contained Web and macOS Keynote adapter delivery. Never bypass review, QA, asset-integrity or format-specific blockers.
---

# Pitch Delivery Center

## Readiness first

Call `pitch_delivery_state` before export.

Treat each format's `ready` flag and blockers as authoritative for that project state. Do not infer that because one format is ready, all formats are ready.

## Review authority

Delivery does not override Collaboration Review.

If unresolved blocking review or stale/missing required approvals block delivery, do not use raw file/export internals to work around the gate. Resolve review through the human review workflow.

## PowerPoint

Use PPTX for the mature editable production output. Keep its production preflight/round-trip warnings visible to the user.

## Figma

Figma output is a `pitch-figma-bridge` JSON artifact intended for the Pitch Monumentum Bridge plugin.

Do not describe it as a native `.fig` file. The bridge is valuable because it preserves stable identities, hierarchy, text/media/vector data and explicit fallback metadata instead of flattening slides.

## Web

Standalone Web is self-contained and does not depend on the Pitch workspace server after export.

If keyframe-track warnings are present, do not claim full Presenter motion parity. Basic click builds are supported; exact keyframe tracks remain native-Pitch Presenter territory until parity lands.

## Keynote

Keynote is available only through the macOS adapter when Apple Keynote is actually installed.

The adapter uses the production PPTX path and asks Keynote itself to save a `.key` document. Until a real macOS release test validates the produced artifact, preserve `adapter-unverified` in reporting.

Never claim `.key` output exists from a non-macOS environment.

## Export

Call `pitch_delivery_export` only with formats whose current preflight is ready.

Report:
- artifact filename/path;
- SHA-256;
- format warnings;
- adapter status where present.

Artifact paths are project-local under `.project/exports`.

## Completion

A delivery request is complete only when:
1. the selected format passed preflight;
2. the artifact was actually written;
3. hash/size metadata exists;
4. warnings are surfaced;
5. no readiness limitation is silently reworded as successful parity.
