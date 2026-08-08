# Pitch Project Doctor

Project Doctor is the deterministic integrity scanner for Pitch's on-disk canonical project/history.

It is deliberately separate from creative QA. A slide can look perfect while the underlying version graph is damaged; conversely a visually unfinished deck can have a completely healthy project store.

## Current scanner

`packages/project-doctor/src/index.ts`

Checks:

- manifest readability;
- active branch existence;
- branch parent existence;
- branch parent cycles;
- duplicate branch names (warning);
- ambiguous multiple deck heads on one branch;
- branch head artifact/version existence;
- branch head ↔ envelope identity/kind/version/hash agreement;
- payload SHA-256 recomputation through canonical `stableStringify`;
- envelope input artifact/version/hash existence;
- branch `baseHeads` existence/hash;
- manifest latest artifact metadata;
- VersionJournal branch/artifact entries;
- VersionJournal cursor bounds;
- VersionJournal historical artifact/hash existence.

CLI runtime:

`apps/project-doctor/src/cli.ts`

After a build:

```bash
node dist/apps/project-doctor/src/cli.js <project-root> [optional-report.json]
```

Exit codes:

- `0` — no Project Doctor blockers;
- `2` — scanner ran successfully but project integrity has blockers;
- `1` — scanner itself failed.

## No destructive auto-repair

Project Doctor currently does **not** rewrite:

- manifest heads;
- artifact envelopes;
- branch ancestry;
- version journal;
- checkpoints;
- assets.

That is intentional.

A hash mismatch means the immutable history evidence is inconsistent. Automatically replacing a hash or discarding a version can hide the original failure and make later review/merge logic untrustworthy.

The repair workflow should be:

1. run Project Doctor;
2. save the report;
3. make a filesystem backup of the project;
4. classify the failure;
5. generate a proposed repair plan;
6. preview exact files/heads that would change;
7. require explicit human approval;
8. perform repair into a new recovery branch/project when possible;
9. rerun Doctor + normal QA.

## Planned integration

Project Doctor should become a System Health lane after the stacked rebase/CI pass.

Recommended semantics:

- Doctor blocker → `editingReady=false`;
- Doctor warning → health warning;
- no Doctor blocker → canonical store structurally healthy.

The Full release validation should run Doctor against the temporary Desktop Preview project during post-build smoke.

## What Doctor does not replace

Project Doctor does not replace:

- deterministic slide QA;
- Brand QA;
- Master QA;
- Motion integrity;
- Review/approval governance;
- Delivery snapshot checks;
- real application fidelity validation.

It answers one narrower question: **can the canonical project/history be trusted as stored?**
