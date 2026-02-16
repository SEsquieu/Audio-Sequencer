import { SongState } from "../types/song";

const createEmptySynthSteps = () => Array.from({ length: 16 }, () => []);
const createEmptyDrumSteps = () => Array.from({ length: 16 }, () => ({ kick: 0, snare: 0, hat: 0 }));

export const createDefaultSong = (): SongState => ({
  tempo: 120,
  swing: 0,
  bars: 8,
  tracks: [
    {
      id: "t-lead",
      name: "Lead",
      type: "synth",
      instrument: {
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
      },
      patterns: {
        "1": {
          type: "synth",
          steps: createEmptySynthSteps(),
        },
      },
      lane: ["1", "1", "1", "1", "0", "0", "0", "0"],
    },
    {
      id: "t-bass",
      name: "Bass",
      type: "synth",
      instrument: {
        attack: 0.01,
        decay: 0.22,
        sustain: 0.45,
        release: 0.2,
        cutoff: 1500,
        resonance: 1.2,
        gain: 0.55,
        lofiAmount: 0,
        detune: 3,
        drive: 0.18,
        vibratoRate: 2.2,
        vibratoDepth: 4,
        oscWaveformA: "square",
        oscWaveformB: "sawtooth",
        oscMix: 0.35,
      },
      patterns: {
        "1": {
          type: "synth",
          steps: createEmptySynthSteps(),
        },
      },
      lane: ["1", "1", "1", "1", "0", "0", "0", "0"],
    },
    {
      id: "t-drums",
      name: "Drums",
      type: "drums",
      instrument: {
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
      },
      patterns: {
        "1": {
          type: "drums",
          steps: createEmptyDrumSteps(),
        },
      },
      lane: ["1", "1", "1", "1", "0", "0", "0", "0"],
    },
  ],
});
