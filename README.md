# Pitch Monumentum

**AI-native presentation development environment for professional decisions.**

Pitch Monumentum is not a prompt-to-slides toy and not a PowerPoint clone. PitchOS turns messy source material into a source-grounded argument, a coherent visual system, editable slide scene graphs, quality checks, and finally production outputs such as PowerPoint and PDF.

## Product thesis

```text
Sources
  ↓
Evidence Graph
  ↓
Presentation Brief
  ↓
Narrative Graph
  ↓
Design System
  ↓
Storyboard
  ↓
Editable Scene Graphs
  ↓
Narrative · Evidence · Visual · Export QA
  ↓
PPTX · PDF · HTML · PNG
```

The internal project model — not PPTX, HTML, React or screenshots — is the source of truth.

## Phase 0 is executable

This repository already contains a dependency-free foundation for the domain spine:

- versioned artifact store;
- SHA-256 content addressing;
- branch metadata;
- evidence dependency/stale propagation;
- pipeline stage invalidation;
- canonical deck/slide/scene model;
- deterministic QA;
- HTML renderer with stable object IDs;
- Codex App Server gateway contract and JSONL stdio transport;
- CLI demo and tests.

### Run

```bash
npm install
npm run check
npm run demo
npm run serve
```

Then open the printed local preview URL.

### Simulate a source becoming stale

```bash
npm run build
node dist/apps/cli/src/index.js stale .pitch-demo source_demo
```

Only actual descendants in the dependency graph are marked stale.

## Key documents

- [`docs/00-EXECUTIVE-BLUEPRINT.md`](docs/00-EXECUTIVE-BLUEPRINT.md)
- [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md)
- [`docs/03-DECK-MODEL.md`](docs/03-DECK-MODEL.md)
- [`docs/04-AGENTS-AND-WORKFLOWS.md`](docs/04-AGENTS-AND-WORKFLOWS.md)
- [`docs/05-CANVAS-UX.md`](docs/05-CANVAS-UX.md)
- [`docs/06-PPTX-PIPELINE.md`](docs/06-PPTX-PIPELINE.md)
- [`docs/07-QA-EVALS.md`](docs/07-QA-EVALS.md)
- [`docs/08-ROADMAP.md`](docs/08-ROADMAP.md)
- [`docs/IMPLEMENTED.md`](docs/IMPLEMENTED.md)

## Codex skill

The repository includes `.agents/skills/pitch-monumentum/SKILL.md` so Codex can use the project-specific presentation workflow directly from the repository.

## Current implementation target

The next working slice is:

> **source ingestion → evidence anchors → brief → narrative graph → storyboard → first real multi-slide deck**

See [`docs/12-BACKLOG.md`](docs/12-BACKLOG.md) and [`IMPLEMENTATION_PLAN.json`](IMPLEMENTATION_PLAN.json).
