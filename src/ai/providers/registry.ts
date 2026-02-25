import { createOllamaIntentProvider, getOllamaProviderDescriptor } from "./ollama";
import { hasStoredProviderApiKey } from "./keys";
import { createOpenAiIntentProvider, getOpenAiProviderDescriptor } from "./openai";
import { AiIntentProvider, AiProviderDescriptor, AiProviderId } from "./types";

const STATIC_PROVIDER_DESCRIPTORS: AiProviderDescriptor[] = [
  {
    id: "ruleParser-local",
    kind: "local_rules",
    label: "Rule Parser (Local)",
    authMode: "none",
    latencyClass: "instant",
    costClass: "free",
    enabledByDefault: true,
    capabilities: {
      structuredOutput: true,
      streaming: false,
      supportedTaskTypes: ["simple_control", "sound_edit", "fx_routing"],
    },
    availability: "available",
  },
  {
    id: "smartPatch-local",
    kind: "local_heuristic",
    label: "Smart Patch (Local)",
    authMode: "none",
    latencyClass: "fast",
    costClass: "free",
    enabledByDefault: true,
    capabilities: {
      structuredOutput: true,
      streaming: false,
      supportedTaskTypes: ["sound_edit", "fx_routing", "pattern_edit", "creative_transform"],
    },
    availability: "available",
  },
  getOllamaProviderDescriptor(),
  getOpenAiProviderDescriptor(),
  {
    id: "user-api-anthropic",
    kind: "user_api",
    label: "Anthropic (User API Key)",
    authMode: "user_api_key",
    latencyClass: "medium",
    costClass: "medium",
    enabledByDefault: false,
    capabilities: {
      structuredOutput: true,
      streaming: true,
      supportedTaskTypes: ["sound_edit", "fx_routing", "pattern_edit", "arrangement_edit", "creative_transform"],
    },
    availability: "unknown",
  },
  {
    id: "developer-hosted",
    kind: "hosted",
    label: "Hosted AI (Developer)",
    authMode: "developer_managed",
    latencyClass: "medium",
    costClass: "low",
    enabledByDefault: false,
    capabilities: {
      structuredOutput: true,
      streaming: true,
      supportedTaskTypes: ["sound_edit", "fx_routing", "pattern_edit", "arrangement_edit", "creative_transform"],
    },
    availability: "unknown",
  },
];

export const listAiProviderDescriptors = (): AiProviderDescriptor[] =>
  STATIC_PROVIDER_DESCRIPTORS.map((provider) => {
    if (provider.id === "user-api-openai") {
      const hasKey = hasStoredProviderApiKey("user-api-openai");
      return {
        ...provider,
        availability: hasKey ? "unknown" : "unavailable",
        unavailableReason: hasKey ? undefined : "API key required",
      };
    }
    if (provider.id === "user-api-anthropic") {
      const hasKey = hasStoredProviderApiKey("user-api-anthropic");
      return {
        ...provider,
        availability: hasKey ? "unknown" : "unavailable",
        unavailableReason: hasKey ? undefined : "API key required",
      };
    }
    return { ...provider };
  });

export const getAiProviderDescriptor = (id: AiProviderId): AiProviderDescriptor | null =>
  STATIC_PROVIDER_DESCRIPTORS.find((provider) => provider.id === id) ?? null;

export const createAiIntentProvider = (id: AiProviderId): AiIntentProvider | null => {
  if (id === "ollama-local") {
    return createOllamaIntentProvider();
  }
  if (id === "user-api-openai") {
    return createOpenAiIntentProvider();
  }
  return null;
};

export const probeAiProviderHealth = async (id: AiProviderId) => {
  const provider = createAiIntentProvider(id);
  if (!provider) {
    return null;
  }
  return provider.healthCheck();
};
