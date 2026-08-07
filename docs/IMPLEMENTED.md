# Implemented — Phase 0 foundation

## Working code now present

- Canonical TypeScript deck/evidence/scene contracts.
- Versioned filesystem `ArtifactStore` with SHA-256 content hashes and atomic writes.
- Branch metadata and non-destructive branch fork.
- Evidence dependency graph with descendant/stale propagation.
- Pipeline stage dependency graph and downstream invalidation.
- `CodexGateway` contract plus App Server method mapping for start/resume/fork/turn.
- JSONL stdio transport that can launch `codex app-server`.
- Deterministic QA for IDs, bounds, safe areas and export risk.
- Dependency-free HTML deck renderer with stable slide/element IDs.
- **Native editable PPTX compiler** from the PitchOS scene graph. The current minimal compiler emits native PowerPoint text, shapes and lines directly as OOXML without an external PPTX library.
- CLI for creating a real demo project, QA, rendering, PPTX export, status and stale simulation.
- Local preview HTTP server.
- Automated tests for artifact versioning, branching, evidence invalidation, stage invalidation, Codex protocol mapping, QA, renderer targeting and PPTX compilation.

## Validation already performed

```bash
npm run check
```

passes the current test suite.

The generated PPTX package was also validated outside the unit tests:

1. ZIP/package integrity check passed.
2. LibreOffice Impress opened the generated `.pptx` and exported it to PDF without an error.
3. The exported PDF was rendered to PNG and visually inspected; the native text/shape composition rendered correctly.

This gives us an end-to-end proof that the current canonical scene graph can already produce a real office presentation file rather than a fake screenshot deck.

## Commands

```bash
npm install
npm run check
npm run demo
npm run serve
```

The demo now also writes:

```text
.pitch-demo/exports/deck.pptx
```

Compile any canonical deck JSON directly:

```bash
npm run build
node dist/apps/cli/src/index.js pptx path/to/deck.json out.pptx
```

## Current limitations

- Native PPTX support currently covers text, simple shapes and lines. Images, tables, charts, icons/diagrams, notes and richer theme/master semantics are the next compiler capabilities.
- Codex App Server integration is protocol-ready but production initialization/approval/model-management handling still needs generated official protocol types and integration tests against a real Codex installation.
- Source ingestion is not implemented yet.
- Round-trip PPTX parser/diff is not implemented yet.
- Visual editor interactions are not implemented yet; current renderer is read-only.
- Runtime schemas need consolidation into a single generated source to prevent drift between TypeScript and JSON Schema.

## Next slice

Implement source ingestion + evidence extraction + PresentationBrief/Narrative artifacts, then use Codex to produce the first real multi-slide storyboard from source material. In parallel, expand native PPTX output to images/tables/charts and add round-trip import validation.
