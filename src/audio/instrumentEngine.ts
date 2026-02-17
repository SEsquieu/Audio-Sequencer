import { Track } from "../types/song";

const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const MIN_GAIN = 0.0001;
const PARAM_SMOOTH_TIME = 0.008;
const MAX_SYNTH_VOICES_PER_TRACK = 12;

type VoiceState = "active" | "release" | "free";

interface SynthVoice {
  id: number;
  trackId: string;
  state: VoiceState;
  activeUntil: number;
  amp: GainNode;
  filter: BiquadFilterNode;
  shaper: WaveShaperNode;
  mix: GainNode;
  aGain: GainNode;
  bGain: GainNode;
}

export interface VoiceDiagnostics {
  synthVoiceSteals: number;
  synthVoiceStealsByTrack: Record<string, number>;
}

const createDriveCurve = (amount: number): Float32Array => {
  const samples = 512;
  const curve = new Float32Array(samples);
  const k = Math.max(0, amount) * 60 + 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
};

const smoothParam = (param: AudioParam, value: number, when: number, time = PARAM_SMOOTH_TIME): void => {
  param.cancelScheduledValues(when);
  param.setTargetAtTime(value, when, time);
};

class SynthVoicePool {
  private voices = new Map<string, SynthVoice[]>();
  private nextVoiceId = 1;
  private steals = 0;
  private stealsByTrack = new Map<string, number>();

  constructor(private readonly getContext: () => AudioContext | null) {}

  stopAll(): void {
    const context = this.getContext();
    if (!context) {
      return;
    }
    const now = context.currentTime;
    for (const voiceList of this.voices.values()) {
      for (const voice of voiceList) {
        voice.amp.gain.cancelScheduledValues(now);
        voice.amp.gain.setTargetAtTime(MIN_GAIN, now, 0.01);
        voice.state = "free";
        voice.activeUntil = now;
      }
    }
  }

  resetDiagnostics(): void {
    this.steals = 0;
    this.stealsByTrack.clear();
  }

  getDiagnostics(): VoiceDiagnostics {
    return {
      synthVoiceSteals: this.steals,
      synthVoiceStealsByTrack: Object.fromEntries(this.stealsByTrack.entries()),
    };
  }

  getVoice(track: Track, output: AudioNode, when: number): SynthVoice | null {
    const context = this.getContext();
    if (!context) {
      return null;
    }

    let pool = this.voices.get(track.id);
    if (!pool) {
      pool = [];
      this.voices.set(track.id, pool);
    }

    for (const voice of pool) {
      if (voice.activeUntil <= when || voice.state === "free") {
        voice.state = "active";
        return voice;
      }
    }

    if (pool.length < MAX_SYNTH_VOICES_PER_TRACK) {
      const voice = this.createVoice(context, track.id, output);
      pool.push(voice);
      voice.state = "active";
      return voice;
    }

    const fallback = [...pool].sort((a, b) => a.activeUntil - b.activeUntil)[0];
    this.steals += 1;
    this.stealsByTrack.set(track.id, (this.stealsByTrack.get(track.id) ?? 0) + 1);
    fallback.state = "active";
    fallback.amp.gain.cancelScheduledValues(when);
    fallback.amp.gain.setValueAtTime(MIN_GAIN, when);
    return fallback;
  }

  private createVoice(context: AudioContext, trackId: string, output: AudioNode): SynthVoice {
    const mix = context.createGain();
    const aGain = context.createGain();
    const bGain = context.createGain();
    const shaper = context.createWaveShaper();
    const filter = context.createBiquadFilter();
    const amp = context.createGain();

    aGain.gain.setValueAtTime(MIN_GAIN, context.currentTime);
    bGain.gain.setValueAtTime(MIN_GAIN, context.currentTime);
    amp.gain.setValueAtTime(MIN_GAIN, context.currentTime);
    shaper.oversample = "2x";
    filter.type = "lowpass";

    aGain.connect(mix);
    bGain.connect(mix);
    mix.connect(shaper);
    shaper.connect(filter);
    filter.connect(amp);
    amp.connect(output);

    return {
      id: this.nextVoiceId++,
      trackId,
      state: "free",
      activeUntil: context.currentTime,
      amp,
      filter,
      shaper,
      mix,
      aGain,
      bGain,
    };
  }
}

