# Pitch Project Recovery — Doctor, backup, clone restore

Recovery is the data-safety layer around Pitch's canonical `.project` history.

## Components

- `packages/project-doctor` — integrity scanner;
- `packages/project-backup` — non-destructive canonical snapshots;
- `apps/project-doctor/src/cli.ts` — Doctor-only CLI;
- `apps/recovery/src/cli.ts` — `doctor / backup / restore` operations.

## Backup semantics

A Recovery Snapshot:

- copies the canonical `.project` directory;
- excludes `.project/exports` because delivery artifacts are derived outputs;
- preserves artifact/version files and timestamps;
- runs Project Doctor on the copied snapshot;
- stores `PROJECT-DOCTOR.json` even when the source is corrupted;
- computes deterministic SHA-256, bytes and fileCount for the copied canonical `.project` tree;
- writes `BACKUP-METADATA.json` next to the copied project;
- is created in a sibling backup root by default, never inside the source `.project` tree.

A corrupt source is **still backed up**. Backup is evidence preservation, not a reward for a healthy project.

## Restore semantics

Restore never writes over the active project.

`restoreProjectBackupAsClone()`:

1. requires a destination that does not already contain `.project`;
2. copies the canonical snapshot;
3. recomputes SHA/bytes/fileCount and requires an exact metadata match;
4. reruns Project Doctor on the restored clone;
5. returns the clone path + Doctor report.

The restored clone intentionally preserves the original `projectId` and immutable history. It is a filesystem recovery copy, not a new logical Pitch project fork.

## CLI

After build:

```bash
# inspect
node dist/apps/recovery/src/cli.js doctor /path/to/project

# backup
node dist/apps/recovery/src/cli.js backup /path/to/project [/optional/backup/root]

# restore into a NEW directory
node dist/apps/recovery/src/cli.js restore /path/to/backup /path/to/new-project-copy
```

A Doctor blocker returns process exit code `2`; scanner/runtime failure returns `1`.

## Future repair engine rule

No destructive repair should be implemented without this sequence:

```text
Doctor
→ Recovery Snapshot
→ proposed repair plan
→ exact file/head diff
→ human approval
→ repair in recovery branch/copy
→ Doctor again
→ normal QA
```

Examples of repairs that require this protocol:

- manifest head reconstruction;
- VersionJournal cursor/history surgery;
- orphan artifact relinking;
- `groupId` / `childIds` hierarchy migration;
- branch ancestry correction;
- asset catalog reconstruction.

## System Health integration

After the stacked rebase/CI pass, Project Doctor should become a System Health lane:

- Doctor blocker → editing blocked;
- Doctor warning → Health warning;
- healthy Doctor → canonical on-disk history trusted.

The post-build Full runtime smoke should run Doctor against the temporary Desktop Preview project as an additional release gate.
