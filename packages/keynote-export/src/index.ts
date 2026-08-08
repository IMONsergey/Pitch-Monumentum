import { execFile } from "node:child_process";
import { access, mkdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult { stdout: string; stderr: string; }
export type KeynoteCommandRunner = (file: string, args: string[]) => Promise<CommandResult>;

export interface KeynoteAvailability {
  platform: NodeJS.Platform;
  supportedPlatform: boolean;
  keynoteInstalled: boolean;
  bundleId?: string;
  reason?: string;
}

export interface KeynoteConversionResult {
  inputPptxPath: string;
  outputKeyPath: string;
  bytes: number;
  availability: KeynoteAvailability;
  adapterStatus: "adapter-unverified";
}

const DEFAULT_RUNNER: KeynoteCommandRunner = async (file, args) => {
  const result = await execFileAsync(file, args, { maxBuffer: 2 * 1024 * 1024 });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

export const KEYNOTE_SAVE_SCRIPT = String.raw`
on run argv
  if (count of argv) is not 2 then error "Pitch Keynote adapter requires input PPTX and output KEY paths"
  set inputPath to item 1 of argv
  set outputPath to item 2 of argv
  set sourceFile to POSIX file inputPath
  set destinationFile to POSIX file outputPath
  tell application "Keynote"
    activate
    set openedDocument to open sourceFile
    save openedDocument in destinationFile
    close openedDocument saving no
  end tell
  return outputPath
end run
`.trim();

export async function keynoteAvailability(input: { platform?: NodeJS.Platform; runner?: KeynoteCommandRunner } = {}): Promise<KeynoteAvailability> {
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin") return { platform, supportedPlatform: false, keynoteInstalled: false, reason: "Keynote conversion requires macOS with Apple Keynote installed." };
  const runner = input.runner ?? DEFAULT_RUNNER;
  try {
    const result = await runner("/usr/bin/osascript", ["-e", "id of application \"Keynote\""]);
    const bundleId = result.stdout.trim();
    return { platform, supportedPlatform: true, keynoteInstalled: bundleId.length > 0, bundleId: bundleId || undefined, reason: bundleId ? undefined : "Keynote application id could not be resolved." };
  } catch (error) {
    return { platform, supportedPlatform: true, keynoteInstalled: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function convertPptxToKeynote(
  inputPptxPath: string,
  outputKeyPath: string,
  options: { platform?: NodeJS.Platform; runner?: KeynoteCommandRunner } = {},
): Promise<KeynoteConversionResult> {
  const inputPath = resolve(inputPptxPath);
  const outputPath = resolve(outputKeyPath);
  if (extname(inputPath).toLowerCase() !== ".pptx") throw new Error("Keynote adapter input must be a .pptx file");
  if (extname(outputPath).toLowerCase() !== ".key") throw new Error("Keynote adapter output must use .key extension");
  await access(inputPath);
  const availability = await keynoteAvailability(options);
  if (!availability.supportedPlatform || !availability.keynoteInstalled) throw new Error(availability.reason ?? "Apple Keynote is unavailable");
  await mkdir(dirname(outputPath), { recursive: true });
  const runner = options.runner ?? DEFAULT_RUNNER;
  await runner("/usr/bin/osascript", ["-e", KEYNOTE_SAVE_SCRIPT, "--", inputPath, outputPath]);
  const info = await stat(outputPath).catch(() => undefined);
  if (!info) throw new Error(`Keynote did not create output document: ${outputPath}`);
  if (!info.isFile() && !info.isDirectory()) throw new Error(`Unexpected Keynote output type: ${outputPath}`);
  return { inputPptxPath: inputPath, outputKeyPath: outputPath, bytes: info.size, availability, adapterStatus: "adapter-unverified" };
}
