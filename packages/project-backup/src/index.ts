import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { ArtifactStore } from "../../artifact-store/src/index.js";
import { inspectFilesystemArtifact } from "../../fs-artifact/src/index.js";
import { runProjectDoctor, type ProjectDoctorReport } from "../../project-doctor/src/index.js";

export interface ProjectBackupMetadata {
  schemaVersion: "0.1";
  createdAt: string;
  source: {
    projectRoot: string;
    projectId: string;
    projectName: string;
    activeBranchId: string;
  };
  canonicalSnapshot: {
    relativePath: "project/.project";
    bytes: number;
    fileCount: number;
    sha256: string;
    exportsExcluded: true;
  };
  doctor: {
    healthy: boolean;
    blocker: number;
    warning: number;
    info: number;
    reportFile: "PROJECT-DOCTOR.json";
  };
}

export interface ProjectBackupResult {
  backupPath: string;
  projectPath: string;
  metadataPath: string;
  doctorPath: string;
  metadata: ProjectBackupMetadata;
  doctor: ProjectDoctorReport;
}

export interface CreateProjectBackupOptions {
  backupRoot?: string;
  label?: string;
}

function safeSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "pitch-project";
}
function stamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
function insideExports(sourceProjectRoot: string, source: string): boolean {
  const exportsRoot = resolve(sourceProjectRoot, ".project", "exports");
  const candidate = resolve(source);
  return candidate === exportsRoot || candidate.startsWith(`${exportsRoot}/`);
}

export async function createProjectBackup(projectRoot: string, options: CreateProjectBackupOptions = {}): Promise<ProjectBackupResult> {
  const root = resolve(projectRoot);
  const store = new ArtifactStore(root);
  const manifest = await store.readManifest();
  const backupRoot = resolve(options.backupRoot ?? join(dirname(root), ".pitch-backups"));
  await mkdir(backupRoot, { recursive: true });

  const label = safeSegment(options.label || manifest.name || basename(root));
  const name = `${label}-${stamp()}-${randomUUID().slice(0, 6)}`;
  const temp = join(backupRoot, `.tmp-${name}`);
  const finalPath = join(backupRoot, name);
  const projectPath = join(temp, "project");
  const sourceProjectDir = join(root, ".project");
  const destinationProjectDir = join(projectPath, ".project");

  await rm(temp, { recursive: true, force: true });
  await mkdir(projectPath, { recursive: true });
  try {
    await cp(sourceProjectDir, destinationProjectDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
      filter: (source) => !insideExports(root, source),
    });

    const doctor = await runProjectDoctor(projectPath);
    const inspected = await inspectFilesystemArtifact(destinationProjectDir);
    const metadata: ProjectBackupMetadata = {
      schemaVersion: "0.1",
      createdAt: new Date().toISOString(),
      source: { projectRoot: root, projectId: manifest.projectId, projectName: manifest.name, activeBranchId: manifest.activeBranchId },
      canonicalSnapshot: { relativePath: "project/.project", bytes: inspected.bytes, fileCount: inspected.fileCount, sha256: inspected.sha256, exportsExcluded: true },
      doctor: { healthy: doctor.summary.healthy, blocker: doctor.summary.blocker, warning: doctor.summary.warning, info: doctor.summary.info, reportFile: "PROJECT-DOCTOR.json" },
    };
    const doctorPath = join(temp, "PROJECT-DOCTOR.json");
    const metadataPath = join(temp, "BACKUP-METADATA.json");
    await writeFile(doctorPath, `${JSON.stringify(doctor, null, 2)}\n`, "utf8");
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await rename(temp, finalPath);
    return {
      backupPath: finalPath,
      projectPath: join(finalPath, "project"),
      metadataPath: join(finalPath, "BACKUP-METADATA.json"),
      doctorPath: join(finalPath, "PROJECT-DOCTOR.json"),
      metadata,
      doctor,
    };
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function restoreProjectBackupAsClone(backupPath: string, destinationRoot: string): Promise<{ projectRoot: string; doctor: ProjectDoctorReport; metadata: ProjectBackupMetadata }> {
  const backup = resolve(backupPath);
  const destination = resolve(destinationRoot);
  const sourceProject = join(backup, "project", ".project");
  const destinationProject = join(destination, ".project");
  const sourceStat = await stat(sourceProject).catch(() => undefined);
  if (!sourceStat?.isDirectory()) throw new Error(`Backup has no canonical project directory: ${sourceProject}`);
  const existing = await stat(destinationProject).catch(() => undefined);
  if (existing) throw new Error(`Restore destination already contains .project: ${destinationProject}`);

  const metadata = JSON.parse(await readFile(join(backup, "BACKUP-METADATA.json"), "utf8")) as ProjectBackupMetadata;
  await mkdir(destination, { recursive: true });
  try {
    await cp(sourceProject, destinationProject, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
    const inspected = await inspectFilesystemArtifact(destinationProject);
    if (inspected.sha256 !== metadata.canonicalSnapshot.sha256 || inspected.bytes !== metadata.canonicalSnapshot.bytes || inspected.fileCount !== metadata.canonicalSnapshot.fileCount) {
      throw new Error("Restored project bytes do not match backup metadata");
    }
    const doctor = await runProjectDoctor(destination);
    return { projectRoot: destination, doctor, metadata };
  } catch (error) {
    await rm(destinationProject, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
