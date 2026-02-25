import {
  AiIntentProvider,
  AiPromptContext,
  AiProviderDescriptor,
  AiProviderHealth,
  StructuredIntentEnvelope,
} from "./types";
import { getStoredProviderApiKey } from "./keys";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

const getConfiguredBaseUrl = (): string => {
  const envUrl =
    typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ? (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_OPENAI_BASE_URL
      : undefined;
  return envUrl?.trim() || DEFAULT_OPENAI_BASE_URL;
};

const getConfiguredModel = (): string => {
  const envModel =
    typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ? (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_OPENAI_MODEL
      : undefined;
  return envModel?.trim() || DEFAULT_OPENAI_MODEL;
};

export const getOpenAiProviderDescriptor = (): AiProviderDescriptor => ({
  id: "user-api-openai",
  kind: "user_api",
  label: "OpenAI (User API Key)",
  authMode: "user_api_key",
  latencyClass: "medium",
  costClass: "medium",
  enabledByDefault: false,
  capabilities: {
    structuredOutput: true,
    streaming: false,
    supportedTaskTypes: ["sound_edit", "fx_routing", "pattern_edit", "arrangement_edit", "creative_transform"],
  },
  availability: "unknown",
});

const buildSystemPrompt = () =>
  [
    "You convert user requests into canonical audio sequencer commands.",
    'Return ONLY JSON with schema "audio-sequencer.diff-intent.v1" and an "intents" array.',
    "Prefer exact track names from context. If no track is explicitly named, use selected track.",
    "Do not emit markdown.",
  ].join(" ");

const buildUserPrompt = (prompt: string, context?: AiPromptContext) =>
  JSON.stringify(
    {
      userPrompt: prompt,
      context: {
        selectedTrackName: context?.selectedTrackName ?? null,
        selectedTrackType: context?.selectedTrackType ?? null,
        selectedBar: context?.selectedBar ?? null,
        tracks: context?.tracks ?? [],
        supportedCanonicalCommands: context?.supportedCanonicalCommands ?? [],
      },
      outputSchema: {
        schema: "audio-sequencer.diff-intent.v1",
        intents: [{ type: "canonical_command", command: "lead delay 35%", confidence: 0.8 }],
      },
    },
    null,
    2
  );

const normalizeEnvelopeShape = (value: unknown): StructuredIntentEnvelope => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid structured intent envelope");
  }
  const record = value as Record<string, unknown>;
  if (record.schema === "audio-sequencer.diff-intent.v1" && Array.isArray(record.intents)) {
    return {
      schema: "audio-sequencer.diff-intent.v1",
      intents: record.intents,
    };
  }
  if (Array.isArray(record.intents)) {
    return { schema: "audio-sequencer.diff-intent.v1", intents: record.intents };
  }
  throw new Error("Invalid structured intent envelope");
};

const parseOpenAiResponseToEnvelope = (payload: unknown): StructuredIntentEnvelope => {
  const record = payload as Record<string, unknown>;
  const outputText =
    typeof record.output_text === "string"
      ? record.output_text
      : Array.isArray(record.output)
        ? JSON.stringify(record.output)
        : null;
  if (!outputText) {
    throw new Error("OpenAI response missing output text");
  }
  return normalizeEnvelopeShape(JSON.parse(outputText));
};

export const createOpenAiIntentProvider = (): AiIntentProvider => {
  const descriptor = getOpenAiProviderDescriptor();

  const healthCheck = async (): Promise<AiProviderHealth> => {
    const apiKey = getStoredProviderApiKey("user-api-openai");
    if (!apiKey) {
      return { ok: false, reason: "No API key configured" };
    }
    try {
      const response = await fetch(`${getConfiguredBaseUrl()}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (!response.ok) {
        return { ok: false, reason: `HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Unknown error" };
    }
  };

  return {
    descriptor,
    healthCheck,
    generateStructuredIntents: async ({ prompt, context, signal }) => {
      const apiKey = getStoredProviderApiKey("user-api-openai");
      if (!apiKey) {
        throw new Error("OpenAI API key is not configured");
      }
      const response = await fetch(`${getConfiguredBaseUrl()}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal,
        body: JSON.stringify({
          model: getConfiguredModel(),
          input: [
            {
              role: "system",
              content: [{ type: "text", text: buildSystemPrompt() }],
            },
            {
              role: "user",
              content: [{ type: "text", text: buildUserPrompt(prompt, context) }],
            },
          ],
          text: {
            format: {
              type: "json_object",
            },
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`OpenAI request failed (${response.status})`);
      }
      const payload = await response.json();
      return parseOpenAiResponseToEnvelope(payload);
    },
  };
};
