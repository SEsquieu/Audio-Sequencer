import { PatchMeta } from "../../types/song";
import { CompiledDiffCandidate, DiffPlanCandidate } from "./types";
import { collectAffectedPaths, summarizePatchOps } from "./summarize";

const normalizeOps = (ops: PatchMeta["ops"]): PatchMeta["ops"] => {
  // Keep behavior deterministic but low-risk: collapse identical adjacent operations only.
  const next: PatchMeta["ops"] = [];
  for (const op of ops) {
    const prev = next[next.length - 1];
    if (prev && prev.op === op.op && prev.path === op.path && JSON.stringify(prev.value) === JSON.stringify(op.value)) {
      continue;
    }
    next.push(op);
  }
  return next;
};

export const compileDiffPlanCandidate = (plan: DiffPlanCandidate): CompiledDiffCandidate | null => {
  const patchAction = plan.actions.find((action) => action.type === "json_patch");
  if (!patchAction) {
    return null;
  }

  const ops = normalizeOps(patchAction.ops);
  if (ops.length === 0) {
    return null;
  }

  const label = patchAction.label ?? plan.label ?? "AI Patch";
  const explanation = patchAction.explanation ?? plan.explanation ?? summarizePatchOps(ops);
  const affectedPaths = collectAffectedPaths(ops);

  return {
    patch: {
      id: plan.id,
      author: "ai",
      label,
      explanation,
      ops,
      auditionBars: patchAction.auditionBars,
    },
    source: plan.source,
    confidence: plan.confidence ?? 0.5,
    affectedPaths,
    warnings: [],
    opCount: ops.length,
  };
};

