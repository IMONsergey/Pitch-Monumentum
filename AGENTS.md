# Pitch Monumentum — Agent Rules

## Mission

Build Pitch Monumentum as a commercial AI-native presentation environment where Codex is the control plane and the user works primarily through a visual deck workspace.

## Hard constraints

- Use **OpenAI/Codex only** for AI reasoning and generation orchestration.
- Do not introduce Claude, Cursor, Gemini, OpenCode, Ollama, or generic multi-provider adapters.
- The desktop product must retain a viable **macOS Intel x86_64** packaging path.
- Do not make PPTX the internal source of truth.
- Do not base the closed product on AGPL/GPL code without an explicit licensing decision.
- Do not couple domain state to a particular canvas/UI library.
- Do not silently turn unsupported PPTX content into screenshots. Every fallback must be explicit in metadata.
- Do not make an AI-generated bitmap the normal slide representation. Image-first generation may be an optional concept/exploration mode, not the default production path.
- Factual claims must not lose provenance during rewriting, visual editing, branching, or export.

## Preferred engineering style

- TypeScript first for the desktop/client and core domain packages.
- Pure functions around deck transforms and validation.
- Deterministic schemas between agent stages.
- Stable IDs for sources, claims, narrative nodes, slides, scene elements, artifacts and versions.
- Content-addressed artifacts where practical.
- Restartable stage execution with dependency-based invalidation.
- Use Codex subagents mainly for independent read-heavy or per-slide work; avoid uncontrolled concurrent writes to shared deck state.
- Every agent mutation produces a patch or a new artifact version, never an opaque side effect.

## Architecture ownership

- `packages/deck-model`: canonical semantic + scene data structures.
- `packages/evidence`: provenance, source anchors, claim validation, stale propagation.
- `packages/agent-runtime`: stage graph, Codex thread/session binding, artifact lifecycle.
- `packages/layout`: layout recipes and geometry constraints.
- `packages/pptx`: import/export contracts and round-trip validation.
- `packages/qa`: deterministic and model-assisted quality checks.
- `apps/desktop`: shell + workspace UI. It must not own domain truth.

## Build rule

Before implementing a feature, answer:
1. What canonical object changes?
2. Which upstream/downstream artifacts become stale?
3. How is the change represented as a reversible patch/version?
4. Which QA gates prove it works?
5. Is PPTX export still editable?

If those answers are unclear, fix the model first instead of adding UI state.
