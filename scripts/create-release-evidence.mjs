import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const releaseDir = resolve(process.argv[2] || "release-full");
const files = await readdir(releaseDir);
const dmgName = files.filter((name) => name.endsWith(".dmg")).sort()[0];
if (!dmgName) throw new Error(`No DMG found in ${releaseDir}`);

const dmgPath = join(releaseDir, dmgName);
const dmgBytes = await readFile(dmgPath);
const dmgSha256 = createHash("sha256").update(dmgBytes).digest("hex");
const architecture = await readFile(join(releaseDir, "ARCHITECTURE.txt"), "utf8").catch(() => "");
const verification = await readFile(join(releaseDir, "DMG-VERIFICATION.txt"), "utf8").catch(() => "");
const sums = await readFile(join(releaseDir, "SHA256SUMS.txt"), "utf8").catch(() => "");
const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8"));

if (!architecture.includes("x86_64")) throw new Error("ARCHITECTURE.txt does not prove x86_64");
if (!verification.includes("desktop_full_entry=present")) throw new Error("DMG-VERIFICATION.txt does not prove Desktop Full entry presence");
if (!verification.includes("system_health=present")) throw new Error("DMG-VERIFICATION.txt does not prove System Health presence");
if (!verification.includes("full_mcp=present")) throw new Error("DMG-VERIFICATION.txt does not prove Full MCP presence");
if (!sums.includes(dmgSha256) || !sums.includes(dmgName)) throw new Error("SHA256SUMS.txt does not match the actual DMG bytes");

const evidence = {
  schemaVersion: "0.1",
  product: "Pitch Monumentum",
  productVersion: pkg.version,
  createdAt: new Date().toISOString(),
  source: {
    githubSha: process.env.GITHUB_SHA || null,
    githubRef: process.env.GITHUB_REF || null,
    githubRunId: process.env.GITHUB_RUN_ID || null,
    githubRunNumber: process.env.GITHUB_RUN_NUMBER || null,
    githubWorkflow: process.env.GITHUB_WORKFLOW || null,
    repository: process.env.GITHUB_REPOSITORY || "IMONsergey/Pitch-Monumentum",
  },
  buildEnvironment: {
    runnerOs: process.env.RUNNER_OS || process.platform,
    runnerArch: process.env.RUNNER_ARCH || process.arch,
    node: process.versions.node,
  },
  artifact: {
    filename: basename(dmgPath),
    bytes: dmgBytes.length,
    sha256: dmgSha256,
    targetPlatform: "darwin",
    targetArch: "x64",
  },
  verification: {
    architectureReport: "ARCHITECTURE.txt",
    checksumFile: "SHA256SUMS.txt",
    mountedDmgReport: "DMG-VERIFICATION.txt",
    x86_64: true,
    desktopFullEntry: true,
    systemHealth: true,
    fullMcp: true,
    signed: false,
    notarized: false,
  },
  externalGates: {
    realIntelMacSmoke: false,
    figmaCorpus: false,
    keynoteCorpus: false,
  },
};

const output = join(releaseDir, "RELEASE-EVIDENCE.json");
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, output, artifact: evidence.artifact, source: evidence.source }, null, 2));
