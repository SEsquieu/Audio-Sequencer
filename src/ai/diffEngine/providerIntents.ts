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

interface RouteTrackSendBusIntent {
  type: "route_track_send_bus";
  track?: string;
  bus?: "delay" | "reverb";
  value?: string;
  confidence?: number;
  note?: string;
}

interface SetTrackFxParamIntent {
  type: "set_track_fx_param";
  track?: string;
  fxType?: FxType;
  fxId?: string;
  param?: string;
  value?: number | string | boolean;
  confidence?: number;
  note?: string;
}

interface SetDrumStepIntent {
  type: "set_drum_step";
  track?: string;
  barIndex?: number;
  stepIndex?: number;
  lane?: "kick" | "snare" | "hat";
  value?: number;
  confidence?: number;
  note?: string;
}

interface RotateDrumBarStepsIntent {
  type: "rotate_drum_bar_steps";
  track?: string;
  barIndex?: number;
  steps?: number;
  confidence?: number;
  note?: string;
}

interface TransposeTrackBarNotesIntent {
  type: "transpose_track_bar_notes";
  track?: string;
  barIndex?: number;
  semitones?: number;
  confidence?: number;
  note?: string;
}

interface CopyTrackBarAssignmentIntent {
  type: "copy_track_bar_assignment";
  track?: string;
  fromBarIndex?: number;
  toBarIndex?: number;
  confidence?: number;
  note?: string;
}

interface RotateTrackBarAssignmentsIntent {
  type: "rotate_track_bar_assignments";
  track?: string;
  fromBarIndex?: number;
  toBarIndex?: number;
  steps?: number;
  confidence?: number;
  note?: string;
}

interface SetSynthStepNotesFieldIntent {
  type: "set_synth_step_notes_field";
  track?: string;
  barIndex?: number;
  stepIndex?: number;
  field?: "velocity" | "length";
  value?: number;
  confidence?: number;
  note?: string;
}

type ProviderIntentLike =
  | CanonicalCommandIntent
  | SetTrackGainIntent
  | SetTrackSendIntent
  | AddTrackFxIntent
  | RouteTrackSendBusIntent
  | SetTrackFxParamIntent
  | SetDrumStepIntent
  | RotateDrumBarStepsIntent
  | TransposeTrackBarNotesIntent
  | CopyTrackBarAssignmentIntent
  | RotateTrackBarAssignmentsIntent
  | SetSynthStepNotesFieldIntent
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
const clampSendUnit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const clampFxParamValue = (fxType: FxType, param: string, value: unknown): number | string | boolean | null => {
  if (fxType === "chorus") {
    if (param === "rate") return Math.max(0.01, Math.min(8, Number(value)));
    if (param === "depth" || param === "mix") return clampSendUnit(Number(value));
  }
  if (fxType === "djFilter") {
    if (param === "cutoff" || param === "q") return clampSendUnit(Number(value));
    if (param === "mode") return value === "hp" ? "hp" : value === "lp" ? "lp" : null;
  }
  if (fxType === "saturator") {
    if (param === "drive" || param === "mix") return clampSendUnit(Number(value));
    if (param === "output") return Math.max(0, Math.min(2, Number(value)));
  }
  if (fxType === "eq3") {
    if (["low", "mid", "high"].includes(param)) return Math.max(-24, Math.min(24, Number(value)));
    if (["lowFreq", "midFreq", "highFreq"].includes(param)) return Math.max(20, Math.min(18000, Number(value)));
    if (param === "midQ") return Math.max(0.1, Math.min(16, Number(value)));
  }
  return null;
};

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

