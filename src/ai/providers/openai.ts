import {
  AiIntentProvider,
  AiPromptContext,
  AiProviderDescriptor,
  AiProviderHealth,
  StructuredIntentEnvelope,
} from "./types";
import { getStoredProviderApiKey } from "./keys";
import { getStoredProviderModel } from "./settings";

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
  const stored = getStoredProviderModel("user-api-openai");
  if (stored) {
    return stored;
  }
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
    "Use supportedCanonicalCommands when possible, including note-level pattern edit commands.",
    "Return executable commands only, not regex/grammar notation or placeholders.",
    'Do not use "|" or bracketed option lists like "kick|snare|hat".',
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
  const flattenText = (value: unknown): string[] => {
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap(flattenText);
    }
    if (!value || typeof value !== "object") {
      return [];
    }
    const obj = value as Record<string, unknown>;
    const direct = [
      ...(typeof obj.text === "string" ? [obj.text] : []),
      ...(typeof obj.output_text === "string" ? [obj.output_text] : []),
      ...(typeof obj.content === "string" ? [obj.content] : []),
    ];
    const nestedKeys = ["output", "content", "parts", "messages"];
    return direct.concat(nestedKeys.flatMap((key) => flattenText(obj[key])));
  };
  const tryParseJsonFromText = (text: string): unknown | null => {
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenced) {
        try {
          return JSON.parse(fenced[1]);
        } catch {
          // ignore
        }
      }
      const objMatch = trimmed.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          return JSON.parse(objMatch[0]);
        } catch {
          // ignore
        }
      }
      return null;
    }
  };

  const textCandidates = [
    ...(typeof record.output_text === "string" ? [record.output_text] : []),
    ...flattenText(record.output),
  ].filter((value, index, array) => !!value && array.indexOf(value) === index);
  const parsedJson =
    textCandidates.map((text) => ({ text, parsed: tryParseJsonFromText(text) })).find((item) => item.parsed !== null) ?? null;
  const outputText = parsedJson?.text ?? textCandidates[0] ?? null;
  if (!outputText) {
    throw new Error("OpenAI response missing output text");
  }
  return {
    ...normalizeEnvelopeShape(parsedJson?.parsed ?? JSON.parse(outputText)),
    meta: {
      rawResponsePreview: outputText.slice(0, 600),
    },
  };
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
