import { InstrumentParams, TrackType } from "../types/song";

const SYNTH_DEFAULTS: InstrumentParams = {
  attack: 0.01,
  decay: 0.18,
  sustain: 0.5,
  release: 0.22,
  cutoff: 2200,
  resonance: 1,
  gain: 0.45,
  lofiAmount: 0,
  detune: 6,
  drive: 0.12,
  vibratoRate: 5.5,
  vibratoDepth: 8,
  oscWaveformA: "sawtooth",
  oscWaveformB: "square",
  oscMix: 0.5,
  subOscMix: 0.12,
  noiseMix: 0.04,
  stereoWidth: 0.35,
  filterEnvAmount: 0.25,
};

const DRUM_DEFAULTS: InstrumentParams = {
  attack: 0.001,
  decay: 0.12,
  sustain: 0,
  release: 0.06,
  cutoff: 8000,
  resonance: 0.2,
  gain: 0.7,
  lofiAmount: 0,
  detune: 0,
  drive: 0.08,
  vibratoRate: 0,
  vibratoDepth: 0,
  oscWaveformA: "triangle",
  oscWaveformB: "triangle",
  oscMix: 0.5,
  subOscMix: 0,
  noiseMix: 0,
  stereoWidth: 0,
  filterEnvAmount: 0,
};

export const buildDefaultInstrument = (type: TrackType): InstrumentParams =>
  type === "synth" ? { ...SYNTH_DEFAULTS } : { ...DRUM_DEFAULTS };

export const normalizeInstrumentParams = (type: TrackType, instrument: unknown): InstrumentParams => {
  const defaults = buildDefaultInstrument(type);
  if (!instrument || typeof instrument !== "object") {
    return defaults;
  }
  return {
    ...defaults,
    ...(instrument as Partial<InstrumentParams>),
  };
};

