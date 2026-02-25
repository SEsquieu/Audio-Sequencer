import { getAiProviderDescriptor, listAiProviderDescriptors } from "./registry";
import { AiProviderRoutingDecision, AiProviderRoutingRequest, AiTaskType } from "./types";

const detectTaskTypeFromPrompt = (rawPrompt: string): AiTaskType => {
  const prompt = rawPrompt.toLowerCase();
  if (/\btempo\b|\bswing\b|\beco mode\b|\bmaster safety\b/.test(prompt)) {
    return "simple_control";
  }
  if (/\bdelay\b|\breverb\b|\bchorus\b|\bfilter\b|\bsaturat|\beq\b|\bfx\b|\bbus\b/.test(prompt)) {
    return "fx_routing";
  }
  if (/\bpattern\b|\bnotes?\b|\bmelody\b|\bdrum\b|\bbar\b/.test(prompt)) {
    return "pattern_edit";
  }
  return "sound_edit";
};

export const getStoredAiProviderPreference = (): "auto" | string => {
  if (typeof window === "undefined") {
    return "auto";
  }
  try {
    const value = window.localStorage.getItem("aiProviderPreference");
    return value?.trim() || "auto";
  } catch {
    return "auto";
  }
};

export const setStoredAiProviderPreference = (providerId: string | "auto") => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem("aiProviderPreference", providerId);
  } catch {
    // Ignore storage failures and fall back to auto routing.
  }
};

export const routeAiProvider = (
  request: Omit<AiProviderRoutingRequest, "taskType"> & { taskType?: AiTaskType }
): AiProviderRoutingDecision => {
  const taskType = request.taskType ?? detectTaskTypeFromPrompt(request.prompt);
  const preferred = request.userPreferredProviderId ?? (getStoredAiProviderPreference() as "auto" | string);
  const descriptors = listAiProviderDescriptors();

  const supportsTask = (id: string) =>
    !!descriptors.find(
      (provider) =>
        provider.id === id &&
        provider.capabilities.supportedTaskTypes.includes(taskType) &&
        provider.availability !== "unavailable"
    );

  if (preferred !== "auto" && supportsTask(preferred)) {
    return {
      selectedProviderId: preferred as AiProviderRoutingDecision["selectedProviderId"],
      fallbackProviderIds: ["smartPatch-local"],
      reason: "Using user-selected provider preference",
    };
  }

  if (request.preferOffline !== false) {
    if (taskType === "simple_control" || taskType === "fx_routing") {
      return {
        selectedProviderId: "ruleParser-local",
        fallbackProviderIds: ["smartPatch-local", "ollama-local"],
        reason: "Low-latency offline route for deterministic editing",
      };
    }

    if (supportsTask("ollama-local") && !request.isPlaying) {
      return {
        selectedProviderId: "ollama-local",
        fallbackProviderIds: ["smartPatch-local"],
        reason: "Prefer local model for richer offline edits when transport is idle",
      };
    }
  }

  return {
    selectedProviderId: "smartPatch-local",
    fallbackProviderIds: ["ruleParser-local", "ollama-local"],
    reason: "Default local heuristic route",
  };
};

export const getAiProviderDescriptorOrThrow = (providerId: AiProviderRoutingDecision["selectedProviderId"]) => {
  const descriptor = getAiProviderDescriptor(providerId);
  if (!descriptor) {
    throw new Error(`Unknown AI provider: ${providerId}`);
  }
  return descriptor;
};

