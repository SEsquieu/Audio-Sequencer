import {
  AiIntentProvider,
  AiPromptContext,
  AiProviderDescriptor,
  AiProviderHealth,
  StructuredIntentEnvelope,
} from "./types";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "gemma:2b";

const getConfiguredBaseUrl = (): string => {
  const envUrl =
    typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ? (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_OLLAMA_BASE_URL
      : undefined;
  return envUrl?.trim() || DEFAULT_OLLAMA_BASE_URL;
};

const getConfiguredModel = (): string => {
  const envModel =
    typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ? (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_OLLAMA_MODEL
      : undefined;
  return envModel?.trim() || DEFAULT_OLLAMA_MODEL;
};

export const getOllamaProviderDescriptor = (): AiProviderDescriptor => ({
  id: "ollama-local",
  kind: "local_model",
  label: "Ollama (Local)",
  authMode: "none",
  latencyClass: "medium",
  costClass: "free",
  enabledByDefault: false,
  capabilities: {
    structuredOutput: true,
    streaming: false,
    supportedTaskTypes: ["sound_edit", "fx_routing", "pattern_edit", "arrangement_edit", "creative_transform"],
  },
  availability: "unknown",
});

const normalizeEnvelopeShape = (value: unknown): StructuredIntentEnvelope => {
  if (Array.isArray(value)) {
    return {
      schema: "audio-sequencer.diff-intent.v1",
      intents: value,
    };
  }
  if (!value || typeof value !== "object") {
    throw new Error("Invalid structured intent envelope");
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.intents)) {
    return {
      schema: "audio-sequencer.diff-intent.v1",
      intents: record.intents,
    };
  }
  if (Array.isArray(record.commands)) {
    return {
      schema: "audio-sequencer.diff-intent.v1",
      intents: record.commands.map((command) =>
        typeof command === "string" ? { type: "canonical_command", command } : command
      ),
    };
  }
  if (typeof record.command === "string") {
    return {
      schema: "audio-sequencer.diff-intent.v1",
      intents: [{ type: "canonical_command", command: record.command }],
    };
  }
  throw new Error("Invalid structured intent envelope");
};

const parseJsonLoosely = (text: string): unknown => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      // continue
    }
  }

  const jsonObjectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    try {
      return JSON.parse(jsonObjectMatch[0]);
    } catch {
      // continue
    }
  }

  const jsonArrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch) {
    try {
      return JSON.parse(jsonArrayMatch[0]);
    } catch {
      // continue
    }
  }

  throw new Error("No parseable JSON found in Ollama response");
};

const parseIntentEnvelopeFromText = (text: string): StructuredIntentEnvelope => normalizeEnvelopeShape(parseJsonLoosely(text));

const buildPrompt = (prompt: string, context?: AiPromptContext): string => `
You convert user requests into canonical audio sequencer commands.
Return ONLY JSON with this exact schema:
{"schema":"audio-sequencer.diff-intent.v1","intents":[{"type":"canonical_command","command":"...","confidence":0.0,"note":"..."}]}

Rules:
- Output 0 or more intents.
- Prefer one canonical command when possible.
- If you are unsure, emit your best guess as one canonical command instead of an empty result.
- If the user does not explicitly name a track, target the selected track from Context.
- Do not invent track names. Use exact names from Context.tracks when possible.
- Use ONLY commands from this supported set:
  - "tempo <bpm>"
  - "swing <percent>%"
  - "eco mode on|off"
  - "master safety on|off"
  - "master safety amount <percent>%"
  - "<track> gain <percent>%"
  - "lower <track> gain"
  - "raise <track> gain"
  - "lower <track> gain by <percent>%"
  - "raise <track> gain by <percent>%"
  - "<track> delay <percent>%"
  - "<track> reverb <percent>%"
  - "<track> delay bus custom|echo a|echo b"
  - "<track> reverb bus custom|room a|hall b"
  - "add chorus to <track>"
  - "add dj filter to <track>"
  - "add saturator to <track>"
  - "add eq3 to <track>"
- Prefer exact track names from the provided track list.
- If unsupported or ambiguous, return an empty intents array.
- No markdown. No prose outside JSON.

Examples:
{"schema":"audio-sequencer.diff-intent.v1","intents":[{"type":"canonical_command","command":"lead delay 35%","confidence":0.84}]}
{"schema":"audio-sequencer.diff-intent.v1","intents":[{"type":"canonical_command","command":"add chorus to lead","confidence":0.78}]}
{"schema":"audio-sequencer.diff-intent.v1","intents":[{"type":"canonical_command","command":"lower bass gain","confidence":0.82}]}

Context:
${JSON.stringify(
  {
    selectedTrackName: context?.selectedTrackName ?? null,
    selectedTrackType: context?.selectedTrackType ?? null,
    selectedBar: context?.selectedBar ?? null,
    tracks: context?.tracks ?? [],
    trackNames: context?.trackNames ?? [],
    supportedCanonicalCommands: context?.supportedCanonicalCommands ?? [],
  },
  null,
  2
)}

User prompt: ${JSON.stringify(prompt)}
`.trim();

export const createOllamaIntentProvider = (): AiIntentProvider => {
  const descriptor = getOllamaProviderDescriptor();

  const healthCheck = async (): Promise<AiProviderHealth> => {
    try {
      const response = await fetch(`${getConfiguredBaseUrl()}/api/tags`, { method: "GET" });
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
      const response = await fetch(`${getConfiguredBaseUrl()}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          model: getConfiguredModel(),
          prompt: buildPrompt(prompt, context),
          stream: false,
          format: "json",
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed (${response.status})`);
      }

      const payload = (await response.json()) as { response?: string };
      if (!payload.response) {
        throw new Error("Ollama response missing body");
      }
      return parseIntentEnvelopeFromText(payload.response);
    },
  };
};
