import { SongState } from "../types/song";
import { buildDefaultInstrument } from "./instrumentDefaults";

const createEmptySynthSteps = () => Array.from({ length: 16 }, () => []);
const createEmptyDrumSteps = () => Array.from({ length: 16 }, () => ({ kick: 0, snare: 0, hat: 0 }));
const createDefaultTrackSend = () => ({
  delay: 0,
  reverb: 0,
  delayTone: 0.72,
  reverbTone: 0.62,
  reverbLowCut: 0.24,
});
const createDefaultSendFx = () => ({
  delay: {
    division: "1/8" as const,
    feedback: 0.42,
    wet: 0.34,
    tone: 0.72,
  },
  reverb: {
    preDelay: 0.08,
    decay: 0.48,
    tone: 0.62,
    wet: 0.42,
    eco: false,
  },
});
const createDefaultMasterSafety = () => ({
  enabled: false,
  amount: 0.08,
});

export const createDefaultSong = (): SongState => ({
  tempo: 120,
  swing: 0,
  bars: 8,
  masterFx: [],
  sendFx: createDefaultSendFx(),
  masterSafety: createDefaultMasterSafety(),
  tracks: [
    {
      id: "t-lead",
      name: "Lead",
      type: "synth",
      instrument: {
        ...buildDefaultInstrument("synth"),
      },
      patterns: {
        "1": {
          type: "synth",
          steps: createEmptySynthSteps(),
        },
      },
      lane: ["1", "1", "1", "1", "0", "0", "0", "0"],
      send: createDefaultTrackSend(),
      insertFx: [],
    },
    {
      id: "t-bass",
      name: "Bass",
      type: "synth",
      instrument: {
        ...buildDefaultInstrument("synth"),
        attack: 0.01,
        decay: 0.22,
        sustain: 0.45,
        release: 0.2,
        cutoff: 1500,
        resonance: 1.2,
        gain: 0.55,
        detune: 3,
        drive: 0.18,
        vibratoRate: 2.2,
        vibratoDepth: 4,
        oscWaveformA: "square",
        oscWaveformB: "sawtooth",
        oscMix: 0.35,
        subOscMix: 0.28,
        noiseMix: 0.01,
        stereoWidth: 0.18,
        filterEnvAmount: 0.16,
      },
      patterns: {
        "1": {
          type: "synth",
          steps: createEmptySynthSteps(),
        },
      },
      lane: ["1", "1", "1", "1", "0", "0", "0", "0"],
      send: createDefaultTrackSend(),
      insertFx: [],
    },
    {
      id: "t-drums",
      name: "Drums",
      type: "drums",
      instrument: {
        ...buildDefaultInstrument("drums"),
      },
      patterns: {
        "1": {
          type: "drums",
          steps: createEmptyDrumSteps(),
        },
      },
      lane: ["1", "1", "1", "1", "0", "0", "0", "0"],
      send: createDefaultTrackSend(),
      insertFx: [],
    },
  ],
});
