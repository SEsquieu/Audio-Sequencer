import type { FxInstance } from "../audio/fx/types";

export type TrackType = "synth" | "drums";
export type WaveformType = "sine" | "triangle" | "sawtooth" | "square";
export type DelayBusTargetId = "custom" | "echoA" | "echoB";
export type ReverbBusTargetId = "custom" | "roomA" | "hallB";

export interface InstrumentParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
  resonance: number;
  gain: number;
  lofiAmount: number;
  detune: number;
  drive: number;
  vibratoRate: number;
  vibratoDepth: number;
  oscWaveformA: WaveformType;
  oscWaveformB: WaveformType;
  oscMix: number;
  subOscMix: number;
  noiseMix: number;
  stereoWidth: number;
  filterEnvAmount: number;
}

export interface SynthStep {
  pitch: number;
  length: number;
  velocity: number;
}

export interface DrumStep {
  kick: number;
  snare: number;
  hat: number;
}

export interface SynthPattern {
  type: "synth";
  steps: SynthStep[][];
}

export interface DrumPattern {
  type: "drums";
  steps: DrumStep[];
}

export type Pattern = SynthPattern | DrumPattern;

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  instrument: InstrumentParams;
  patterns: Record<string, Pattern>;
  lane: string[];
  send: {
    delay: number;
    reverb: number;
    delayTone: number;
    reverbTone: number;
    reverbLowCut: number;
    delayBus: DelayBusTargetId;
    reverbBus: ReverbBusTargetId;
  };
  insertFx: FxInstance[];
}

export type DelayDivision = "1/4" | "1/8" | "1/8d" | "1/16";

export interface DelayBusFxState {
  division: DelayDivision;
  feedback: number;
  wet: number;
  tone: number;
}

export interface ReverbBusFxState {
  preDelay: number;
  decay: number;
  tone: number;
  wet: number;
  eco: boolean;
}

export interface SendFxState {
  delay: DelayBusFxState;
  reverb: ReverbBusFxState;
}

export interface MasterSafetyState {
  enabled: boolean;
  amount: number;
}

export interface PerformanceState {
  ecoMode: boolean;
}

export interface SongState {
  tempo: number;
  swing: number;
  bars: number;
  tracks: Track[];
  masterFx: FxInstance[];
  sendFx: SendFxState;
  masterSafety: MasterSafetyState;
  performance: PerformanceState;
}

export type JsonPatchOp = {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
};

export interface PatchMeta {
  id: string;
  author: "user" | "ai";
  label: string;
  explanation: string;
  ops: JsonPatchOp[];
  auditionBars?: number[];
}

export interface HistoryEntry {
  patch: PatchMeta;
  inverseOps: JsonPatchOp[];
}
