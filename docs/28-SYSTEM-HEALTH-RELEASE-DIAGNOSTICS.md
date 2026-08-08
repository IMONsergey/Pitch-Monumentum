# Pitch Monumentum — System Health & release diagnostics

System Health is the read-only diagnostics layer for the Full product stack. It exists to make local/Desktop smoke tests observable without confusing runtime health with external release validation.

## Surfaces

- Editor: `Health` drawer.
- HTTP: `GET /api/system-health`.
- MCP: `pitch_system_health`.
- Runtime: `apps/system-health/src/runtime.ts`.
- UI: `apps/workspace/public/system-health-ui.js`.

The same snapshot is used by the editor and Codex.

## What System Health checks

### Canonical project

- manifest is readable;
- active branch exists;
- deck head is readable;
- deck hash is reported;
- branch count is reported.

### Deterministic QA

- critical issues are blockers;
- major issues are warnings;
- total issue count is exposed.

### Assets

System Health reuses Delivery preflight asset integrity:

- every referenced image/icon/video asset id must resolve;
- missing bytes are blockers;
- referenced asset count is reported.

### Review / approvals

- blocking threads;
- stale deck approval;
- stale slide approvals;
- open thread count;
- current review hash.

Review state is primarily a delivery/governance gate. An open blocking review does not make the editor unusable, but it makes delivery non-ready.

### Slide Masters

- master count;
- linked slides;
- Master QA issues;
- critical master integrity is an editing blocker.

### Motion

- slides with motion;
- stale references;
- stale references are editing blockers because Presenter/build behavior would target invalid canonical objects.

### Creative Director

- production score;
- blocker count;
- warning count;
- current priorities.

Creative Director score by itself is not a release certificate. It is a deterministic quality snapshot used to locate risk.

### Versions

- branch count;
- checkpoint count;
- active branch.

### Delivery

- ready server formats;
- per-format blockers/warnings;
- current Delivery snapshot branch/deck/review/motion hashes;
- Keynote adapter availability.

### Product surface

System Health checks the expected Full UI files and, after build, the expected compiled Full runtime entrypoints.

The Desktop Full packager independently repeats the compiled-entry checks before electron-builder. Health is not the only guard.

### Environment

- operating system;
- architecture;
- Node version;
- Electron version when running inside Desktop;
- Chromium version when available.

On macOS, x64 is reported explicitly because the current release target is Intel. Running under another architecture is a warning, not an automatic statement that the product is broken.

## Editing readiness vs delivery readiness

`editingReady` is false only for blockers that make canonical editing/runtime integrity unsafe, including:

- canonical project failure;
- critical deterministic QA;
- missing referenced assets;
- critical Slide Master integrity;
- stale Motion references;
- missing Full UI layers.

`deliveryReady` requires at least one ready Delivery format **and** a clear review gate.

This distinction is deliberate: a reviewer may block delivery while the editor remains perfectly usable.

## What Health does NOT prove

A green Health snapshot does not prove:

- GitHub Actions ran;
- DMG architecture was verified by `file`;
- code signing/notarization;
- installation on a real Intel Mac;
- real Figma Desktop importer fidelity;
- real Keynote conversion fidelity;
- Safari/Chrome visual corpus fidelity;
- external font availability.

Those remain separate evidence gates.

## Full packaging sequence

The intended Full packaging chain is:

```text
source-tree preflight
  ↓
TypeScript / build
  ↓
compiled-entry guards
  ↓
Full runtime smoke on temporary Desktop Preview project
  ↓
electron-builder x64
  ↓
Mach-O `file` check
  ↓
DMG SHA-256
  ↓
real Intel Mac smoke test
```

The runtime smoke script is `scripts/full-runtime-smoke.mjs`. It starts the real Full Workspace on localhost, reads System Health + Delivery state + project state, and verifies the assembled editor bundle contains the major Full UI layers before packaging is allowed.

## External tracked gates

- Issue #8 — checkpoint source-branch ancestry implementation must pass sequential rebase/CI.
- Issue #9 — Desktop Full native Intel DMG and real Intel Mac validation.
- Issue #10 — real Figma + Keynote fidelity corpus.

System Health should reference these limitations in release documentation rather than attempting to convert them into fake local checks.
