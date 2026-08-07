export type Id<T extends string = string> = string & { readonly __brand?: T };
export type ArtifactStatus = "pending" | "running" | "ready" | "stale" | "failed" | "needsReview";

export interface ArtifactRef { id: string; kind: string; version: number; contentHash: string; }
export interface ArtifactProducer { type: "user" | "codex" | "deterministic"; threadId?: string; stageRunId?: string; }
export interface ArtifactEnvelope<T> {
  id: string; kind: string; schemaVersion: string; version: number; contentHash: string;
  createdAt: string; producer: ArtifactProducer; inputs: ArtifactRef[]; status: ArtifactStatus; payload: T;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function assertNever(value: never): never { throw new Error(`Unexpected value: ${String(value)}`); }
