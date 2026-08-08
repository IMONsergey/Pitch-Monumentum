# Pitch Monumentum — Creative Director Engine

Creative Director is the guarded production-control layer above Pitch's canonical editor tools. It is not a second chat UI and it does not bypass the scene graph.

## Product contract

The loop is:

```text
current project state
      ↓
production review
      ↓
scoped creative request
      ↓
server-issued plan
      ↓
validated canonical actions
      ↓
current branch OR isolated preview branch
      ↓
post-review + immutable execution audit
      ↓
accept preview / return to original
```

Every actual edit still runs through the same editor/media/design/component/master/motion command families used by the manual editor and Codex.

## Production review

Creative Director combines eight deterministic quality lanes:

- structure;
- evidence;
- visual;
- brand;
- editability/export;
- project assets;
- Slide Masters;
- motion integrity.

Evidence is a first-class gate. A visually stronger slide is not accepted as an improvement if it introduces critical evidence issues.

## Server-issued plans

A client never submits an arbitrary trusted plan. `pitch_creative_plan` / `/api/creative-plan` create the plan on the server from:

- explicit instruction;
- intent set;
- explicit selection / slide / deck scope;
- aggressiveness;
- preserve constraints;
- global/narrative/evidence permissions.

The plan is registered against the current branch and deck hash. If either changes before execution, the plan becomes stale and execution is refused. Re-plan against current state instead of replaying stale IDs or assumptions.

## Execution contract

Concrete tool calls are separate from the plan and are validated before dispatch.

Guards include:

- plan/deck/request identity;
- edit-step only execution;
- allowed canonical tool family for each plan step;
- slide/object scope boundaries;
- global propagation detection;
- explicit approval for high-risk propagation;
- maximum bounded action count;
- preview-branch requirement for high-risk/global edits unless direct write was explicitly approved.

Global commands cannot be hidden inside a selection-scoped plan. For example, a local brand polish step cannot smuggle a deck-wide `setToken` operation.

## Safe deterministic fixes

Creative Director may apply a narrow class of fixes automatically:

- exact materialized style value → exactly equal live theme token binding;
- confidence must be exactly 1.0;
- no object geometry/content/master changes;
- no approximate type-scale matching;
- no visual change.

All safe fixes are compiled in memory and written as one deck version / one Undo point.

## Preview branches

High-risk/global work defaults to a normal Pitch fork.

Forks record exact `baseHeads`, which allows conflict-safe review later. Preview review computes:

- semantic slide changes;
- element additions/removals;
- geometry/presentation/content changes;
- content facets such as media/appearance/hierarchy/text-data;
- theme changes;
- Slide Master changes;
- changed artifact kinds.

Automatic Accept is blocked when:

- the target branch changed after the preview fork;
- fork-base metadata is unavailable;
- the preview changed artifact kinds without a supported composite merge path, such as component artifacts.

The system refuses partial silent merges.

## Accept / Return

`Accept` requires the exact target and preview runtime deck hashes from the just-reviewed diff.

For supported previews:

- deck changes become one new target-branch deck version;
- motion changes enter the independent target motion history;
- QA is regenerated;
- the preview branch remains available for audit.

`Return` simply checks out the original branch. The preview is preserved rather than deleted.

## Execution audits

Every executed Director run writes an immutable branch-local `creativeRun` artifact containing:

- server-issued plan;
- validation result;
- concrete canonical actions;
- before/after deck hash for every action;
- action success/error reason;
- post-review;
- acceptance/rejection state;
- preview rollback state.

This is exposed in the editor `Runs` drawer and through MCP run-history tools.

## Editor surfaces

The live editor adds:

- `Director` — production review, Safe Fixes, scoped request and guarded plan;
- Creative Preview review bar — object/system diff and Accept / Return;
- `Runs` — inspectable AI execution history.

These are additive layers over the same editor canvas.

## Unified MCP families

Creative Director adds:

- `pitch_creative_review`;
- `pitch_creative_safe_fix_preview` / `pitch_creative_safe_fix_apply`;
- `pitch_creative_plan`;
- `pitch_creative_plan_status`;
- `pitch_creative_execute`;
- `pitch_creative_preview_review`;
- `pitch_creative_preview_accept`;
- `pitch_creative_preview_discard`;
- `pitch_creative_runs`;
- `pitch_creative_run`.

## Completion rule

A Creative Director change is not complete because the requested canonical calls succeeded. It is complete only when:

1. the execution stayed inside approved scope;
2. post-review found no new unacceptable regressions;
3. evidence and canonical editability remain intact;
4. high-risk work was explicitly accepted from preview or deliberately approved for direct write;
5. the run audit is available for inspection.
