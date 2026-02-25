import type { FxType } from "../../audio/fx/types";
import { DelayBusTargetId, DrumStep, InstrumentParams, JsonPatchOp, PatchMeta, ReverbBusTargetId, SongState } from "../../types/song";
import { AiProviderId } from "../providers/types";

export interface DiffEngineScope {
  selectedTrackId?: string;
  selectedBar?: number;
}

export interface DiffEngineRequest {
  prompt: string;
  song: SongState;
  scope: DiffEngineScope;
  intensity?: number;
  locks?: Record<string, boolean>;
  maxCandidates?: number;
  isPlaying?: boolean;
  preferOffline?: boolean;
  providerPreference?: string | "auto";
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type DiffPlanAction =
  | {
      type: "json_patch";
      ops: JsonPatchOp[];
      label?: string;
      explanation?: string;
      auditionBars?: number[];
    }
  | {
      type: "set_track_param";
      trackId: string;
      param: keyof InstrumentParams;
      value: number | string;
      label?: string;
      explanation?: string;
    }
  | {
      type: "set_track_send";
      trackId: string;
      send: "delay" | "reverb" | "delayTone" | "reverbTone" | "reverbLowCut";
      value: number;
      label?: string;
      explanation?: string;
    }
  | {
      type: "route_track_send_bus";
      trackId: string;
      bus: "delay" | "reverb";
      value: DelayBusTargetId | ReverbBusTargetId;
      label?: string;
      explanation?: string;
    }
  | {
      type: "add_track_insert_fx";
      trackId: string;
      fxType: FxType;
      label?: string;
      explanation?: string;
    }
  | {
      type: "set_track_insert_fx_param";
      trackId: string;
      fxId?: string;
      fxType?: FxType;
      param: string;
      value: number | string | boolean;
      label?: string;
      explanation?: string;
    }
  | {
      type: "set_drum_step";
      trackId: string;
      barIndex: number;
      stepIndex: number;
      lane: keyof DrumStep;
      value: number;
      label?: string;
      explanation?: string;
    }
  | {
      type: "transpose_track_bar_notes";
      trackId: string;
      barIndex: number;
      semitones: number;
      clampMin?: number;
      clampMax?: number;
      label?: string;
      explanation?: string;
    }
  | {
      type: "copy_track_bar_assignment";
      trackId: string;
      fromBarIndex: number;
      toBarIndex: number;
      label?: string;
      explanation?: string;
    }
  | {
      type: "rotate_track_bar_assignments";
      trackId: string;
      fromBarIndex: number;
      toBarIndex: number;
      steps: number;
      label?: string;
      explanation?: string;
    }
  | {
      type: "set_synth_step_notes_field";
      trackId: string;
      barIndex: number;
      stepIndex: number;
      field: "velocity" | "length";
      value: number;
      label?: string;
      explanation?: string;
    };

export interface DiffPlanCandidate {
  id: string;
  source: "ruleParser" | "smartPatch";
  confidence?: number;
  label?: string;
  explanation?: string;
  actions: DiffPlanAction[];
}

export interface CompiledDiffCandidate {
  patch: PatchMeta;
  source: DiffPlanCandidate["source"];
  confidence: number;
  affectedPaths: string[];
  warnings: string[];
  opCount: number;
}

export interface DiffValidationResult {
  ok: boolean;
  warnings: string[];
  affectedPaths: string[];
  error?: string;
}

export interface DiffEngineDiagnostics {
  selectedProviderId: AiProviderId;
  fallbackProviderIds: AiProviderId[];
  routeReason: string;
  usedFallback: boolean;
  fallbackReason?: string;
  providerRawIntentCount?: number;
  providerCompiledPlanCount?: number;
  providerCanonicalCommands?: string[];
  rejectedProviderIntentCount?: number;
  providerRawResponsePreview?: string;
}

export interface DiffEngineResult {
  patches: PatchMeta[];
  diagnostics: DiffEngineDiagnostics;
}
