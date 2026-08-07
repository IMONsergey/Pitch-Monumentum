import type { Claim, DeckDocument, EvidenceItem, SourceAnchor, SourceDocument } from "../../deck-model/src/index.js";

export type ContextHealth = "valid" | "stale" | "missing" | "scenario";
export interface ContextIndexIssue { severity: "major" | "critical"; code: string; message: string; refId?: string; }
export interface ContextIndex {
  schemaVersion: "0.1";
  sources: Record<string, SourceDocument>;
  anchors: Record<string, SourceAnchor>;
  evidence: Record<string, EvidenceItem>;
  claims: Record<string, Claim>;
  links: {
    evidenceToAnchors: Record<string, string[]>;
    claimToEvidence: Record<string, string[]>;
    slideToClaims: Record<string, string[]>;
    slideToEvidence: Record<string, string[]>;
    elementToClaims: Record<string, string[]>;
    elementToEvidence: Record<string, string[]>;
  };
  health: {
    sources: Record<string, ContextHealth>;
    anchors: Record<string, ContextHealth>;
    evidence: Record<string, ContextHealth>;
    claims: Record<string, ContextHealth>;
  };
  issues: ContextIndexIssue[];
}
export interface EvidenceTrace {
  claim?: Claim;
  evidence: Array<{ item: EvidenceItem; anchors: Array<{ anchor: SourceAnchor; source?: SourceDocument }> }>;
}
export interface ElementEvidenceTrace { slideId: string; elementId: string; claims: EvidenceTrace[]; directEvidence: EvidenceTrace["evidence"]; }
export interface StaleImpact { sourceIds: string[]; anchorIds: string[]; evidenceIds: string[]; claimIds: string[]; slideIds: string[]; elementIds: string[]; }

