import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const requiredAfterBuild = [
  "dist/apps/desktop-full/src/main.js",
  "dist/apps/desktop-next/src/main.js",
  "dist/apps/desktop-next/src/preload.js",
  "dist/apps/workspace/src/full-server.js",
  "dist/apps/workspace/src/delivery-server.js",
  "dist/apps/review/src/runtime.js",
  "dist/apps/versions/src/runtime.js",
  "dist/apps/creative-director/src/runtime.js",
  "dist/apps/pitch-mcp-full/src/server.js",
];
const requiredPublic = [
  "apps/workspace/public/editor-spike.js",
  "apps/workspace/public/design-system-ui.js",
  "apps/workspace/public/slide-masters-ui.js",
  "apps/workspace/public/creative-director-ui.js",
  "apps/workspace/public/creative-preview-ui.js",
  "apps/workspace/public/creative-runs-ui.js",
  "apps/workspace/public/versions-ui.js",
  "apps/workspace/public/review-ui.js",
  "apps/workspace/public/review-governance-ui.js",
  "apps/workspace/public/delivery-ui.js",
];

for (const path of requiredPublic) if (!existsSync(resolve(root, path))) throw new Error(`Missing full-stack public source: ${path}`);
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
for (const path of requiredAfterBuild) if (!existsSync(resolve(root, path))) throw new Error(`Build did not emit required full-stack entry: ${path}`);

const builder = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
if (!existsSync(builder)) throw new Error("electron-builder is not installed. Run npm install first.");
execFileSync(builder, ["--config", "electron-builder.full.yml", "--mac", "dmg", "--x64"], { cwd: root, stdio: "inherit", env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
