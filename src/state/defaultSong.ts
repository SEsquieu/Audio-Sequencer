import { SongState } from "../types/song";

const synthSteps = Array.from({ length: 16 }, (_, i) => {
  if (i % 4 === 0) {
    return [{ pitch: 60 + (i % 8 === 0 ? 0 : 4), length: 1, velocity: 0.9 }];
  }
  return [];
});

const drumSteps = Array.from({ length: 16 }, (_, i) => ({
  kick: i % 4 === 0 ? 1 : 0,
  snare: i % 8 === 4 ? 1 : 0,
  hat: i % 2 === 0 ? 0.6 : 0,
}));

const emptySynthSteps = Array.from({ length: 16 }, () => []);
const emptyDrumSteps = Array.from({ length: 16 }, () => ({ kick: 0, snare: 0, hat: 0 }));

export const createDefaultSong = (): SongState => ({
  tempo: 120,
  swing: 0,
  bars: 8,
  tracks: [
    {
      id: "t-synth",
      name: "Lead Synth",
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
      },
      patterns: {
        "1": {
          type: "synth",
          steps: synthSteps,
        },
        "2": {
          type: "synth",
          steps: emptySynthSteps,
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
      },
      patterns: {
        "1": {
          type: "drums",
          steps: drumSteps,
        },
        "2": {
          type: "drums",
          steps: emptyDrumSteps,
        },
      },
      lane: ["1", "1", "1", "1", "0", "0", "0", "0"],
    },
  ],
});
