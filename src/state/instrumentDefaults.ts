import { AdvancedSynthParams, InstrumentParams, TrackType } from "../types/song";

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
  const result = { ...defaults, ...(instrument as Partial<InstrumentParams>) };
  for (const [key, [min, max]] of Object.entries(instrumentRanges)) {
    const field = key as keyof typeof defaults;
    const value = result[field];
    (result as unknown as Record<string, unknown>)[key] = typeof value === "number" && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value)) : defaults[field];
  }
  for (const key of ["oscWaveformA", "oscWaveformB"] as const) {
    if (!["sine", "triangle", "sawtooth", "square"].includes(result[key])) result[key] = defaults[key];
  }
  if (result.advanced) {
    const a = { ...DEFAULT_ADVANCED, ...result.advanced };
    const ranges: Partial<Record<keyof AdvancedSynthParams, [number, number]>> = { tuneA: [-24,24], tuneB: [-24,24], keyTracking: [0,1], lfoRate: [.05,30], lfoDepth: [0,1] };
    for (const [key, [min,max]] of Object.entries(ranges)) {
      const v = (a as unknown as Record<string, unknown>)[key];
      (a as unknown as Record<string, unknown>)[key] = typeof v === "number" && Number.isFinite(v) ? Math.max(min,Math.min(max,v)) : (DEFAULT_ADVANCED as unknown as Record<string, unknown>)[key];
    }
    if (!["lowpass","highpass","bandpass","notch"].includes(a.filterMode)) a.filterMode = "lowpass";
    if (!["sine","triangle","square","sawtooth"].includes(a.lfoWaveform)) a.lfoWaveform = "sine";
    if (!["free","1/1","1/2","1/4","1/8","1/16"].includes(a.lfoSync)) a.lfoSync = "free";
    if (!["cutoff","pitch","pan","amplitude"].includes(a.lfoTarget)) a.lfoTarget = "cutoff";
    result.advanced = a;
  }
  return result;
};


export const DEFAULT_ADVANCED: AdvancedSynthParams = {
  tuneA: 0, tuneB: 0, filterMode: "lowpass", keyTracking: 0,
  lfoWaveform: "sine", lfoRate: 1, lfoSync: "free", lfoTarget: "cutoff", lfoDepth: 0,
};
export const instrumentRanges: Record<string, [number, number]> = {
 attack: [0, 10], decay: [0, 10], sustain: [0, 1], release: [0, 20],
 cutoff: [20, 20000], resonance: [.001, 20], gain: [0, 1.2], lofiAmount: [0, 1],
 detune: [0, 100], drive: [0, 1], vibratoRate: [0, 30], vibratoDepth: [0, 100],
 oscMix: [0, 1], subOscMix: [0, 1], noiseMix: [0, 1], stereoWidth: [0, 1], filterEnvAmount: [0, 1],
};
