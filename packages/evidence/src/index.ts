export type DependencyNodeKind = "source" | "anchor" | "evidence" | "claim" | "slide" | "element" | "export";
export interface DependencyNode { id: string; kind: DependencyNodeKind; status: "valid" | "stale" | "needsVerification"; }
export interface DependencyEdge { from: string; to: string; }
export interface DependencyGraph { nodes: DependencyNode[]; edges: DependencyEdge[]; }

export function descendants(graph: DependencyGraph, changedIds: string[]): Set<string> {
  const result = new Set<string>(); const queue = [...changedIds]; const seen = new Set(changedIds);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.edges) {
      if (edge.from !== current || seen.has(edge.to)) continue;
      seen.add(edge.to); result.add(edge.to); queue.push(edge.to);
    }
  }
  return result;
}

export function propagateStale(graph: DependencyGraph, changedIds: string[]): DependencyGraph {
  const nodes = graph.nodes.map((n) => ({ ...n })); const byId = new Map(nodes.map((n) => [n.id, n]));
  const affected = descendants(graph, changedIds);
  for (const id of changedIds) { const n = byId.get(id); if (n) n.status = n.kind === "source" ? "needsVerification" : "stale"; }
  for (const id of affected) { const n = byId.get(id); if (n) n.status = n.kind === "evidence" || n.kind === "anchor" ? "needsVerification" : "stale"; }
  return { nodes, edges: graph.edges.map((e) => ({ ...e })) };
}

export function affectedSlides(graph: DependencyGraph, changedIds: string[]): string[] {
  const affected = descendants(graph, changedIds); return graph.nodes.filter((n) => n.kind === "slide" && affected.has(n.id)).map((n) => n.id);
}

export * from "./candidates.js";
