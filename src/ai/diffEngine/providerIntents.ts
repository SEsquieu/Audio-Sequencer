import { StructuredIntentEnvelope } from "../providers/types";
import { FxType } from "../../audio/fx/types";
import { parseRuleBasedDiffCandidates } from "./ruleParser";
import { DiffEngineRequest, DiffPlanCandidate } from "./types";

interface CanonicalCommandIntent {
  type: "canonical_command";
  command: string;
  confidence?: number;
  note?: string;
}

interface SetTrackGainIntent {
  type: "set_track_gain";
  track?: string;
  value?: number;
  delta?: number;
  mode?: "set" | "increase" | "decrease";
  confidence?: number;
  note?: string;
}

interface SetTrackSendIntent {
  type: "set_track_send";
  track?: string;
  send?: "delay" | "reverb";
  value?: number;
  confidence?: number;
  note?: string;
}

interface AddTrackFxIntent {
  type: "add_track_fx";
  track?: string;
  fxType?: FxType;
  confidence?: number;
  note?: string;
}

type ProviderIntentLike =
  | CanonicalCommandIntent
  | SetTrackGainIntent
  | SetTrackSendIntent
  | AddTrackFxIntent
  | string
  | {
      type?: string;
      command?: string;
      text?: string;
      canonical?: string;
      cmd?: string;
      confidence?: number;
      note?: string;
      reason?: string;
    };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampGain = (value: number) => Math.max(0, Math.min(1.2, value));

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bpercent\b/g, "%")
    .replace(/\becho\b/g, "delay")
    .replace(/\bverb\b/g, "reverb");

const containsAny = (text: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));

const resolveTrackName = (request: DiffEngineRequest, requested?: string): string => {
  if (requested) {
    const match = request.song.tracks.find((track) => track.name.toLowerCase() === requested.toLowerCase());
    if (match) {
      return match.name;
    }
    return requested;
  }
  if (request.scope.selectedTrackId) {
    const selected = request.song.tracks.find((track) => track.id === request.scope.selectedTrackId);
    if (selected) {
      return selected.name;
    }
  }
  return request.song.tracks[0]?.name ?? "track";
};

const getSelectedTrack = (request: DiffEngineRequest) =>
  request.scope.selectedTrackId ? request.song.tracks.find((track) => track.id === request.scope.selectedTrackId) ?? null : null;

const inferTrackFromAnyText = (request: DiffEngineRequest, text: string) => inferTargetTrackFromCommand(request, text);

const promptExplicitlyNamesTrack = (request: DiffEngineRequest, promptText: string): boolean => {
  return inferTrackFromAnyText(request, promptText) !== null;
};

const inferTargetTrackFromCommand = (request: DiffEngineRequest, commandText: string) => {
  const command = normalizeText(commandText);
  const byName = request.song.tracks.find((track) => command.includes(track.name.toLowerCase()));
  if (byName) {
    return byName;
  }
  if (/\bdrums?\b|\bkick\b|\bsnare\b|\bhat\b/.test(command)) {
    return request.song.tracks.find((track) => track.type === "drums") ?? null;
  }
  if (/\bbass\b/.test(command)) {
    return request.song.tracks.find((track) => /bass/i.test(track.name)) ?? null;
  }
  if (/\blead\b/.test(command)) {
    return request.song.tracks.find((track) => /lead/i.test(track.name)) ?? null;
  }
  if (/\bpad\b/.test(command)) {
    return request.song.tracks.find((track) => /pad/i.test(track.name)) ?? null;
  }
  if (/\bsynth\b/.test(command)) {
    return request.song.tracks.find((track) => track.type === "synth") ?? null;
  }
  return null;
};

const inferCommandKind = (commandText: string) => {
  const text = normalizeText(commandText);
  if (/^(add|insert) /.test(text)) {
    return "insert_fx";
  }
  if (/\bdelay\b|\breverb\b/.test(text)) {
    return "send_or_bus";
  }
  if (/\bgain\b/.test(text)) {
    return "gain";
  }
  return "other";
};

