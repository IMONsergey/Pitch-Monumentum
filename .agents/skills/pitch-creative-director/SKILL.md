---
name: pitch-creative-director
description: Plan, execute, review and accept high-quality Pitch Monumentum changes through the guarded Creative Director production loop. Use for broad polish, art direction, brand/layout/media/system work, quality review, high-risk preview branches, deterministic safe fixes, and inspectable AI execution audits. Do not bypass canonical Pitch tools or invent trusted plans client-side.
---

# Pitch Creative Director

## Core rule

Creative Director controls canonical Pitch tools; it never replaces them.

For wide or quality-sensitive work, prefer:

`review → server-issued plan → concrete canonical actions → guarded execute → post-review → preview review/accept if needed`.

## Review first

Use `pitch_creative_review` before broad changes.

Treat all quality lanes as real constraints:
- structure;
- evidence;
- visual;
- brand;
- editability;
- assets;
- masters;
- motion.

Do not trade factual/evidence integrity for a better visual score.

## Safe fixes

Use `pitch_creative_safe_fix_preview` before `pitch_creative_safe_fix_apply`.

Safe fixes are deliberately narrow: exact literal styling values can be bound to exactly equal live design tokens. They must remain visually neutral and are committed as one Undo point.

Do not call arbitrary edits “safe fixes.”

## Planning

Call `pitch_creative_plan` with:
- unique request id;
- clear outcome-oriented instruction;
- explicit intents;
- explicit scope;
- preserve constraints when relevant;
- only the global/narrative/evidence permissions genuinely granted by the user.

Never fabricate a trusted Creative Director plan. The server-issued plan is bound to the current branch/deck hash.

If the deck changes, treat the plan as stale and re-plan.

## Concrete actions

Translate edit steps into the existing canonical tool families:
- editor → `pitch_editor_command`;
- media → `pitch_media_command`;
- design → `pitch_design_command`;
- component → `pitch_component_command`;
- master → `pitch_master_command`;
- motion → `pitch_motion_command`.

Keep action arguments within the plan's exact slide/object scope.

Global operations such as deck token changes, master propagation and component-master refresh must not be hidden inside a local scope.

## High-risk execution

High-risk/global changes should use the default preview-branch mode.

Only use direct high-risk current-branch write when the user explicitly approved that behavior and the execution bundle marks it accordingly.

Use explicit step approval IDs for steps marked `requiresExplicitApproval`.

## Preview review

After preview execution:
1. call `pitch_creative_preview_review`;
2. inspect semantic/object/system diff and changed artifact kinds;
3. inspect blockers;
4. accept only with exact reviewed target/preview hashes;
5. otherwise return to the original branch with `pitch_creative_preview_discard`.

A blocked auto-merge is a safety result, not an invitation to manually overwrite the target.

## Execution audits

Use `pitch_creative_runs` and `pitch_creative_run` when investigating what an agent changed.

Audit records include:
- plan;
- validation;
- concrete actions;
- per-action deck hashes;
- post-review;
- acceptance/rejection/rollback/error state.

Do not infer execution details from conversational memory when an audit exists.

## Completion

A broad creative task is complete only after post-review and, for preview work, explicit preview acceptance or deliberate return. Tool success alone is not completion.
