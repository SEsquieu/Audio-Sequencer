import { generateSmartPatchCandidates } from "../../smartPatch/engine";
import { promptToIntents } from "../../smartPatch/router";
import { buildAiPromptContext } from "../context/songSnapshot";
import { createAiIntentProvider } from "../providers/registry";
import { routeAiProvider } from "../providers/router";
import { compileDiffPlanCandidate } from "./compiler";
import { compileProviderIntentsToPlans } from "./providerIntents";
import { rankAndDedupeCandidates } from "./ranker";
import { parseRuleBasedDiffCandidates } from "./ruleParser";
import { DiffEngineDiagnostics, DiffEngineRequest, DiffEngineResult, DiffPlanCandidate } from "./types";
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

const compileRankValidPlans = (request: DiffEngineRequest, plans: DiffPlanCandidate[]) =>
  rankAndDedupeCandidates(
    plans
      .map((plan) => compileDiffPlanCandidate(plan))
      .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
      .filter((candidate) => validateCompiledDiffCandidate(request.song, candidate).ok),
    request.maxCandidates ?? 3
  );

const withTimeoutSignal = (signal: AbortSignal | undefined, timeoutMs: number | undefined) => {
  if (!signal && !timeoutMs) {
    return { signal: undefined as AbortSignal | undefined, cleanup: () => {} };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
};

export const proposeDiffPatchCandidates = (request: DiffEngineRequest) => {
  const route = routeAiProvider({
    prompt: request.prompt,
    isPlaying: request.isPlaying,
    preferOffline: request.preferOffline,
    userPreferredProviderId: request.providerPreference as any,
  });
  const rulePlans = parseRuleBasedDiffCandidates(request);
  const shouldUseRulesFirst =
    route.selectedProviderId === "ruleParser-local" || route.fallbackProviderIds.includes("ruleParser-local");
  const plans =
    shouldUseRulesFirst && rulePlans.length > 0
      ? rulePlans
      : buildSmartPatchPlans(request);
  const ranked = compileRankValidPlans(request, plans);
  if (ranked.length > 0) {
    return ranked.map((candidate) => candidate.patch);
  }

  // Phase B scaffolding: non-local providers are selected/routed but patch generation remains local/sync for now.
  if (route.selectedProviderId !== "smartPatch-local" && route.selectedProviderId !== "ruleParser-local") {
    const fallbackPlans = rulePlans.length > 0 ? rulePlans : buildSmartPatchPlans(request);
    return compileRankValidPlans(request, fallbackPlans).map((candidate) => candidate.patch);
  }

  return [];
};

export const proposeDiffPatchCandidatesAsyncDetailed = async (request: DiffEngineRequest): Promise<DiffEngineResult> => {
  const route = routeAiProvider({
    prompt: request.prompt,
    isPlaying: request.isPlaying,
    preferOffline: request.preferOffline,
    userPreferredProviderId: request.providerPreference as any,
  });
  const diagnostics: DiffEngineDiagnostics = {
    selectedProviderId: route.selectedProviderId,
    fallbackProviderIds: route.fallbackProviderIds,
    routeReason: route.reason,
    usedFallback: false,
  };
  const rulePlans = parseRuleBasedDiffCandidates(request);
  if (rulePlans.length > 0) {
    const ranked = compileRankValidPlans(request, rulePlans);
    if (ranked.length > 0) {
      return {
        patches: ranked.map((candidate) => candidate.patch),
        diagnostics: {
          ...diagnostics,
          usedFallback: true,
          fallbackReason: "Deterministic rule parser match",
        },
      };
    }
  }

  const fallbackToLocal = (reason?: string): DiffEngineResult => {
    diagnostics.usedFallback = true;
    diagnostics.fallbackReason = reason;
    return {
      patches: proposeDiffPatchCandidates(request),
      diagnostics,
    };
  };

  if (route.selectedProviderId === "ollama-local" || route.selectedProviderId === "user-api-openai") {
    const { signal, cleanup } = withTimeoutSignal(request.signal, request.timeoutMs ?? 10000);
    try {
      const provider = createAiIntentProvider(route.selectedProviderId);
      if (provider?.generateStructuredIntents) {
        const envelope = await provider.generateStructuredIntents({
          prompt: request.prompt,
          context: buildAiPromptContext(request.song, request.scope),
          signal,
        });
        diagnostics.providerRawIntentCount = envelope.intents.length;
        const providerPlans = compileProviderIntentsToPlans(envelope, request);
        diagnostics.providerCompiledPlanCount = providerPlans.length;
        if (providerPlans.length > 0) {
          const ranked = compileRankValidPlans(request, providerPlans);
          if (ranked.length > 0) {
            return {
              patches: ranked.map((candidate) => candidate.patch),
              diagnostics,
            };
          }
        }
        return fallbackToLocal("Provider returned no compilable patch candidates");
      }
      return fallbackToLocal("Provider unavailable");
    } catch (error) {
      if (signal?.aborted) {
        return fallbackToLocal("Provider request timed out or was canceled");
      }
      return fallbackToLocal(error instanceof Error ? error.message : "Provider request failed");
    } finally {
      cleanup();
    }
  }

  return {
    patches: proposeDiffPatchCandidates(request),
    diagnostics,
  };
};

export const proposeDiffPatchCandidatesAsync = async (request: DiffEngineRequest) => {
  const result = await proposeDiffPatchCandidatesAsyncDetailed(request);
  return result.patches;
};
