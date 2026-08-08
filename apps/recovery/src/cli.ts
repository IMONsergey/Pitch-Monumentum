import { resolve } from "node:path";
import { createProjectBackup, restoreProjectBackupAsClone } from "../../../packages/project-backup/src/index.js";
import { runProjectDoctor } from "../../../packages/project-doctor/src/index.js";

async function main() {
  const [command = "doctor", first = ".pitch-demo", second] = process.argv.slice(2);
  if (command === "doctor") {
    const report = await runProjectDoctor(resolve(first));
    console.log(JSON.stringify(report, null, 2));
    if (!report.summary.healthy) process.exitCode = 2;
    return;
  }
  if (command === "backup") {
    const result = await createProjectBackup(resolve(first), { backupRoot: second ? resolve(second) : undefined });
    console.log(JSON.stringify({ backupPath: result.backupPath, projectPath: result.projectPath, metadata: result.metadata, doctorSummary: result.doctor.summary }, null, 2));
    return;
  }
  if (command === "restore") {
    if (!second) throw new Error("restore requires <backup-path> <new-project-directory>");
    const result = await restoreProjectBackupAsClone(resolve(first), resolve(second));
    console.log(JSON.stringify({ projectRoot: result.projectRoot, metadata: result.metadata, doctorSummary: result.doctor.summary }, null, 2));
    if (!result.doctor.summary.healthy) process.exitCode = 2;
    return;
  }
  throw new Error(`Unknown recovery command ${command}. Use doctor | backup | restore.`);
}

if (process.argv[1]?.endsWith("cli.js")) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