const resolveTrack = (request: DiffEngineRequest, requested?: string) => {
  if (requested) {
    const exact = request.song.tracks.find((track) => track.name.toLowerCase() === requested.toLowerCase());
    if (exact) {
      return exact;
    }
  }
  if (request.scope.selectedTrackId) {
    const selected = request.song.tracks.find((track) => track.id === request.scope.selectedTrackId);
    if (selected) {
      return selected;
    }
  }
  return request.song.tracks[0] ?? null;
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
  if (/\bchorus\b|\bdj ?filter\b|\bsaturat|\beq3?\b/.test(text) && /\b(mix|rate|depth|cutoff|q|drive|output|mode|low|mid|high)\b/.test(text)) {
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

  if (type === "route_track_send_bus") {
    const intent = raw as unknown as RouteTrackSendBusIntent;
    const track = resolveTrackName(request, intent.track);
    if (
      (intent.bus === "delay" || intent.bus === "reverb") &&
      typeof intent.value === "string"
    ) {
      return {
        type: "canonical_command",
        command: `${track} ${intent.bus} bus ${intent.value}`,
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

  if (type === "set_drum_step") {
    const intent = raw as unknown as SetDrumStepIntent;
    const track = resolveTrackName(request, intent.track);
    if (
      (intent.lane === "kick" || intent.lane === "snare" || intent.lane === "hat") &&
      typeof intent.stepIndex === "number"
    ) {
      const stepHuman = Math.max(1, Math.round(intent.stepIndex + 1));
      const valuePct = Math.round(clamp01(intent.value ?? 1) * 100);
      return {
        type: "canonical_command",
        command: `${track} ${intent.lane} step ${stepHuman} ${valuePct}%`,
        confidence: intent.confidence,
        note: intent.note,
      };
    }
  }

  if (type === "rotate_drum_bar_steps") {
    const intent = raw as unknown as RotateDrumBarStepsIntent;
    const track = resolveTrackName(request, intent.track);
    if (typeof intent.steps === "number") {
      const maybeBar = typeof intent.barIndex === "number" ? ` in bar ${Math.round(intent.barIndex + 1)}` : "";
      return {
        type: "canonical_command",
        command: `rotate drum steps by ${Math.round(intent.steps)}${maybeBar}`,
        confidence: intent.confidence,
        note: intent.note ?? (track ? `Rotate drum steps for ${track}` : undefined),
      };
    }
  }

  if (type === "transpose_track_bar_notes") {
    const intent = raw as unknown as TransposeTrackBarNotesIntent;
    const track = resolveTrackName(request, intent.track);
    if (typeof intent.semitones === "number") {
      const dir = intent.semitones >= 0 ? "up" : "down";
      return {
        type: "canonical_command",
        command: `transpose ${track} ${dir} ${Math.abs(Math.round(intent.semitones))}`,
        confidence: intent.confidence,
        note: intent.note,
      };
    }
  }

  if (type === "copy_track_bar_assignment") {
    const intent = raw as unknown as CopyTrackBarAssignmentIntent;
    const track = resolveTrackName(request, intent.track);
    if (typeof intent.fromBarIndex === "number" && typeof intent.toBarIndex === "number") {
      return {
        type: "canonical_command",
        command: `copy ${track} bar ${Math.round(intent.fromBarIndex + 1)} to bar ${Math.round(intent.toBarIndex + 1)}`,
        confidence: intent.confidence,
        note: intent.note,
      };
    }
  }

  if (type === "rotate_track_bar_assignments") {
    const intent = raw as unknown as RotateTrackBarAssignmentsIntent;
    const track = resolveTrackName(request, intent.track);
    if (
      typeof intent.fromBarIndex === "number" &&
      typeof intent.toBarIndex === "number" &&
      typeof intent.steps === "number"
    ) {
      return {
        type: "canonical_command",
        command: `rotate ${track} bars ${Math.round(intent.fromBarIndex + 1)}-${Math.round(intent.toBarIndex + 1)} by ${Math.round(
          intent.steps
        )}`,
        confidence: intent.confidence,
        note: intent.note,
      };
    }
  }

  if (type === "set_synth_step_notes_field") {
    const intent = raw as unknown as SetSynthStepNotesFieldIntent;
    const track = resolveTrackName(request, intent.track);
    if ((intent.field === "velocity" || intent.field === "length") && typeof intent.stepIndex === "number") {
      const val =
        intent.field === "velocity"
          ? `${Math.round(clamp01(typeof intent.value === "number" ? intent.value : 1) * 100)}%`
          : `${Math.max(1, Math.min(16, Math.round(typeof intent.value === "number" ? intent.value : 1)))}`;
      const maybeBar = typeof intent.barIndex === "number" ? ` in bar ${Math.round(intent.barIndex + 1)}` : "";
      return {
        type: "canonical_command",
        command: `${intent.field} step ${Math.round(intent.stepIndex + 1)} ${val} on ${track}${maybeBar}`,
        confidence: intent.confidence,
        note: intent.note,
      };
    }
  }

  return null;
};

const toTypedPlanCandidate = (value: unknown, request: DiffEngineRequest): DiffPlanCandidate | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const type = typeof raw.type === "string" ? raw.type : "";

  if (type === "set_track_gain") {
    const intent = raw as unknown as SetTrackGainIntent;
    const track = resolveTrack(request, intent.track);
    if (!track) {
      return null;
    }
    const current = track.instrument.gain ?? 0.5;
    let nextValue: number | null = null;
    if (intent.mode === "increase") {
      nextValue = clampGain(current + Math.abs(intent.delta ?? 0.1));
    } else if (intent.mode === "decrease") {
      nextValue = clampGain(current - Math.abs(intent.delta ?? 0.1));
    } else if (typeof intent.value === "number") {
      nextValue = clampGain(intent.value);
    }
    if (nextValue === null) {
      return null;
    }
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.8,
      label: `Set ${track.name} Gain`,
      explanation: intent.note ?? `Set ${track.name} gain to ${Math.round(nextValue * 100)}%`,
      actions: [
        {
          type: "set_track_param",
          trackId: track.id,
          param: "gain",
          value: nextValue,
        },
      ],
    };
  }

  if (type === "set_track_send") {
    const intent = raw as unknown as SetTrackSendIntent;
    const track = resolveTrack(request, intent.track);
    if (!track || (intent.send !== "delay" && intent.send !== "reverb") || typeof intent.value !== "number") {
      return null;
    }
    const nextValue = clamp01(intent.value);
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.8,
      label: `Set ${track.name} ${intent.send === "delay" ? "Delay" : "Reverb"} Send`,
      explanation: intent.note ?? `Set ${track.name} ${intent.send} send to ${Math.round(nextValue * 100)}%`,
      actions: [
        {
          type: "set_track_send",
          trackId: track.id,
          send: intent.send,
          value: nextValue,
        },
      ],
    };
  }

  if (type === "add_track_fx") {
    const intent = raw as unknown as AddTrackFxIntent;
    const track = resolveTrack(request, intent.track);
    if (!track || !intent.fxType) {
      return null;
    }
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.78,
      label: `Add ${intent.fxType} FX`,
      explanation: intent.note ?? `Add ${intent.fxType} insert FX to ${track.name}`,
      actions: [
        {
          type: "add_track_insert_fx",
          trackId: track.id,
          fxType: intent.fxType,
        },
      ],
    };
  }

  if (type === "route_track_send_bus") {
    const intent = raw as unknown as RouteTrackSendBusIntent;
    const track = resolveTrack(request, intent.track);
    if (!track || (intent.bus !== "delay" && intent.bus !== "reverb") || typeof intent.value !== "string") {
      return null;
    }
    const normalizedValue = normalizeText(intent.value);
    const busValue =
      intent.bus === "delay"
        ? normalizedValue === "custom"
          ? "custom"
          : normalizedValue === "echo a" || normalizedValue === "echoa"
            ? "echoA"
            : normalizedValue === "echo b" || normalizedValue === "echob"
              ? "echoB"
              : null
        : normalizedValue === "custom"
          ? "custom"
          : normalizedValue === "room a" || normalizedValue === "rooma"
            ? "roomA"
            : normalizedValue === "hall b" || normalizedValue === "hallb"
              ? "hallB"
              : null;
    if (!busValue) {
      return null;
    }
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.8,
      label: `Route ${track.name} ${intent.bus === "delay" ? "Delay" : "Reverb"} Bus`,
      explanation: intent.note ?? `Route ${track.name} ${intent.bus} to ${busValue}`,
      actions: [
        {
          type: "route_track_send_bus",
          trackId: track.id,
          bus: intent.bus,
          value: busValue as any,
        },
      ],
    };
  }

  if (type === "set_track_fx_param") {
    const intent = raw as unknown as SetTrackFxParamIntent;
    const track = resolveTrack(request, intent.track);
    if (!track || !intent.fxType || typeof intent.param !== "string") {
      return null;
    }
    const clamped = clampFxParamValue(intent.fxType, intent.param, intent.value);
    if (clamped === null) {
      return null;
    }
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.76,
      label: `Set ${intent.fxType} ${intent.param}`,
      explanation: intent.note ?? `Set ${track.name} ${intent.fxType} ${intent.param}`,
      actions: [
        {
          type: "set_track_insert_fx_param",
          trackId: track.id,
          fxId: intent.fxId,
          fxType: intent.fxType,
          param: intent.param,
          value: clamped,
        },
      ],
    };
  }

  if (type === "set_drum_step") {
    const intent = raw as unknown as SetDrumStepIntent;
    const track = resolveTrack(request, intent.track);
    if (!track || track.type !== "drums") {
      return null;
    }
    if (intent.lane !== "kick" && intent.lane !== "snare" && intent.lane !== "hat") {
      return null;
    }
    if (typeof intent.stepIndex !== "number") {
      return null;
    }
    const barIndex = Math.max(0, Math.round(typeof intent.barIndex === "number" ? intent.barIndex : request.scope.selectedBar ?? 0));
    const stepIndex = Math.max(0, Math.min(15, Math.round(intent.stepIndex)));
    const value = clamp01(typeof intent.value === "number" ? intent.value : 1);
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.78,
      label: `Set ${track.name} ${intent.lane} Step`,
      explanation: intent.note ?? `Set ${track.name} ${intent.lane} on step ${stepIndex + 1}`,
      actions: [
        {
          type: "set_drum_step",
          trackId: track.id,
          barIndex,
          stepIndex,
          lane: intent.lane,
          value,
        },
      ],
    };
  }

  if (type === "rotate_drum_bar_steps") {
    const intent = raw as unknown as RotateDrumBarStepsIntent;
    const track = resolveTrack(request, intent.track);
    if (!track || track.type !== "drums" || typeof intent.steps !== "number") {
      return null;
    }
    const barIndex = Math.max(0, Math.round(typeof intent.barIndex === "number" ? intent.barIndex : request.scope.selectedBar ?? 0));
    const steps = Math.round(intent.steps);
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.74,
      label: `Rotate ${track.name} Pattern Steps`,
      explanation: intent.note ?? `Rotate ${track.name} drum steps in bar ${barIndex + 1} by ${steps}`,
      actions: [
        {
          type: "rotate_drum_bar_steps",
          trackId: track.id,
          barIndex,
          steps,
        },
      ],
    };
  }

  if (type === "transpose_track_bar_notes") {
    const intent = raw as unknown as TransposeTrackBarNotesIntent;
    const track = resolveTrack(request, intent.track);
    if (!track || track.type !== "synth" || typeof intent.semitones !== "number") {
      return null;
    }
    const barIndex = Math.max(0, Math.round(typeof intent.barIndex === "number" ? intent.barIndex : request.scope.selectedBar ?? 0));
    const semitones = Math.max(-24, Math.min(24, Math.round(intent.semitones)));
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.76,
      label: `Transpose ${track.name} Bar Notes`,
      explanation: intent.note ?? `Transpose ${track.name} notes by ${semitones} semitones`,
      actions: [
        {
          type: "transpose_track_bar_notes",
          trackId: track.id,
          barIndex,
          semitones,
        },
      ],
    };
  }

  if (type === "copy_track_bar_assignment") {
    const intent = raw as unknown as CopyTrackBarAssignmentIntent;
    const track = resolveTrack(request, intent.track);
    if (!track || typeof intent.fromBarIndex !== "number" || typeof intent.toBarIndex !== "number") {
      return null;
    }
    const fromBarIndex = Math.max(0, Math.round(intent.fromBarIndex));
    const toBarIndex = Math.max(0, Math.round(intent.toBarIndex));
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.72,
      label: `Copy ${track.name} Bar`,
      explanation: intent.note ?? `Copy ${track.name} bar ${fromBarIndex + 1} to bar ${toBarIndex + 1}`,
      actions: [
        {
          type: "copy_track_bar_assignment",
          trackId: track.id,
          fromBarIndex,
          toBarIndex,
        },
      ],
    };
  }

  if (type === "rotate_track_bar_assignments") {
    const intent = raw as unknown as RotateTrackBarAssignmentsIntent;
    const track = resolveTrack(request, intent.track);
    if (
      !track ||
      typeof intent.fromBarIndex !== "number" ||
      typeof intent.toBarIndex !== "number" ||
      typeof intent.steps !== "number"
    ) {
      return null;
    }
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.7,
      label: `Rotate ${track.name} Bars (Arrangement)`,
      explanation:
        intent.note ??
        `Rotate ${track.name} bar assignments ${Math.round(intent.fromBarIndex) + 1}-${Math.round(intent.toBarIndex) + 1}`,
      actions: [
        {
          type: "rotate_track_bar_assignments",
          trackId: track.id,
          fromBarIndex: Math.max(0, Math.round(intent.fromBarIndex)),
          toBarIndex: Math.max(0, Math.round(intent.toBarIndex)),
          steps: Math.round(intent.steps),
        },
      ],
    };
  }

  if (type === "set_synth_step_notes_field") {
    const intent = raw as unknown as SetSynthStepNotesFieldIntent;
    const track = resolveTrack(request, intent.track);
    if (!track || track.type !== "synth" || (intent.field !== "velocity" && intent.field !== "length")) {
      return null;
    }
    if (typeof intent.stepIndex !== "number" || typeof intent.value !== "number") {
      return null;
    }
    const barIndex = Math.max(0, Math.round(typeof intent.barIndex === "number" ? intent.barIndex : request.scope.selectedBar ?? 0));
    const stepIndex = Math.max(0, Math.min(15, Math.round(intent.stepIndex)));
    const value =
      intent.field === "velocity"
        ? clamp01(intent.value)
        : Math.max(1, Math.min(16, Math.round(intent.value)));
    return {
      id: `provider-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      source: "smartPatch",
      confidence: intent.confidence ?? 0.72,
      label: `Set ${track.name} ${intent.field}`,
      explanation: intent.note ?? `Set ${track.name} ${intent.field} on step ${stepIndex + 1}`,
      actions: [
        {
          type: "set_synth_step_notes_field",
          trackId: track.id,
          barIndex,
          stepIndex,
          field: intent.field,
          value,
        },
      ],
    };
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
    const typedPlan = toTypedPlanCandidate(rawIntent, request);
    if (typedPlan) {
      const syntheticCanonical = toCanonicalCommand(rawIntent, request);
      if (syntheticCanonical) {
        canonicalCommands.push(syntheticCanonical.command);
        const adjusted = adjustConfidenceForPromptAlignment(request, syntheticCanonical.command, typedPlan.confidence);
        if (adjusted.rejectReason) {
          rejectedIntentCount += 1;
          continue;
        }
        plans.push({
          ...typedPlan,
          confidence: adjusted.confidence,
          explanation: typedPlan.explanation,
        });
        continue;
      }
      plans.push(typedPlan);
      continue;
    }

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
