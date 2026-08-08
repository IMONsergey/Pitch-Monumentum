import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const builder = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
if (!existsSync(builder)) throw new Error("electron-builder is not installed. Run npm install first.");

execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
execFileSync(builder, ["--config", "electron-builder.next.yml", "--mac", "dmg", "--x64"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
});
