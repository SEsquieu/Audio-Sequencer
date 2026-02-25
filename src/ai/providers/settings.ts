import type { AiProviderId } from "./types";

const modelStorageMap: Partial<Record<AiProviderId, string>> = {
  "ollama-local": "aiProviderModel.ollama",
  "user-api-openai": "aiProviderModel.openai",
  "user-api-anthropic": "aiProviderModel.anthropic",
};

const canUseStorage = () => typeof window !== "undefined" && !!window.localStorage;

export const getStoredProviderModel = (providerId: AiProviderId): string => {
  const key = modelStorageMap[providerId];
  if (!key || !canUseStorage()) {
    return "";
  }
  try {
    return window.localStorage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
};

export const setStoredProviderModel = (providerId: AiProviderId, model: string) => {
  const key = modelStorageMap[providerId];
  if (!key || !canUseStorage()) {
    return;
  }
  try {
    const trimmed = model.trim();
    if (!trimmed) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, trimmed);
    }
  } catch {
    // Ignore storage failures.
  }
};

