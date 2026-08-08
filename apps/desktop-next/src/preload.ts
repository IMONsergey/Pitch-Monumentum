import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pitchDesktop", {
  exportPdf: () => ipcRenderer.invoke("pitch:delivery:pdf"),
  exportPng: () => ipcRenderer.invoke("pitch:delivery:png"),
  reveal: (path: string) => ipcRenderer.invoke("pitch:delivery:reveal", path),
  platform: process.platform,
});
