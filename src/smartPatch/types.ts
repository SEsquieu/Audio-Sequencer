import { JsonPatchOp, SongState } from "../types/song";

export type SmartPatchScopeKind = "song" | "track" | "bar";

export interface SmartPatchScope {
  kind: SmartPatchScopeKind;
  trackIndex?: number;
  bar?: number;
}

export type SmartPatchAction =
  | "punchier_drums"
  | "lofi_tone"
  | "add_swing"
  | "add_variation"
  | "gentle_lift";

export interface SmartPatchIntent {
  action: SmartPatchAction;
  scope: SmartPatchScope;
  intensity: number;
}

export interface SmartPatchRuntimeContext {
  song: SongState;
  locks?: { [key: string]: boolean };
  selectedTrackId?: string;
  selectedBar?: number;
}

export type SmartPatchKnobId =
  | "drums.gain"
  | "drums.decay"
  | "synth.cutoff"
  | "synth.lofiAmount"
  | "song.swing"
  | "track.gain"
  | "variation.pitchShiftA"
  | "variation.pitchShiftB"
  | "synth.subOscMix"
  | "synth.noiseMix"
  | "synth.stereoWidth"
  | "synth.filterEnvAmount";

export interface SmartPatchKnob {
  id: SmartPatchKnobId;
  label: string;
  description: string;
  min: number;
  max: number;
  defaultDelta: number;
}

export interface SmartPatchProposal {
  id: string;
  label: string;
  explanation: string;
  ops: JsonPatchOp[];
  auditionBars?: number[];
  action: SmartPatchAction;
  scope: SmartPatchScope;
  knobs: SmartPatchKnobId[];
}

export type SmartPatchHandler = (
  intent: SmartPatchIntent,
  ctx: SmartPatchRuntimeContext
) => SmartPatchProposal | null;