export class InstrumentEngine {
  private readonly synthVoices: SynthVoicePool;

  constructor(
    private readonly getContext: () => AudioContext | null,
    private readonly getNoiseBuffer: () => AudioBuffer | null,
    private readonly getTrackOutputNode: (trackId: string) => AudioNode | null
  ) {
    this.synthVoices = new SynthVoicePool(getContext);
  }

  stopAllVoices(): void {
    this.synthVoices.stopAll();
  }

  resetDiagnostics(): void {
    this.synthVoices.resetDiagnostics();
  }

  getDiagnostics(): VoiceDiagnostics {
    return this.synthVoices.getDiagnostics();
  }

  playSynthNote(
    track: Track,
    pitch: number,
    velocity: number,
    lengthSteps: number,
    when: number,
    tempo: number
  ): void {
    const context = this.getContext();
    if (!context) {
      return;
    }
    const output = this.getTrackOutputNode(track.id);
    if (!output) {
      return;
    }

    const voice = this.synthVoices.getVoice(track, output, when);
    if (!voice) {
      return;
    }

    const {
      attack,
      decay,
      sustain,
      release,
      cutoff,
      resonance,
      gain,
      lofiAmount,
      detune,
      drive,
      vibratoRate,
      vibratoDepth,
      oscWaveformA,
      oscWaveformB,
      oscMix,
    } = track.instrument;

    const stepDuration = 60 / tempo / 4;
    const noteDuration = Math.max(0.04, stepDuration * lengthSteps);
    const safeAttack = Math.max(0.0025, attack);
    const safeRelease = Math.max(0.01, release);
    const detuneCents = Math.max(0, detune);
    const mixAmount = Math.max(0, Math.min(1, oscMix));
    const oscFadeIn = 0.0015;
    const oscFadeOut = 0.003;
    const peak = Math.max(MIN_GAIN, gain * velocity);
    const stopAt = when + noteDuration + safeRelease + 0.02;
    const fadeOutAt = Math.max(when + oscFadeIn, stopAt - oscFadeOut);

    smoothParam(voice.filter.frequency, Math.max(120, cutoff * (1 - lofiAmount * 0.3)), when);
    smoothParam(voice.filter.Q, Math.max(0.001, resonance), when);
    voice.shaper.curve = createDriveCurve(Math.max(0, Math.min(1, drive))) as unknown as Float32Array<ArrayBuffer>;

    voice.aGain.gain.cancelScheduledValues(when);
    voice.bGain.gain.cancelScheduledValues(when);
    voice.aGain.gain.setValueAtTime(MIN_GAIN, when);
    voice.bGain.gain.setValueAtTime(MIN_GAIN, when);
    voice.aGain.gain.linearRampToValueAtTime(Math.max(MIN_GAIN, 1 - mixAmount), when + oscFadeIn);
    voice.bGain.gain.linearRampToValueAtTime(Math.max(MIN_GAIN, mixAmount), when + oscFadeIn);
    voice.aGain.gain.setValueAtTime(Math.max(MIN_GAIN, 1 - mixAmount), fadeOutAt);
    voice.bGain.gain.setValueAtTime(Math.max(MIN_GAIN, mixAmount), fadeOutAt);
    voice.aGain.gain.linearRampToValueAtTime(MIN_GAIN, stopAt);
    voice.bGain.gain.linearRampToValueAtTime(MIN_GAIN, stopAt);

    voice.amp.gain.cancelScheduledValues(when);
    voice.amp.gain.setValueAtTime(MIN_GAIN, when);
    voice.amp.gain.linearRampToValueAtTime(peak, when + safeAttack);
    voice.amp.gain.linearRampToValueAtTime(Math.max(MIN_GAIN, peak * sustain), when + safeAttack + decay);
    voice.amp.gain.setValueAtTime(Math.max(MIN_GAIN, peak * sustain), when + noteDuration);
    voice.amp.gain.linearRampToValueAtTime(MIN_GAIN, when + noteDuration + safeRelease);

    const oscA = context.createOscillator();
    const oscB = context.createOscillator();
    oscA.type = oscWaveformA;
    oscB.type = oscWaveformB;
    const baseFreq = midiToFreq(pitch);
    oscA.frequency.setValueAtTime(baseFreq, when);
    oscB.frequency.setValueAtTime(baseFreq, when);
    oscA.detune.setValueAtTime(-detuneCents * 0.5, when);
    oscB.detune.setValueAtTime(detuneCents * 0.5, when);
    oscA.connect(voice.aGain);
    oscB.connect(voice.bGain);

    let lfo: OscillatorNode | null = null;
    let lfoDepth: GainNode | null = null;
    if (vibratoDepth > 0.001 && vibratoRate > 0.001) {
      lfo = context.createOscillator();
      lfoDepth = context.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(vibratoRate, when);
      lfoDepth.gain.setValueAtTime(vibratoDepth, when);
      lfo.connect(lfoDepth);
      lfoDepth.connect(oscA.detune);
      lfoDepth.connect(oscB.detune);
    }

    oscA.start(when);
    oscB.start(when);
    lfo?.start(when);
    oscA.stop(stopAt);
    oscB.stop(stopAt);
    lfo?.stop(stopAt);
    voice.activeUntil = stopAt;
    voice.state = "release";

    let remainingEnded = 2;
    const markEnded = () => {
      remainingEnded -= 1;
      if (remainingEnded > 0) {
        return;
      }
      if (voice.activeUntil <= context.currentTime + 0.001) {
        voice.state = "free";
      }
    };
    oscA.onended = markEnded;
    oscB.onended = markEnded;
  }

