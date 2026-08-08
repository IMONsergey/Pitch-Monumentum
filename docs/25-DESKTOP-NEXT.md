# Pitch Monumentum — Desktop Full

> Historical filename: `25-DESKTOP-NEXT.md`. The temporary **Desktop Next** packaging path has been retired. The authoritative product shell is now **Desktop Full** backed by the stable `desktop-runtime` implementation.

Desktop Full is the post-stack desktop shell. It remains separate from frozen PR #5 until the stacked milestones are validated and merged, but it is now the default product entrypoint on the full-stack branch.

## Runtime stack

Desktop Full starts the full local workspace chain:

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

Stable code entrypoints:

- `apps/desktop-full/src/main.ts` — release entrypoint;
- `apps/desktop-runtime/src/main.ts` — implementation;
- `apps/desktop-runtime/src/preload.ts` — narrow IPC bridge;
- `apps/desktop-runtime/src/static-render.ts` — desktop PDF/PNG renderer;
- `apps/workspace/src/full-server.ts` — full local workspace;
- `apps/pitch-mcp-full/src/server.ts` — full MCP surface.

`apps/desktop-next/*` remains only as a compatibility alias for older stacked code references. It is not a packaging target.

## Default npm product commands

From `0.3.0-preview.1` onward:

- `npm run workspace` → Full Workspace;
- `npm run desktop` → Desktop Full;
- `npm run package:mac:x64` → Desktop Full Intel packaging;
- `npm run pitch:mcp` → Full MCP.

The older production-core entrypoints remain explicitly available as `workspace:core`, `desktop:core`, `package:mac:x64:core`, and `pitch:mcp:core` while the linear stack is being integrated.

## Window security

The main editor BrowserWindow keeps:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true`;
- external HTTP(S) windows denied and opened through the OS shell instead.

The preload bridge exposes only Desktop delivery commands and safe artifact reveal.

## Desktop delivery

The app menu exposes:

- PPTX;
- Figma Bridge;
- Standalone Web;
- Keynote adapter;
- PDF (desktop renderer);
- PNG slide set (desktop renderer).

All delivery paths respect the same review/QA/asset gates.

### PDF

Desktop PDF rendering first generates the self-contained Web artifact, loads it in a hidden sandboxed Electron BrowserWindow and uses Electron `printToPDF` with backgrounds enabled.

Page dimensions are derived from canonical project values:

```text
width inches  = canvas.widthDU  / canvas.duPerInch
height inches = canvas.heightDU / canvas.duPerInch
```

The renderer therefore supports non-1920×1080/custom canvases rather than assuming one demo format.

### PNG slide set

Desktop PNG rendering uses the same self-contained Web source. The hidden renderer and capture rectangle use the canonical `canvas.widthDU` and `canvas.heightDU`. Build-hidden state is removed for the static representation and slides are captured one by one.

PNG output remains a directory:

`.project/exports/<deck-id>-png/slide-001.png ...`

This path is desktop-only until a separately validated server renderer exists.

## Artifact filesystem boundary

Desktop reveal IPC validates that requested paths stay under the current project's `.project/exports` directory. Arbitrary filesystem paths are rejected.

Delivery manifests use deterministic filesystem inspection for both ordinary files and package directories such as a possible `.key` bundle. SHA-256 and byte counts therefore describe the actual artifact contents rather than only filesystem metadata.

## Authoritative packaging

There is now exactly one post-stack packaging path:

- `electron-builder.full.yml`
- `scripts/package-desktop-full.mjs`
- `.github/workflows/desktop-full-macos.yml`

The old `electron-builder.next*.yml`, `package-desktop-next*.mjs`, and `desktop-next-macos.yml` files were removed.

The Full packaging script refuses to continue unless the build emitted the stable Desktop Runtime, Full Workspace, Delivery/Review/Versions/Director runtimes and Full MCP entrypoint.

The manual Intel workflow then:

1. installs dependencies;
2. runs the verified full build/package script;
3. packages x64 DMG on `macos-15-intel`;
4. locates `.app/Contents/MacOS/Pitch Monumentum`;
5. requires `file` output to contain `x86_64`;
6. computes DMG SHA-256;
7. uploads DMG + architecture report + checksum.

It is `workflow_dispatch` only so the Full-stack branch does not add more PR/push jobs while frozen PR #5 is already waiting for runner capacity.

## Release discipline

Desktop Full is **not yet a verified downloadable release**.

PR #5 still has to produce and validate the first Intel Desktop Preview artifact. After the linear stack is merged and green, issue #9 is the real-machine Desktop Full release gate.

No DMG should be described as verified until a native macOS workflow actually runs, the packaged Mach-O reports `x86_64`, the checksum is recorded, and the build launches on a real Intel Mac.