function unique(values: string[]): string[] { return [...new Set(values)]; }
export function buildContextIndex(input: { sources: SourceDocument[]; anchors: SourceAnchor[]; evidence: EvidenceItem[]; claims: Claim[]; deck: DeckDocument }): ContextIndex {
  const sources = Object.fromEntries(input.sources.map((item) => [item.id, structuredClone(item)]));
  const anchors = Object.fromEntries(input.anchors.map((item) => [item.id, structuredClone(item)]));
  const evidence = Object.fromEntries(input.evidence.map((item) => [item.id, structuredClone(item)]));
  const claims = Object.fromEntries(input.claims.map((item) => [item.id, structuredClone(item)]));
  const issues: ContextIndexIssue[] = [];
  const links: ContextIndex["links"] = { evidenceToAnchors: {}, claimToEvidence: {}, slideToClaims: {}, slideToEvidence: {}, elementToClaims: {}, elementToEvidence: {} };
  for (const item of input.anchors) if (!sources[item.sourceId]) issues.push({ severity: "critical", code: "anchor-source-missing", refId: item.id, message: `Anchor ${item.id} references missing source ${item.sourceId}` });
  for (const item of input.evidence) {
    links.evidenceToAnchors[item.id] = [...item.anchorIds];
    for (const id of item.anchorIds) if (!anchors[id]) issues.push({ severity: "critical", code: "evidence-anchor-missing", refId: item.id, message: `Evidence ${item.id} references missing anchor ${id}` });
  }
  for (const claim of input.claims) {
    links.claimToEvidence[claim.id] = [...claim.evidenceRefs];
    for (const id of claim.evidenceRefs) if (!evidence[id]) issues.push({ severity: "critical", code: "claim-evidence-missing", refId: claim.id, message: `Claim ${claim.id} references missing evidence ${id}` });
    if (claim.dataClass !== "scenario" && !claim.evidenceRefs.length) issues.push({ severity: "major", code: "claim-ungrounded", refId: claim.id, message: `Non-scenario claim ${claim.id} has no evidence` });
  }
  for (const slide of input.deck.slides) {
    links.slideToClaims[slide.id] = unique([...slide.semantic.claimIds, ...slide.scene.flatMap((element) => element.dependencies.filter((dep) => dep.kind === "claim").map((dep) => dep.id))]);
    links.slideToEvidence[slide.id] = unique([...slide.semantic.evidenceRefs, ...slide.scene.flatMap((element) => element.dependencies.filter((dep) => dep.kind === "evidence").map((dep) => dep.id))]);
    for (const element of slide.scene) {
      links.elementToClaims[element.id] = unique(element.dependencies.filter((dep) => dep.kind === "claim").map((dep) => dep.id));
      links.elementToEvidence[element.id] = unique(element.dependencies.filter((dep) => dep.kind === "evidence").map((dep) => dep.id));
      for (const id of links.elementToClaims[element.id]) if (!claims[id]) issues.push({ severity: "critical", code: "element-claim-missing", refId: element.id, message: `Element ${element.id} references missing claim ${id}` });
      for (const id of links.elementToEvidence[element.id]) if (!evidence[id]) issues.push({ severity: "critical", code: "element-evidence-missing", refId: element.id, message: `Element ${element.id} references missing evidence ${id}` });
    }
  }
  return {
    schemaVersion: "0.1", sources, anchors, evidence, claims, links,
    health: {
      sources: Object.fromEntries(input.sources.map((item) => [item.id, "valid"])),
      anchors: Object.fromEntries(input.anchors.map((item) => [item.id, sources[item.sourceId] ? "valid" : "missing"])),
      evidence: Object.fromEntries(input.evidence.map((item) => [item.id, item.anchorIds.every((id) => anchors[id]) ? "valid" : "missing"])),
      claims: Object.fromEntries(input.claims.map((item) => [item.id, item.dataClass === "scenario" ? "scenario" : item.evidenceRefs.every((id) => evidence[id]) && item.evidenceRefs.length ? "valid" : "missing"]))
    }, issues
  };
}
function traceEvidence(index: ContextIndex, evidenceId: string): EvidenceTrace["evidence"][number] | undefined {
  const item = index.evidence[evidenceId]; if (!item) return undefined;
  return { item, anchors: item.anchorIds.map((id) => index.anchors[id]).filter(Boolean).map((anchor) => ({ anchor, source: index.sources[anchor.sourceId] })) };
}
export function traceClaim(index: ContextIndex, claimId: string): EvidenceTrace | undefined {
  const claim = index.claims[claimId]; if (!claim) return undefined;
  return { claim, evidence: (index.links.claimToEvidence[claimId] ?? []).map((id) => traceEvidence(index, id)).filter((item): item is EvidenceTrace["evidence"][number] => Boolean(item)) };
}
export function traceElementEvidence(index: ContextIndex, slideId: string, elementId: string): ElementEvidenceTrace {
  return { slideId, elementId, claims: (index.links.elementToClaims[elementId] ?? []).map((id) => traceClaim(index, id)).filter((item): item is EvidenceTrace => Boolean(item)), directEvidence: (index.links.elementToEvidence[elementId] ?? []).map((id) => traceEvidence(index, id)).filter((item): item is EvidenceTrace["evidence"][number] => Boolean(item)) };
}
export function markSourceChecksumChanged(index: ContextIndex, sourceId: string, newChecksum: string): { index: ContextIndex; impact: StaleImpact } {
  const next = structuredClone(index); const source = next.sources[sourceId];
  if (!source) throw new Error(`Unknown source ${sourceId}`);
  if (source.checksum === newChecksum) return { index: next, impact: { sourceIds: [], anchorIds: [], evidenceIds: [], claimIds: [], slideIds: [], elementIds: [] } };
  source.checksum = newChecksum; next.health.sources[sourceId] = "stale";
  const anchorIds = Object.values(next.anchors).filter((anchor) => anchor.sourceId === sourceId).map((anchor) => anchor.id);
  for (const id of anchorIds) next.health.anchors[id] = "stale";
  const evidenceIds = Object.values(next.evidence).filter((item) => item.anchorIds.some((id) => anchorIds.includes(id))).map((item) => item.id);
  for (const id of evidenceIds) next.health.evidence[id] = "stale";
  const claimIds = Object.values(next.claims).filter((claim) => claim.dataClass !== "scenario" && claim.evidenceRefs.some((id) => evidenceIds.includes(id))).map((claim) => claim.id);
  for (const id of claimIds) { next.health.claims[id] = "stale"; next.claims[id].verificationStatus = "stale"; next.claims[id].staleReason = `Source ${sourceId} checksum changed`; }
  const slideIds = unique(Object.entries(next.links.slideToClaims).filter(([,ids]) => ids.some((id) => claimIds.includes(id))).map(([id]) => id).concat(Object.entries(next.links.slideToEvidence).filter(([,ids]) => ids.some((id) => evidenceIds.includes(id))).map(([id]) => id)));
  const elementIds = unique(Object.entries(next.links.elementToClaims).filter(([,ids]) => ids.some((id) => claimIds.includes(id))).map(([id]) => id).concat(Object.entries(next.links.elementToEvidence).filter(([,ids]) => ids.some((id) => evidenceIds.includes(id))).map(([id]) => id)));
  return { index: next, impact: { sourceIds: [sourceId], anchorIds, evidenceIds, claimIds, slideIds, elementIds } };
}
