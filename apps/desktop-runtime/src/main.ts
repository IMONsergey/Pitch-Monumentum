import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MessageBoxOptions, type OpenDialogOptions } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createFullWorkspaceServer } from "../../workspace/src/full-server.js";
import { ensureDesktopPreviewProject } from "../../../packages/project-bootstrap/src/index.js";
import type { DeliveryRuntime } from "../../delivery/src/runtime.js";
import { exportDesktopPdf, exportDesktopPngSlides } from "./static-render.js";

interface DesktopState {
  schemaVersion: "0.3";
  recentProjectRoot?: string;
}

let mainWindow: BrowserWindow | null = null;
let workspaceServer: Server | null = null;
let delivery: DeliveryRuntime | null = null;
let workspaceUrl = "";
let currentProjectRoot = "";

function statePath(): string { return join(app.getPath("userData"), "desktop-state-v3.json"); }
function preloadPath(): string { return join(app.getAppPath(), "dist", "apps", "desktop-runtime", "src", "preload.js"); }
function exportDir(): string { return join(currentProjectRoot, ".project", "exports"); }

async function readDesktopState(): Promise<DesktopState> {
  try { return JSON.parse(await readFile(statePath(), "utf8")) as DesktopState; }
  catch { return { schemaVersion: "0.3" }; }
}
async function writeDesktopState(state: DesktopState): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
async function showMessage(options: MessageBoxOptions): Promise<void> {
  if (mainWindow) await dialog.showMessageBox(mainWindow, options); else await dialog.showMessageBox(options);
}
async function showOpenDialog(options: OpenDialogOptions) { return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options); }
async function isPitchProject(root: string): Promise<boolean> {
  try { const manifest = JSON.parse(await readFile(join(root, ".project", "manifest.json"), "utf8")); return Boolean(manifest?.projectId && manifest?.activeBranchId && manifest?.branches); }
  catch { return false; }
}
async function closeWorkspaceServer(): Promise<void> {
  const server = workspaceServer; workspaceServer = null; delivery = null; workspaceUrl = "";
  if (!server?.listening) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
async function startWorkspace(projectRoot: string): Promise<void> {
  await closeWorkspaceServer();
  const created = createFullWorkspaceServer(projectRoot);
  workspaceServer = created.server;
  delivery = created.delivery;
  await new Promise<void>((resolveListen, reject) => { created.server.once("error", reject); created.server.listen(0, "127.0.0.1", () => resolveListen()); });
  const address = created.server.address() as AddressInfo;
  workspaceUrl = `http://127.0.0.1:${address.port}`; currentProjectRoot = resolve(projectRoot);
  await writeDesktopState({ schemaVersion: "0.3", recentProjectRoot: currentProjectRoot });
}
async function loadCurrentProject(): Promise<void> {
  if (!mainWindow || !workspaceUrl) return;
  await mainWindow.loadURL(`${workspaceUrl}/editor-spike`);
  mainWindow.setTitle(`Pitch Monumentum — ${currentProjectRoot.split(/[\\/]/).pop() || "Project"}`);
}
async function switchProject(projectRoot: string): Promise<void> { await startWorkspace(projectRoot); await loadCurrentProject(); installMenu(); }
async function chooseProject(): Promise<void> {
  const result = await showOpenDialog({ title: "Open Pitch Monumentum Project", buttonLabel: "Open Project", properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return;
  const root = result.filePaths[0];
  if (!(await isPitchProject(root))) { await showMessage({ type: "warning", title: "Not a Pitch project", message: "This folder does not contain a Pitch Monumentum .project/manifest.json.", detail: "Choose an existing Pitch project folder, or open the built-in Desktop Preview project." }); return; }
  await switchProject(root);
}
function previewRoot(): string { return join(app.getPath("userData"), "Desktop Preview Project v3"); }
async function openPreviewProject(reset = false): Promise<void> {
  const root = previewRoot(); if (reset) await rm(root, { recursive: true, force: true });
  await ensureDesktopPreviewProject(root); await switchProject(root);
}
function assertRevealable(path: string): string {
  const absolute = resolve(path); const root = resolve(exportDir());
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error("Only current project delivery artifacts can be revealed");
  return absolute;
}
async function runDelivery(label: string, action: () => Promise<{ path?: string; artifact?: { path: string }; [key: string]: any }>): Promise<void> {
  try {
    const result = await action(); const path = result.artifact?.path ?? result.path;
    if (path) shell.showItemInFolder(assertRevealable(path));
  } catch (error) { await showMessage({ type: "error", title: `${label} failed`, message: error instanceof Error ? error.message : String(error) }); }
}
function requireDelivery(): DeliveryRuntime { if (!delivery) throw new Error("Delivery runtime is not ready"); return delivery; }

function installIpc(): void {
  ipcMain.removeHandler("pitch:delivery:pdf"); ipcMain.removeHandler("pitch:delivery:png"); ipcMain.removeHandler("pitch:delivery:reveal");
  ipcMain.handle("pitch:delivery:pdf", async () => exportDesktopPdf(requireDelivery()));
  ipcMain.handle("pitch:delivery:png", async () => exportDesktopPngSlides(requireDelivery()));
  ipcMain.handle("pitch:delivery:reveal", async (_event, path: string) => { const safe = assertRevealable(path); shell.showItemInFolder(safe); return safe; });
}

function installMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: "Pitch Monumentum", submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
    { label: "File", submenu: [
      { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => void chooseProject() },
      { label: "Open Desktop Preview", accelerator: "CmdOrCtrl+Shift+O", click: () => void openPreviewProject(false) },
      { label: "Reset Desktop Preview", click: () => void openPreviewProject(true) },
      { type: "separator" },
      { label: "Export PPTX", accelerator: "CmdOrCtrl+E", click: () => void runDelivery("PowerPoint export", () => requireDelivery().exportPptx()) },
      { label: "Export Figma Bridge JSON", click: () => void runDelivery("Figma Bridge export", () => requireDelivery().exportFigma()) },
      { label: "Export Standalone Web", click: () => void runDelivery("Web export", () => requireDelivery().exportWeb()) },
      { label: "Export Keynote…", click: () => void runDelivery("Keynote export", () => requireDelivery().exportKeynote()) },
      { type: "separator" },
      { label: "Export PDF (Desktop)", click: () => void runDelivery("PDF export", () => exportDesktopPdf(requireDelivery())) },
      { label: "Export PNG Slide Set (Desktop)", click: () => void runDelivery("PNG export", () => exportDesktopPngSlides(requireDelivery())) },
      { type: "separator" },
      { label: "Show Project in Finder", enabled: Boolean(currentProjectRoot), click: () => { if (currentProjectRoot) shell.showItemInFolder(join(currentProjectRoot, ".project", "manifest.json")); } },
      { role: "close" },
    ] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Presentation", submenu: [{ label: "Present from Current Slide", accelerator: "CmdOrCtrl+Return", click: () => void mainWindow?.webContents.executeJavaScript("document.querySelector('.pitch-present-toggle')?.click()") }] },
    { role: "windowMenu" },
    { label: "Help", submenu: [{ label: "Pitch Monumentum on GitHub", click: () => void shell.openExternal("https://github.com/IMONsergey/Pitch-Monumentum") }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1640, height: 1040, minWidth: 1220, minHeight: 780, backgroundColor: "#090B0E", titleBarStyle: "hiddenInset", show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: preloadPath() },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  const state = await readDesktopState();
  if (state.recentProjectRoot && await isPitchProject(state.recentProjectRoot)) await startWorkspace(state.recentProjectRoot);
  else { await ensureDesktopPreviewProject(previewRoot()); await startWorkspace(previewRoot()); }
  installMenu(); installIpc(); await loadCurrentProject();
}

app.setName("Pitch Monumentum");
app.whenReady().then(async () => { try { process.chdir(app.getAppPath()); } catch {} await createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); }); }).catch((error) => { console.error(error); app.quit(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { void closeWorkspaceServer(); });