const inferPromptIntentKind = (promptText: string) => {
  const text = normalizeText(promptText);
  if (containsAny(text, [/\bdelay\b/, /\breverb\b/, /\bsend\b/, /\bbus\b/])) {
    return "send_or_bus";
  }
  if (containsAny(text, [/\bchorus\b/, /\bdj ?filter\b/, /\bsaturat/, /\beq3?\b/, /\binsert\b/, /\bfx\b/])) {
    return "insert_fx";
  }
  if (/\bgain\b|\bvolume\b|\blevel\b/.test(text)) {
    return "gain";
  }
  return "other";
};

const inferRequestedFxType = (text: string): FxType | null => {
  const t = normalizeText(text);
  if (t.includes("chorus")) return "chorus";
  if (t.includes("dj filter") || t.includes("djfilter")) return "djFilter";
  if (t.includes("saturator") || t.includes("saturation")) return "saturator";
  if (/\beq3\b|\beq\b/.test(t)) return "eq3";
  return null;
};

const inferCommandFxType = (commandText: string): FxType | null => inferRequestedFxType(commandText);

const adjustConfidenceForPromptAlignment = (
  request: DiffEngineRequest,
  command: string,
  baseConfidence: number | undefined
): { confidence: number; rejectReason?: string } => {
  let confidence = Math.max(0.5, Math.min(0.99, baseConfidence ?? 0.78));
  const prompt = normalizeText(request.prompt);
  const commandKind = inferCommandKind(command);
  const promptKind = inferPromptIntentKind(request.prompt);

  if (promptKind !== "other" && commandKind !== "other" && promptKind !== commandKind) {
    confidence -= 0.2;
  }
  if (promptKind === "send_or_bus" && commandKind === "gain") {
    return { confidence: 0, rejectReason: "Prompt requests send/bus edit but command targets gain" };
  }
  if (promptKind === "gain" && commandKind === "send_or_bus") {
    return { confidence: 0, rejectReason: "Prompt requests gain edit but command targets send/bus" };
  }

  const selectedTrack = getSelectedTrack(request);
  const promptNamesTrack = promptExplicitlyNamesTrack(request, request.prompt);
  const commandTrack = inferTargetTrackFromCommand(request, command);
  if (selectedTrack && commandTrack && !promptNamesTrack && commandTrack.id !== selectedTrack.id) {
    confidence -= 0.28;
  }

  if (promptNamesTrack && commandTrack) {
    const explicitlyMentionedTrack = inferTrackFromAnyText(request, request.prompt);
    if (explicitlyMentionedTrack && explicitlyMentionedTrack.id !== commandTrack.id) {
      confidence -= 0.35;
    }
  }

  const requestedFx = inferRequestedFxType(request.prompt);
  const commandFx = inferCommandFxType(command);
  if (requestedFx && commandFx && requestedFx !== commandFx) {
    confidence -= 0.25;
  }

  if (promptKind === "send_or_bus" && commandKind === "insert_fx" && !/\badd\b|\binsert\b/.test(prompt)) {
    confidence -= 0.25;
  }
  if (promptKind === "insert_fx" && commandKind === "send_or_bus" && !/\bsend\b|\bbus\b|\bdelay\b|\breverb\b/.test(prompt)) {
    confidence -= 0.18;
  }

  if (confidence < 0.58) {
    return { confidence, rejectReason: "Low prompt alignment confidence" };
  }
  return { confidence: Math.max(0.58, Math.min(0.98, confidence)) };
};

