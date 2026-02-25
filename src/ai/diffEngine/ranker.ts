import { CompiledDiffCandidate } from "./types";

const signatureForCandidate = (candidate: CompiledDiffCandidate): string =>
  JSON.stringify(candidate.patch.ops.map((op) => [op.op, op.path, op.value]));

const scoreCandidate = (candidate: CompiledDiffCandidate): number => {
  // Lower op count and higher confidence rank better for "flow" interactions.
  const opPenalty = Math.min(0.4, candidate.opCount * 0.02);
  return candidate.confidence - opPenalty;
};

export const rankAndDedupeCandidates = (
  candidates: CompiledDiffCandidate[],
  maxCandidates = 3
): CompiledDiffCandidate[] => {
  const deduped = new Map<string, CompiledDiffCandidate>();
  for (const candidate of candidates) {
    const key = signatureForCandidate(candidate);
    const existing = deduped.get(key);
    if (!existing || scoreCandidate(candidate) > scoreCandidate(existing)) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, Math.max(1, maxCandidates));
};

