import { createDeliveryWorkspaceServer } from "./delivery-server.js";

export const createPitchFullWorkspaceServer = createDeliveryWorkspaceServer;

if (process.argv[1]?.endsWith("full-server.js")) {
  const root = process.argv[2] ?? ".pitch-demo";
  const port = Number(process.argv[3] ?? "4173");
  const { server } = createPitchFullWorkspaceServer(root);
  server.listen(port, "127.0.0.1", () => console.log(`Pitch Monumentum Full Workspace: http://127.0.0.1:${port}/editor-spike`));
}
