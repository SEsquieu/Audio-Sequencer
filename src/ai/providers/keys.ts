import type { AiProviderId } from "./types";

const keyStorageMap: Partial<Record<AiProviderId, string>> = {
  "user-api-openai": "aiProviderKey.openai",
  "user-api-anthropic": "aiProviderKey.anthropic",
};

const canUseStorage = () => typeof window !== "undefined" && !!window.localStorage;

export const getStoredProviderApiKey = (providerId: AiProviderId): string => {
  const key = keyStorageMap[providerId];
  if (!key || !canUseStorage()) {
    return "";
  }
  try {
    return window.localStorage.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
};

export const setStoredProviderApiKey = (providerId: AiProviderId, apiKey: string) => {
  const key = keyStorageMap[providerId];
  if (!key || !canUseStorage()) {
    return;
  }
  try {
    if (!apiKey.trim()) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, apiKey.trim());
    }
  } catch {
    // Ignore storage errors.
  }
};

export const hasStoredProviderApiKey = (providerId: AiProviderId): boolean => getStoredProviderApiKey(providerId).length > 0;

