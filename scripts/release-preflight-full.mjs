import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const errors = [];
const warnings = [];
const required = [
  "package.json",
  "tsconfig.json",
  "electron-builder.full.yml",
  "electron-builder.core.yml",
  "scripts/package-desktop-full.mjs",
  ".github/workflows/desktop-full-macos.yml",
  "apps/workspace/src/full-server.ts",
  "apps/pitch-mcp-full/src/server.ts",
  "apps/desktop-full/src/main.ts",
  "apps/desktop-runtime/src/main.ts",
  "apps/desktop-runtime/src/preload.ts",
  "apps/desktop-runtime/src/static-render.ts",
  "apps/delivery/src/runtime.ts",
  "apps/review/src/runtime.ts",
  "apps/versions/src/runtime.ts",
  "apps/creative-director/src/runtime.ts",
  "packages/web-export/src/index.ts",
  "packages/figma-bridge/src/index.ts",
  "packages/keynote-export/src/index.ts",
  "packages/fs-artifact/src/index.ts",
];
const forbidden = [
  "electron-builder.next.yml",
  "electron-builder.next.safe.yml",
  "scripts/package-desktop-next.mjs",
  "scripts/package-desktop-next-safe.mjs",
  ".github/workflows/desktop-next-macos.yml",
];
const publicLayers = [
  "editor-spike.js",
  "design-system-ui.js",
  "slide-masters-ui.js",
  "creative-director-ui.js",
  "creative-preview-ui.js",
  "creative-runs-ui.js",
  "versions-ui.js",
  "review-ui.js",
  "review-governance-ui.js",
  "delivery-ui.js",
];

for (const path of required) if (!existsSync(resolve(root, path))) errors.push(`Missing required full-stack file: ${path}`);
for (const path of forbidden) if (existsSync(resolve(root, path))) errors.push(`Superseded packaging file must stay removed: ${path}`);
for (const name of publicLayers) if (!existsSync(resolve(root, "apps", "workspace", "public", name))) errors.push(`Missing public editor layer: ${name}`);

if (existsSync(resolve(root, "package.json"))) {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  if (pkg.version !== "0.3.0-preview.1") errors.push(`Expected product version 0.3.0-preview.1, got ${pkg.version}`);
  if (pkg.main !== "dist/apps/desktop-full/src/main.js") errors.push(`package.json main must target Desktop Full, got ${pkg.main}`);
  const scripts = pkg.scripts ?? {};
  if (!String(scripts.workspace ?? "").includes("full-server.js")) errors.push("npm run workspace must start Full Workspace");
  if (!String(scripts.desktop ?? "").includes("desktop-full/src/main.js")) errors.push("npm run desktop must start Desktop Full");
  if (!String(scripts["pitch:mcp"] ?? "").includes("pitch-mcp-full/src/server.js")) errors.push("npm run pitch:mcp must start Full MCP");
  if (!String(scripts["package:mac:x64"] ?? "").includes("package-desktop-full.mjs")) errors.push("package:mac:x64 must use the guarded Full packager");
  if (!String(scripts["release:preflight"] ?? "").includes("release-preflight-full.mjs")) errors.push("release:preflight must point at the Full source-tree preflight");
  if (!String(scripts["package:mac:x64:core"] ?? "").includes("electron-builder.core.yml")) errors.push("Core package command must use explicit legacy builder config");
}

if (existsSync(resolve(root, "electron-builder.full.yml"))) {
  const builder = readFileSync(resolve(root, "electron-builder.full.yml"), "utf8");
  if (!/main:\s*dist\/apps\/desktop-full\/src\/main\.js/.test(builder)) errors.push("electron-builder.full.yml main is not Desktop Full");
  if (!/arch:\s*\n\s*- x64/.test(builder)) errors.push("electron-builder.full.yml must target x64");
  if (/electronVersion\s*:/.test(builder)) errors.push("Do not hardcode an Electron version in the Full builder config");
}

if (existsSync(resolve(root, "electron-builder.core.yml"))) {
  const builder = readFileSync(resolve(root, "electron-builder.core.yml"), "utf8");
  if (!/main:\s*dist\/apps\/desktop\/src\/main\.js/.test(builder)) errors.push("electron-builder.core.yml must explicitly target legacy Desktop Core");
  if (/desktop-full\/src\/main\.js/.test(builder)) errors.push("Core builder must never inherit Desktop Full main");
}

if (existsSync(resolve(root, ".github/workflows/desktop-full-macos.yml"))) {
  const workflow = readFileSync(resolve(root, ".github/workflows/desktop-full-macos.yml"), "utf8");
  if (!/workflow_dispatch/.test(workflow)) errors.push("Desktop Full workflow must remain manual while the stack is unmerged");
  if (/^\s*pull_request\s*:/m.test(workflow) || /^\s*push\s*:/m.test(workflow)) errors.push("Desktop Full workflow must not add PR/push runner load before integration");
  if (!/runs-on:\s*macos-15-intel/.test(workflow)) errors.push("Desktop Full workflow must use the native Intel runner");
  if (!/grep -q 'x86_64'/.test(workflow)) errors.push("Desktop Full workflow must hard-gate packaged Mach-O architecture");
  if (!/shasum -a 256/.test(workflow)) errors.push("Desktop Full workflow must emit a DMG SHA-256 checksum");
}

warnings.push("PR #5 CI/DMG is an external prerequisite and cannot be proven by this source-tree preflight.");
warnings.push("Versions cross-branch restore fix is implemented but issue #8 remains open until sequential rebase + CI validates it.");
warnings.push("Keynote remains adapter-unverified until a real installed Keynote corpus passes issue #10.");
warnings.push("Figma Bridge remains real-app-unverified until the development plugin corpus passes issue #10.");
warnings.push("Desktop Full remains unverified until native Intel workflow + real Mac smoke test passes issue #9.");

const result = { ok: errors.length === 0, errors, warnings, checkedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