  playKick(track: Track, when: number, velocity: number): void {
    const context = this.getContext();
    const noiseBuffer = this.getNoiseBuffer();
    if (!context) {
      return;
    }
    const output = this.getTrackOutputNode(track.id);
    if (!output || !noiseBuffer) {
      return;
    }

    const body = context.createOscillator();
    const bodyAmp = context.createGain();
    const transientNoise = context.createBufferSource();
    const transientFilter = context.createBiquadFilter();
    const transientAmp = context.createGain();
    const transientTone = context.createOscillator();
    const transientToneAmp = context.createGain();
    const mix = context.createGain();
    const drive = context.createWaveShaper();
    const tone = context.createBiquadFilter();

    const decay = Math.max(0.08, track.instrument.decay * 0.75 + 0.08);
    const level = Math.max(MIN_GAIN, velocity * track.instrument.gain * 1.35);
    const punch = Math.max(0, Math.min(1, track.instrument.drive * 1.15 + 0.2));
    const startFreq = 178 + punch * 32;
    const endFreq = 45 + punch * 8;
    const transientEnd = when + Math.min(0.022, decay * 0.24);

    body.type = "sine";
    body.frequency.setValueAtTime(startFreq, when);
    body.frequency.exponentialRampToValueAtTime(endFreq, when + decay * 0.95);

    bodyAmp.gain.setValueAtTime(MIN_GAIN, when);
    bodyAmp.gain.linearRampToValueAtTime(level, when + 0.0016);
    bodyAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, when + decay);

