# Pitch Monumentum — Desktop Next

Desktop Next is the post-stack desktop shell. It is deliberately separate from the frozen PR #5 shell until the stacked milestones are validated and merged.

## Runtime stack

Desktop Next starts the full local workspace chain:

```text
Delivery
  ↓
Collaboration Review
  ↓
Versions / Branch Review
  ↓
Creative Director
  ↓
Slide Masters
  ↓
Design System 2.0
  ↓
Pro Editor / Assets / Motion / Components / Presenter
```

The desktop app does not introduce a separate document model. It hosts the same local Pitch project and canonical command services.

## Window security

The main editor BrowserWindow keeps:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true`;
- external HTTP(S) windows denied and opened through the OS shell instead.

A narrow preload bridge exposes only Desktop delivery commands and artifact reveal.

## Desktop delivery

The app menu exposes:

- PPTX;
- Figma Bridge;
- Standalone Web;
- Keynote adapter;
- PDF (desktop renderer);
- PNG slide set (desktop renderer).

PPTX/Figma/Web/Keynote use the same review-aware Delivery Runtime.

### PDF

Desktop PDF rendering first generates the self-contained Web artifact, loads it in a hidden sandboxed Electron BrowserWindow, injects fixed 16:9 print-page CSS and uses Electron's PDF print path with backgrounds enabled.

This avoids adding Chromium/Playwright as a packaged runtime dependency.

### PNG slide set

Desktop PNG rendering uses the same self-contained Web source in a hidden 1920×1080 BrowserWindow, removes presentation UI/build-hidden states for a static full-slide representation, activates slides one by one and captures the page to PNG.

PNG output is a directory:

`.project/exports/<deck-id>-png/slide-001.png ...`

This path is desktop-only until a validated server renderer is introduced.

## Artifact filesystem boundary

Desktop reveal IPC validates that requested paths stay under the current project's `.project/exports` directory. Arbitrary filesystem paths are rejected.

## Packaging

Authoritative post-stack config:

- `electron-builder.next.safe.yml`
- `scripts/package-desktop-next-safe.mjs`
- `.github/workflows/desktop-next-macos.yml`

The workflow is `workflow_dispatch` only and therefore does not compete with the currently frozen PR #5 Actions queue.

The Intel build gate:

1. `npm install`;
2. build repository;
3. electron-builder x64 DMG;
4. locate packaged app executable;
5. `file` must contain `x86_64`;
6. SHA-256 the DMG;
7. upload DMG + architecture report + checksum.

## Release discipline

Desktop Next is not the current downloadable release candidate.

PR #5 must still produce its own verified Intel artifact before it is merged. After the stacked milestones are merged and green independently, Desktop Next becomes the next packaging target and must pass the same real-machine artifact gate.

No DMG should be described as verified until the hosted/native macOS build actually runs and the artifact is inspected.
