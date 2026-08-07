# Implemented — Phase 0 foundation

## Working code now present

- Canonical TypeScript deck/evidence/scene contracts.
- Versioned filesystem `ArtifactStore` with SHA-256 content hashes and atomic writes.
- Branch metadata and non-destructive branch fork.
- Evidence dependency graph with descendant/stale propagation.
- Pipeline stage dependency graph and downstream invalidation.
- `CodexGateway` contract plus App Server method mapping for start/resume/fork/turn.
- JSONL stdio transport that can launch `codex app-server` when Codex is installed.
- Deterministic QA for IDs, bounds, safe areas and export risk.
- Dependency-free HTML deck renderer with stable slide/element IDs.
- Native editable PPTX compiler from the PitchOS scene graph. Current native objects: text, simple shapes and lines.
- **Local source ingestion** for Markdown/TXT/CSV/JSON/HTML, DOCX, PPTX and XLSX. Office sources are parsed as ZIP/OOXML locally, including deflated ZIP entries.
- Stable source checksums, source blocks and exact anchors: text line ranges, DOCX paragraphs, PPTX slide numbers, XLSX sheet/ranges.
- Deterministic numeric evidence-candidate extraction with source-anchor links.
- CLI source import writes source/source-block/evidence artifacts and extends the dependency graph.
- CLI for demo, QA, rendering, native PPTX export, source ingestion, status and stale simulation.
- Local preview HTTP server.
- Automated test coverage for artifact versioning, branching, evidence invalidation, stage invalidation, Codex protocol mapping, QA, renderer targeting, PPTX compilation and source ingestion.

## Validation already performed

`npm run check` passes the current **11-test** suite.

Native PPTX was additionally validated outside unit tests: ZIP/package integrity passed; LibreOffice Impress opened it and exported it to PDF; that PDF was rasterized and visually inspected successfully.

Source ingestion was exercised end-to-end through the CLI. A test Q2 markdown source created versioned source artifacts, exact anchors and the dependency graph. An initial false positive where `Q2` was interpreted as numeric evidence was caught during this run and fixed; only the true `31%` / `24%` metrics remained.

## Commands

```bash
npm install
npm run check
npm run demo
npm run serve
```

Compile canonical deck JSON:

```bash
npm run build
node dist/apps/cli/src/index.js pptx path/to/deck.json out.pptx
```

Import real source files into a Pitch project:

```bash
npm run build
node dist/apps/cli/src/index.js ingest .pitch-project report.md metrics.xlsx old-deck.pptx
```

## Current limitations

- PDF files are registered and hashed, but PDF text/layout extraction is intentionally not faked; a proper layout-aware PDF parser adapter remains required.
- Native PPTX currently covers text, simple shapes and lines. Images, tables, charts, notes and richer master/theme behavior are next.
- Current numeric evidence extraction creates candidates, not verified claims; Codex/reviewer stages still need to classify and validate them.
- Codex App Server integration is protocol-ready but this execution environment has no `codex` binary installed, so live App Server integration has not yet been exercised here.
- Round-trip PPTX structural diff is not implemented yet.
- Visual editor interactions are not implemented yet; current renderer is read-only.

## Next slice

Build the first full semantic pipeline on top of these primitives: source artifacts → Codex strategist/research contracts → verified claims → PresentationBrief → NarrativeGraph → Storyboard. In parallel expand the native PowerPoint compiler to images/tables/charts and implement import/export round-trip QA.