    transientNoise.buffer = noiseBuffer;
    transientFilter.type = "bandpass";
    transientFilter.frequency.setValueAtTime(1850, when);
    transientFilter.Q.setValueAtTime(0.9, when);
    transientAmp.gain.setValueAtTime(MIN_GAIN, when);
    transientAmp.gain.linearRampToValueAtTime(level * 0.24, when + 0.001);
    transientAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, transientEnd);

    transientTone.type = "triangle";
    transientTone.frequency.setValueAtTime(780, when);
    transientTone.frequency.exponentialRampToValueAtTime(180, transientEnd);
    transientToneAmp.gain.setValueAtTime(MIN_GAIN, when);
    transientToneAmp.gain.linearRampToValueAtTime(level * 0.18, when + 0.0008);
    transientToneAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, transientEnd);

    drive.curve = createDriveCurve(Math.max(0.15, Math.min(0.65, punch))) as unknown as Float32Array<ArrayBuffer>;
    drive.oversample = "2x";

    tone.type = "lowpass";
    tone.frequency.setValueAtTime(2200, when);
    tone.Q.setValueAtTime(0.15, when);

    body.connect(bodyAmp);
    bodyAmp.connect(mix);

    transientNoise.connect(transientFilter);
    transientFilter.connect(transientAmp);
    transientAmp.connect(mix);

    transientTone.connect(transientToneAmp);
    transientToneAmp.connect(mix);

    mix.connect(drive);
    drive.connect(tone);
    tone.connect(output);

    body.start(when);
    transientNoise.start(when);
    transientTone.start(when);

    body.stop(when + decay + 0.035);
    transientNoise.stop(transientEnd + 0.006);
    transientTone.stop(transientEnd + 0.006);
  }

  playSnare(track: Track, when: number, velocity: number): void {
    const context = this.getContext();
    const noiseBuffer = this.getNoiseBuffer();
    if (!context || !noiseBuffer) {
      return;
    }
    const output = this.getTrackOutputNode(track.id);
    if (!output) {
      return;
    }

    const decay = Math.max(0.05, track.instrument.decay + 0.05);
    const gain = Math.max(MIN_GAIN, velocity * track.instrument.gain);

    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1800, when);

    const noiseAmp = context.createGain();
    noiseAmp.gain.setValueAtTime(MIN_GAIN, when);
    noiseAmp.gain.linearRampToValueAtTime(gain * 0.72, when + 0.0015);
    noiseAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, when + decay);

    const tone = context.createOscillator();
    tone.type = "triangle";
    tone.frequency.setValueAtTime(190, when);

    const toneAmp = context.createGain();
    toneAmp.gain.setValueAtTime(MIN_GAIN, when);
    toneAmp.gain.linearRampToValueAtTime(gain * 0.33, when + 0.0015);
    toneAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, when + decay * 0.8);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseAmp);
    noiseAmp.connect(output);

    tone.connect(toneAmp);
    toneAmp.connect(output);

    noise.start(when);
    noise.stop(when + decay + 0.02);
    tone.start(when);
    tone.stop(when + decay + 0.02);
  }

  playHat(track: Track, when: number, velocity: number): void {
    const context = this.getContext();
    const noiseBuffer = this.getNoiseBuffer();
    if (!context || !noiseBuffer) {
      return;
    }
    const output = this.getTrackOutputNode(track.id);
    if (!output) {
      return;
    }

    const source = context.createBufferSource();
    source.buffer = noiseBuffer;

    const hp = context.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(5200, when);

    const amp = context.createGain();
    amp.gain.setValueAtTime(MIN_GAIN, when);
    amp.gain.linearRampToValueAtTime(
      Math.max(MIN_GAIN, velocity * track.instrument.gain * 0.46),
      when + 0.001
    );
    amp.gain.exponentialRampToValueAtTime(MIN_GAIN, when + 0.04);

    source.connect(hp);
    hp.connect(amp);
    amp.connect(output);

    source.start(when);
    source.stop(when + 0.05);
  }
}

const makeSeededRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

export const createNoiseBuffer = (context: AudioContext, seed = 0x5eed1234): AudioBuffer => {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = makeSeededRng(seed ^ context.sampleRate);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = rng() * 2 - 1;
  }
  return buffer;
};
