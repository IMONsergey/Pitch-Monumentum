import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { runProjectDoctor } from "../../../packages/project-doctor/src/index.js";

export async function runProjectDoctorCli(projectRoot: string, outputPath?: string) {
  const root = resolve(projectRoot);
  const report = await runProjectDoctor(root);
  if (outputPath) await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

if (process.argv[1]?.endsWith("cli.js")) {
  const root = process.argv[2] ?? ".pitch-demo";
  const output = process.argv[3];
  runProjectDoctorCli(root, output).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.summary.healthy) process.exitCode = 2;
  }).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
