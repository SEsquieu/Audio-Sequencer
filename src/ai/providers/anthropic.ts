import {
  AiIntentProvider,
  AiPromptContext,
  AiProviderDescriptor,
  AiProviderHealth,
  StructuredIntentEnvelope,
} from "./types";
import { getStoredProviderApiKey } from "./keys";
import { getStoredProviderModel } from "./settings";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku-latest";

const getConfiguredBaseUrl = (): string => {
  const envUrl =
    typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ? (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_ANTHROPIC_BASE_URL
      : undefined;
  return envUrl?.trim() || DEFAULT_ANTHROPIC_BASE_URL;
};

const getConfiguredModel = (): string => {
  const stored = getStoredProviderModel("user-api-anthropic");
  if (stored) {
    return stored;
  }
  const envModel =
    typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ? (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_ANTHROPIC_MODEL
      : undefined;
  return envModel?.trim() || DEFAULT_ANTHROPIC_MODEL;
};

export const getAnthropicProviderDescriptor = (): AiProviderDescriptor => ({
  id: "user-api-anthropic",
  kind: "user_api",
  label: "Anthropic (User API Key)",
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
    "Convert the user request into canonical audio sequencer commands.",
    'Return ONLY JSON with schema "audio-sequencer.diff-intent.v1" and an intents array.',
    "Prefer exact track names from context and selected track if no track is named.",
    "Use supportedCanonicalCommands when possible, including note-level pattern edit commands.",
    "For compact drum patterns (multiple lanes/steps), prefer typed intents like set_drum_steps over one long canonical string.",
    "Return executable commands only, not regex/grammar notation or placeholders.",
    'Do not use "|" or bracketed option lists like "kick|snare|hat".',
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
        intents: [{ type: "canonical_command", command: "lower bass gain", confidence: 0.8 }],
      },
      examples: [
        { user: "add note c4 step 1 on lead", command: "add note c4 step 1 on lead" },
        { user: "remove note g3 step 9 on bass in bar 2", command: "remove note g3 step 9 on bass in bar 2" },
        { user: "set note c4 to d4 step 1 on lead", command: "set note c4 to d4 step 1 on lead" },
        { user: "set note 2 at step 1 to d4 on lead", command: "set note 2 at step 1 to d4 on lead" },
        { user: "set second note c4 to d4 step 1 on lead", command: "set second note c4 to d4 step 1 on lead" },
        { user: "remove note 2 at step 1 on lead", command: "remove note 2 at step 1 on lead" },
        { user: "add note c4 to step 3 in bar 3 on lead", command: "add note c4 step 3 on lead in bar 3" },
        { user: "add note g3 step 7 bar 4 on bass", command: "add note g3 step 7 on bass in bar 4" },
        { user: "4 on the floor kick", command: "kick on step 1, 5, 9, 13" },
      ],
      multiIntentExamples: [
        {
          user: "put kicks on 1 and 9",
          intents: [
            { type: "canonical_command", command: "kick step 1 on", confidence: 0.78 },
            { type: "canonical_command", command: "kick step 9 on", confidence: 0.78 },
          ],
        },
        {
          user: "add c major hits on 1 and 9",
          intents: [
            { type: "canonical_command", command: "add note c4 step 1 on lead", confidence: 0.74 },
            { type: "canonical_command", command: "add note e4 step 1 on lead", confidence: 0.74 },
            { type: "canonical_command", command: "add note g4 step 1 on lead", confidence: 0.74 },
          ],
        },
      ],
      typedIntentExamples: [
        {
          user: "kick and snare on 5 and 13",
          intents: [
            {
              type: "set_drum_steps",
              track: "drums",
              lanes: ["kick", "snare"],
              steps: [4, 12],
              value: 1,
              confidence: 0.8,
            },
          ],
        },
        {
          user: "4 on the floor kick",
          intents: [
            {
              type: "set_drum_steps",
              track: "drums",
              lanes: ["kick"],
              steps: [0, 4, 8, 12],
              value: 1,
              confidence: 0.84,
            },
          ],
        },
      ],
      invalidExamples: [{ bad: "kick|snare|hat step 1 on", why: "grammar notation, not an executable command" }],
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
    return { schema: "audio-sequencer.diff-intent.v1", intents: record.intents };
  }
  if (Array.isArray(record.intents)) {
    return { schema: "audio-sequencer.diff-intent.v1", intents: record.intents };
  }
  throw new Error("Invalid structured intent envelope");
};

const parseAnthropicText = (text: string): StructuredIntentEnvelope => {
  const trimmed = text.trim();
  const candidates = [trimmed, ...(trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.slice(1) ?? [])];
  for (const candidate of candidates) {
    try {
      return {
        ...normalizeEnvelopeShape(JSON.parse(candidate)),
        meta: { rawResponsePreview: text.slice(0, 600) },
      };
    } catch {
      // try next
    }
  }
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    return {
      ...normalizeEnvelopeShape(JSON.parse(objMatch[0])),
      meta: { rawResponsePreview: text.slice(0, 600) },
    };
  }
  throw new Error("Anthropic response missing parseable JSON");
};

export const createAnthropicIntentProvider = (): AiIntentProvider => {
  const descriptor = getAnthropicProviderDescriptor();

  const healthCheck = async (): Promise<AiProviderHealth> => {
    const apiKey = getStoredProviderApiKey("user-api-anthropic");
    if (!apiKey) {
      return { ok: false, reason: "No API key configured" };
    }
    try {
      const response = await fetch(`${getConfiguredBaseUrl()}/models`, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Unknown error" };
    }
  };

  return {
    descriptor,
    healthCheck,
    generateStructuredIntents: async ({ prompt, context, signal }) => {
      const apiKey = getStoredProviderApiKey("user-api-anthropic");
      if (!apiKey) {
        throw new Error("Anthropic API key is not configured");
      }
      const response = await fetch(`${getConfiguredBaseUrl()}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal,
        body: JSON.stringify({
          model: getConfiguredModel(),
          max_tokens: 400,
          system: buildSystemPrompt(),
          messages: [
            {
              role: "user",
              content: buildUserPrompt(prompt, context),
            },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`Anthropic request failed (${response.status})`);
      }
      const payload = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
      const text = Array.isArray(payload.content)
        ? payload.content
            .filter((part) => part?.type === "text" && typeof part.text === "string")
            .map((part) => part.text as string)
            .join("\n")
        : "";
      if (!text) {
        throw new Error("Anthropic response missing text content");
      }
      return parseAnthropicText(text);
    },
  };
};
