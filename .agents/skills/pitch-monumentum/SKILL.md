---
name: pitch-monumentum
description: Build, revise, reframe, review, or export professional source-grounded business presentations using PitchOS artifacts. Use for deck strategy, narrative architecture, slide composition, evidence tracking, targeted slide/object edits, corporate-template adaptation, PowerPoint export, or presentation QA.
---

# Pitch Monumentum / PitchOS

## Mission

Produce decision-grade presentations from source material while preserving factual provenance, narrative intent, visual consistency, object-level editability, reversible versions, and export quality.

## Canonical truth

The project artifacts are canonical. Do not use a PPTX file, HTML, React source, bitmap slide, or chat memory as the only source of truth.

```text
sources → evidence → brief → narrative → design-system → storyboard → scene graphs → qa → exports
```

## Routes

- `new-deck`
- `build-from-sources`
- `revise-deck`
- `reframe-for-audience`
- `import-brand-template`
- `edit-selection`
- `branch-alternative`
- `review-deck`
- `export-deck`

## Hard rules

1. Never invent a sourced number; scenario/target/demo values must be explicitly classified `scenario`.
2. Every slide has a semantic contract before final composition.
3. Every scene object has a stable ID.
4. Local edits are local by default; do not regenerate unrelated slides.
5. If upstream evidence changes, mark dependent claims/slides stale.
6. Separate narrative, evidence, visual, and export QA.
7. Prefer native text/shapes/basic charts in PPTX and report fallbacks.
8. Persist typed artifacts, decisions, warnings and QA findings instead of opaque agent memory.

## Pipeline

```text
INTAKE → EVIDENCE → BRIEF → NARRATIVE → DESIGN → STORYBOARD → COMPOSE
→ QA_NARRATIVE → QA_EVIDENCE → QA_VISUAL → REPAIR → EXPORT → ROUNDTRIP_QA → READY
```

Stages are restartable and dependency-aware. Reuse valid existing artifacts rather than recomputing the whole deck.

## Roles

- Orchestrator routes.
- Researcher extracts and grounds.
- Strategist defines the communication contract.
- Story Architect defines the argument.
- Art Director defines visual grammar.
- Composer creates scene graphs.
- Data Storyteller owns chart choice and data mapping.
- Reviewer attacks quality.
- Exporter is deterministic where possible.

## Completion

A deck may be `READY` only when there is no open critical QA issue, key factual claims are grounded or explicitly labeled, severe overflow is absent, supported PPTX objects remain editable, and export fallbacks are reported.
