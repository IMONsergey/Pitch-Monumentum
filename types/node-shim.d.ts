declare const process: {
  argv: string[];
  cwd(): string;
  exitCode?: number;
  env: Record<string, string | undefined>;
};

declare const Buffer: any;
type Buffer = any;

declare module "node:fs/promises" {
  export const mkdir: any;
  export const readFile: any;
  export const writeFile: any;
  export const rename: any;
  export const readdir: any;
  export const stat: any;
  export const rm: any;
  export const access: any;
  export const copyFile: any;
}
declare module "node:path" {
  export const join: any;
  export const resolve: any;
  export const dirname: any;
  export const relative: any;
  export const extname: any;
  export const basename: any;
}
declare module "node:crypto" { export const createHash: any; export const randomUUID: any; }
declare module "node:http" { export const createServer: any; }
declare module "node:assert/strict" { const assert: any; export default assert; }
declare module "node:test" { const test: any; export default test; }
declare module "node:child_process" { export const spawn: any; }
declare module "node:readline" { export const createInterface: any; }
declare module "node:events" { export class EventEmitter { on: any; emit: any; off: any; } }

declare module "node:zlib" { export const inflateRawSync: any; }
