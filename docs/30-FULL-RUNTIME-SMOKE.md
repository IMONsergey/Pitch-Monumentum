# Full runtime smoke gate

`full-runtime-smoke.mjs` is the post-build / pre-electron-builder smoke layer for Desktop Full.

It is intentionally different from unit/E2E tests:

- unit tests validate isolated contracts;
- browser E2E validates editor interactions;
- source-tree preflight validates repository/package structure;
- **Full runtime smoke validates that the compiled stack actually assembles and starts as one product.**

## Smoke project

The smoke run creates a temporary built-in Desktop Preview project through `ensureDesktopPreviewProject()`.

It never mutates a real user project.

## Smoke server

The script starts the compiled `createPitchFullWorkspaceServer()` on ephemeral `127.0.0.1`.

It verifies:

- `/api/system-health` is readable;
- canonical project health is OK;
- Full UI source health is OK;
- compiled-entry health is OK;
- Desktop Preview is editing-ready;
- `/api/delivery-state` exposes PPTX/Figma/Web/Keynote readiness state;
- `/api/project` sees the same preview deck and four slides;
- `/editor-spike` loads;
- `/editor-spike.js` includes the major Full surfaces:
  - core editor runtime;
  - Design System;
  - Slide Masters;
  - Creative Director;
  - Versions;
  - Comments & Review;
  - Delivery;
  - System Health.

## Failure semantics

Any missing required surface makes the smoke process exit non-zero.

The script does **not** prove:

- Electron BrowserWindow launch;
- PDF/PNG rendering;
- native macOS x64 packaging;
- Keynote/Figma application fidelity.

Those remain later gates.

## Packaging placement

The intended Full packaging order is:

```text
release:preflight
→ npm run build
→ compiled-entry guard
→ full-runtime-smoke
→ electron-builder x64
→ Mach-O architecture check
→ checksum
→ real Intel Mac smoke
```

If a future refactor makes Desktop Full package without running this smoke, the packaging contract has regressed.
