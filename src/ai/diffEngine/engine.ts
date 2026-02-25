import { generateSmartPatchCandidates } from "../../smartPatch/engine";
import { promptToIntents } from "../../smartPatch/router";
import { compileDiffPlanCandidate } from "./compiler";
import { rankAndDedupeCandidates } from "./ranker";
import { parseRuleBasedDiffCandidates } from "./ruleParser";
import { DiffEngineRequest, DiffPlanCandidate } from "./types";
import { validateCompiledDiffCandidate } from "./validators";

const buildSmartPatchPlans = (request: DiffEngineRequest): DiffPlanCandidate[] => {
  const intents = promptToIntents(
    request.prompt,
    {
      song: request.song,
      selectedTrackId: request.scope.selectedTrackId,
      selectedBar: request.scope.selectedBar,
      locks: request.locks,
    },
    request.intensity ?? 0.5
  );

  const smartCandidates = generateSmartPatchCandidates(
    request.song,
    intents,
    {
      selectedTrackId: request.scope.selectedTrackId,
      selectedBar: request.scope.selectedBar,
      locks: request.locks,
    },
    request.maxCandidates ?? 3
  );

  return smartCandidates.map((candidate) => ({
    id: candidate.id,
    source: "smartPatch" as const,
    confidence: 0.72,
    label: candidate.label,
    explanation: candidate.explanation,
    actions: [
      {
        type: "json_patch",
        ops: candidate.ops,
        label: candidate.label,
        explanation: candidate.explanation,
        auditionBars: candidate.auditionBars,
      },
    ],
  }));
};

export const proposeDiffPatchCandidates = (request: DiffEngineRequest) => {
  const rulePlans = parseRuleBasedDiffCandidates(request);
  const plans = rulePlans.length > 0 ? rulePlans : buildSmartPatchPlans(request);
  const compiled = plans
    .map((plan) => compileDiffPlanCandidate(plan))
    .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
    .filter((candidate) => validateCompiledDiffCandidate(request.song, candidate).ok);

  return rankAndDedupeCandidates(compiled, request.maxCandidates ?? 3).map((candidate) => candidate.patch);
};
