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
- CLI for creating a real demo project, QA, rendering, status and stale simulation.
- Local preview HTTP server.
- Automated tests for artifact versioning, branching, evidence invalidation, stage invalidation, Codex protocol mapping, QA and renderer targeting.

## Commands

```bash
npm install
npm run check
npm run demo
npm run serve
```

## Current limitations

- Codex App Server integration is protocol-ready but production initialization/approval/model-management handling still needs generated official protocol types and integration tests against a real Codex installation.
- Source ingestion is not implemented yet.
- PPTX compilation is interface-only.
- Visual editor interactions are not implemented yet; current renderer is read-only.
- Runtime schemas need consolidation into a single generated source to prevent drift between TypeScript and JSON Schema.

## Next slice

Implement source ingestion + evidence extraction + PresentationBrief/Narrative artifacts, then use Codex to produce the first real multi-slide storyboard from source material.
