import { PatchMeta, SongState } from "../types/song";
import { SMART_PATCH_REGISTRY } from "./registry";
import { SmartPatchIntent, SmartPatchRuntimeContext } from "./types";
import { validateScopeOps } from "./validators";

export const generateSmartPatchCandidates = (
  song: SongState,
  intents: SmartPatchIntent[],
  ctx: Omit<SmartPatchRuntimeContext, "song">,
  maxCandidates = 3
): PatchMeta[] => {
  const runtime: SmartPatchRuntimeContext = {
    song,
    ...ctx,
  };

  const candidates: PatchMeta[] = [];

  for (const intent of intents) {
    const handler = SMART_PATCH_REGISTRY[intent.action];
    if (!handler) {
      continue;
    }

    const proposal = handler(intent, runtime);
    if (!proposal || proposal.ops.length === 0) {
      continue;
    }

    if (!validateScopeOps(proposal.ops, proposal.scope, song)) {
      continue;
    }

    candidates.push({
      id: proposal.id,
      author: "ai",
      label: proposal.label,
      explanation: proposal.explanation,
      ops: proposal.ops,
      auditionBars: proposal.auditionBars,
    });

    if (candidates.length >= maxCandidates) {
      break;
    }
  }

  return candidates;
};

