export type AiProviderId =
  | "ruleParser-local"
  | "smartPatch-local"
  | "ollama-local"
  | "user-api-openai"
  | "user-api-anthropic"
  | "developer-hosted";

export type AiProviderKind =
  | "local_rules"
  | "local_heuristic"
  | "local_model"
  | "user_api"
  | "hosted";

export type AiAuthMode = "none" | "user_api_key" | "developer_managed";

export type AiTaskType =
  | "simple_control"
  | "sound_edit"
  | "fx_routing"
  | "pattern_edit"
  | "arrangement_edit"
  | "creative_transform";

export interface AiProviderCapabilities {
  structuredOutput: boolean;
  streaming: boolean;
  maxContextTokens?: number;
  supportedTaskTypes: AiTaskType[];
}

export interface AiProviderHealth {
  ok: boolean;
  reason?: string;
}

export interface AiProviderDescriptor {
  id: AiProviderId;
  kind: AiProviderKind;
  label: string;
  authMode: AiAuthMode;
  latencyClass: "instant" | "fast" | "medium" | "slow";
  costClass: "free" | "low" | "medium" | "high";
  capabilities: AiProviderCapabilities;
  enabledByDefault: boolean;
  availability?: "available" | "unavailable" | "unknown";
  unavailableReason?: string;
}

export interface AiProviderRoutingRequest {
  prompt: string;
  isPlaying?: boolean;
  taskType: AiTaskType;
  latencyBudgetMs?: number;
  preferOffline?: boolean;
  userPreferredProviderId?: AiProviderId | "auto";
}

export interface AiProviderRoutingDecision {
  selectedProviderId: AiProviderId;
  fallbackProviderIds: AiProviderId[];
  reason: string;
}

export interface AiPromptTrackContext {
  id: string;
  name: string;
  type: "synth" | "drums";
}

export interface AiPromptContext {
  selectedTrackId?: string;
  selectedTrackName?: string;
  selectedTrackType?: "synth" | "drums";
  selectedBar?: number;
  trackNames: string[];
  tracks: AiPromptTrackContext[];
  supportedCanonicalCommands?: string[];
}

export interface StructuredIntentEnvelope {
  schema: "audio-sequencer.diff-intent.v1";
  intents: unknown[];
}

export interface AiIntentProvider {
  descriptor: AiProviderDescriptor;
  healthCheck(): Promise<AiProviderHealth>;
  generateStructuredIntents?(args: {
    prompt: string;
    context?: AiPromptContext;
    signal?: AbortSignal;
  }): Promise<StructuredIntentEnvelope>;
}