const toCanonicalCommand = (value: unknown, request: DiffEngineRequest): CanonicalCommandIntent | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const type = typeof raw.type === "string" ? raw.type : "";

  if (type === "set_track_gain") {
    const intent = raw as unknown as SetTrackGainIntent;
    const track = resolveTrackName(request, intent.track);
    if (intent.mode === "increase") {
      const delta = Math.round(clampGain(Math.abs(intent.delta ?? 0.1)) * 100);
      return { type: "canonical_command", command: `raise ${track} gain by ${delta}%`, confidence: intent.confidence, note: intent.note };
    }
    if (intent.mode === "decrease") {
      const delta = Math.round(clampGain(Math.abs(intent.delta ?? 0.1)) * 100);
      return { type: "canonical_command", command: `lower ${track} gain by ${delta}%`, confidence: intent.confidence, note: intent.note };
    }
    if (typeof intent.value === "number") {
      return {
        type: "canonical_command",
        command: `${track} gain ${Math.round(clampGain(intent.value) * 100)}%`,
        confidence: intent.confidence,
        note: intent.note,
      };
    }
  }

  if (type === "set_track_send") {
    const intent = raw as unknown as SetTrackSendIntent;
    if ((intent.send === "delay" || intent.send === "reverb") && typeof intent.value === "number") {
      const track = resolveTrackName(request, intent.track);
      return {
        type: "canonical_command",
        command: `${track} ${intent.send} ${Math.round(clamp01(intent.value) * 100)}%`,
        confidence: intent.confidence,
        note: intent.note,
      };
    }
  }

  if (type === "add_track_fx") {
    const intent = raw as unknown as AddTrackFxIntent;
    if (intent.fxType) {
      const track = resolveTrackName(request, intent.track);
      const fxPhrase =
        intent.fxType === "djFilter" ? "dj filter" : intent.fxType;
      return {
        type: "canonical_command",
        command: `add ${fxPhrase} to ${track}`,
        confidence: intent.confidence,
        note: intent.note,
      };
    }
  }

  return null;
};

const isCanonicalCommandIntent = (value: unknown): value is CanonicalCommandIntent => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const intent = value as Record<string, unknown>;
  return intent.type === "canonical_command" && typeof intent.command === "string";
};

const coerceProviderIntent = (value: unknown): CanonicalCommandIntent | null => {
  if (typeof value === "string") {
    return {
      type: "canonical_command",
      command: value,
    };
  }
  if (isCanonicalCommandIntent(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as ProviderIntentLike & Record<string, unknown>;
  const command =
    (typeof raw.command === "string" && raw.command) ||
    (typeof raw.canonical === "string" && raw.canonical) ||
    (typeof raw.text === "string" && raw.text) ||
    (typeof raw.cmd === "string" && raw.cmd) ||
    null;
  if (!command) {
    return null;
  }
  return {
    type: "canonical_command",
    command,
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    note:
      (typeof raw.note === "string" && raw.note) ||
      (typeof raw.reason === "string" && raw.reason) ||
      undefined,
  };
};

export const compileProviderIntentsToPlans = (
  envelope: StructuredIntentEnvelope,
  request: DiffEngineRequest
): {
  plans: DiffPlanCandidate[];
  canonicalCommands: string[];
  rejectedIntentCount: number;
} => {
  const plans: DiffPlanCandidate[] = [];
  const canonicalCommands: string[] = [];
  let rejectedIntentCount = 0;

  for (const rawIntent of envelope.intents) {
    const coerced = coerceProviderIntent(rawIntent) ?? toCanonicalCommand(rawIntent, request);
    if (!coerced) {
      rejectedIntentCount += 1;
      continue;
    }
    canonicalCommands.push(coerced.command);

    const adjusted = adjustConfidenceForPromptAlignment(request, coerced.command, coerced.confidence);
    if (adjusted.rejectReason) {
      rejectedIntentCount += 1;
      continue;
    }

    const commandPlans = parseRuleBasedDiffCandidates({
      ...request,
      prompt: coerced.command,
    });

    for (const plan of commandPlans) {
      plans.push({
        ...plan,
        source: "smartPatch",
        confidence: adjusted.confidence,
        explanation: coerced.note || plan.explanation,
      });
    }
  }

  return {
    plans,
    canonicalCommands,
    rejectedIntentCount,
  };
};
