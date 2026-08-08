import { app, BrowserWindow, dialog, Menu, shell, type MessageBoxOptions, type OpenDialogOptions } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createWorkspaceServer, type PitchWorkspaceService } from "../../workspace/src/server.js";
import { ensureDesktopPreviewProject } from "../../../packages/project-bootstrap/src/index.js";

interface DesktopState {
  schemaVersion: "0.1";
  recentProjectRoot?: string;
}

let mainWindow: BrowserWindow | null = null;
let workspaceServer: Server | null = null;
let workspaceService: PitchWorkspaceService | null = null;
let workspaceUrl = "";
let currentProjectRoot = "";

function statePath(): string {
  return join(app.getPath("userData"), "desktop-state.json");
}

async function readDesktopState(): Promise<DesktopState> {
  try {
    return JSON.parse(await readFile(statePath(), "utf8")) as DesktopState;
  } catch {
    return { schemaVersion: "0.1" };
  }
}

async function writeDesktopState(state: DesktopState): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function showMessage(options: MessageBoxOptions): Promise<void> {
  if (mainWindow) await dialog.showMessageBox(mainWindow, options);
  else await dialog.showMessageBox(options);
}

async function showOpenDialog(options: OpenDialogOptions) {
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options);
}

async function isPitchProject(root: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(root, ".project", "manifest.json"), "utf8"));
    return Boolean(manifest?.projectId && manifest?.activeBranchId && manifest?.branches);
  } catch {
    return false;
  }
}

async function closeWorkspaceServer(): Promise<void> {
  const server = workspaceServer;
  workspaceServer = null;
  workspaceService = null;
  workspaceUrl = "";
  if (!server?.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function startWorkspace(projectRoot: string): Promise<void> {
  await closeWorkspaceServer();
  const created = createWorkspaceServer(projectRoot);
  workspaceServer = created.server;
  workspaceService = created.service;
  await new Promise<void>((resolve, reject) => {
    created.server.once("error", reject);
    created.server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = created.server.address() as AddressInfo;
  workspaceUrl = `http://127.0.0.1:${address.port}`;
  currentProjectRoot = projectRoot;
  await writeDesktopState({ schemaVersion: "0.1", recentProjectRoot: projectRoot });
}

async function loadCurrentProject(): Promise<void> {
  if (!mainWindow || !workspaceUrl) return;
  await mainWindow.loadURL(`${workspaceUrl}/editor-spike`);
  mainWindow.setTitle(`Pitch Monumentum — ${currentProjectRoot.split("/").pop() || "Project"}`);
}

async function switchProject(projectRoot: string): Promise<void> {
  await startWorkspace(projectRoot);
  await loadCurrentProject();
  installMenu();
}

async function chooseProject(): Promise<void> {
  const result = await showOpenDialog({
    title: "Open Pitch Monumentum Project",
    buttonLabel: "Open Project",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return;
  const root = result.filePaths[0];
  if (!(await isPitchProject(root))) {
    await showMessage({
      type: "warning",
      title: "Not a Pitch project",
      message: "This folder does not contain a Pitch Monumentum .project/manifest.json.",
      detail: "Choose an existing Pitch project folder, or open the built-in Desktop Preview project.",
    });
    return;
  }
  await switchProject(root);
}

function previewRoot(): string {
  return join(app.getPath("userData"), "Desktop Preview Project");
}

async function openPreviewProject(reset = false): Promise<void> {
  const root = previewRoot();
  if (reset) await rm(root, { recursive: true, force: true });
  await ensureDesktopPreviewProject(root);
  await switchProject(root);
}

async function exportPptx(): Promise<void> {
  if (!workspaceService) return;
  try {
    const result = await workspaceService.exportPptx();
    shell.showItemInFolder(result.path);
  } catch (error) {
    await showMessage({
      type: "error",
      title: "Export failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function installMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Pitch Monumentum",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => void chooseProject() },
        { label: "Open Desktop Preview", accelerator: "CmdOrCtrl+Shift+O", click: () => void openPreviewProject(false) },
        { label: "Reset Desktop Preview", click: () => void openPreviewProject(true) },
        { type: "separator" },
        { label: "Export PPTX", accelerator: "CmdOrCtrl+E", click: () => void exportPptx() },
        { label: "Show Project in Finder", enabled: Boolean(currentProjectRoot), click: () => { if (currentProjectRoot) shell.showItemInFolder(join(currentProjectRoot, ".project", "manifest.json")); } },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Presentation",
      submenu: [
        {
          label: "Present from Current Slide",
          accelerator: "CmdOrCtrl+Return",
          click: () => void mainWindow?.webContents.executeJavaScript("document.querySelector('.pitch-present-toggle')?.click()"),
        },
      ],
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        { label: "Pitch Monumentum on GitHub", click: () => void shell.openExternal("https://github.com/IMONsergey/Pitch-Monumentum") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#090B0E",
    titleBarStyle: "hiddenInset",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });

  const state = await readDesktopState();
  if (state.recentProjectRoot && await isPitchProject(state.recentProjectRoot)) {
    await startWorkspace(state.recentProjectRoot);
  } else {
    await ensureDesktopPreviewProject(previewRoot());
    await startWorkspace(previewRoot());
  }
  installMenu();
  await loadCurrentProject();
}

app.setName("Pitch Monumentum");

app.whenReady().then(async () => {
  // The development preview is intentionally unpacked. This lets the existing workspace static
  // resolver keep using repository-relative paths. Production packaging can move to ASAR later.
  try { process.chdir(app.getAppPath()); } catch {}
  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => { void closeWorkspaceServer(); });
