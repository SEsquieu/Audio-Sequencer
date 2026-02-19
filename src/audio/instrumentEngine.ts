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
  subGain: GainNode;
  noiseGain: GainNode;
  aPan: StereoPannerNode;
  bPan: StereoPannerNode;
  subPan: StereoPannerNode;
  noiseFilter: BiquadFilterNode;
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
    const subGain = context.createGain();
    const noiseGain = context.createGain();
    const aPan = context.createStereoPanner();
    const bPan = context.createStereoPanner();
    const subPan = context.createStereoPanner();
    const noiseFilter = context.createBiquadFilter();
    const shaper = context.createWaveShaper();
    const filter = context.createBiquadFilter();
    const amp = context.createGain();

    aGain.gain.setValueAtTime(MIN_GAIN, context.currentTime);
    bGain.gain.setValueAtTime(MIN_GAIN, context.currentTime);
    subGain.gain.setValueAtTime(MIN_GAIN, context.currentTime);
    noiseGain.gain.setValueAtTime(MIN_GAIN, context.currentTime);
    amp.gain.setValueAtTime(MIN_GAIN, context.currentTime);
    shaper.oversample = "2x";
    filter.type = "lowpass";
    noiseFilter.type = "highpass";
    noiseFilter.frequency.setValueAtTime(2500, context.currentTime);

    aPan.connect(aGain);
    bPan.connect(bGain);
    subPan.connect(subGain);
    noiseFilter.connect(noiseGain);
    aGain.connect(mix);
    bGain.connect(mix);
    subGain.connect(mix);
    noiseGain.connect(mix);
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
      subGain,
      noiseGain,
      aPan,
      bPan,
      subPan,
      noiseFilter,
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
      subOscMix,
      noiseMix,
      stereoWidth,
      filterEnvAmount,
    } = track.instrument;

    const stepDuration = 60 / tempo / 4;
    const noteDuration = Math.max(0.04, stepDuration * lengthSteps);
    const safeAttack = Math.max(0.0025, attack);
    const safeRelease = Math.max(0.01, release);
    const detuneCents = Math.max(0, detune);
    const mixAmount = Math.max(0, Math.min(1, oscMix));
    const safeSubMix = Math.max(0, Math.min(1, subOscMix));
    const safeNoiseMix = Math.max(0, Math.min(1, noiseMix));
    const safeWidth = Math.max(0, Math.min(1, stereoWidth));
    const mainLayer = Math.max(MIN_GAIN, 1 - safeSubMix - safeNoiseMix);
    const layerNorm = mainLayer + safeSubMix + safeNoiseMix;
    const oscLayer = mainLayer / layerNorm;
    const subLayer = safeSubMix / layerNorm;
    const noiseLayer = safeNoiseMix / layerNorm;
    const oscAAmount = Math.max(MIN_GAIN, (1 - mixAmount) * oscLayer);
    const oscBAmount = Math.max(MIN_GAIN, mixAmount * oscLayer);
    const subAmount = Math.max(MIN_GAIN, subLayer);
    const noiseAmount = Math.max(MIN_GAIN, noiseLayer);
    const oscFadeIn = 0.0015;
    const oscFadeOut = 0.003;
    const peak = Math.max(MIN_GAIN, gain * velocity);
    const stopAt = when + noteDuration + safeRelease + 0.02;
    const fadeOutAt = Math.max(when + oscFadeIn, stopAt - oscFadeOut);

    const baseCutoff = Math.max(120, cutoff * (1 - lofiAmount * 0.3));
    const envAmount = Math.max(0, Math.min(1, filterEnvAmount));
    const envCutoff = Math.min(12000, baseCutoff * (1 + envAmount * 2.2));
    voice.filter.frequency.cancelScheduledValues(when);
    voice.filter.frequency.setValueAtTime(envCutoff, when);
    voice.filter.frequency.exponentialRampToValueAtTime(Math.max(120, baseCutoff), when + safeAttack + Math.max(0.02, decay));
    smoothParam(voice.filter.Q, Math.max(0.001, resonance), when);
    voice.shaper.curve = createDriveCurve(Math.max(0, Math.min(1, drive))) as unknown as Float32Array<ArrayBuffer>;
    smoothParam(voice.noiseFilter.frequency, Math.max(1000, Math.min(10000, baseCutoff * 1.7)), when);
    smoothParam(voice.aPan.pan, -safeWidth * 0.65, when);
    smoothParam(voice.bPan.pan, safeWidth * 0.65, when);
    smoothParam(voice.subPan.pan, -safeWidth * 0.2, when);

    voice.aGain.gain.cancelScheduledValues(when);
    voice.bGain.gain.cancelScheduledValues(when);
    voice.subGain.gain.cancelScheduledValues(when);
    voice.noiseGain.gain.cancelScheduledValues(when);
    voice.aGain.gain.setValueAtTime(MIN_GAIN, when);
    voice.bGain.gain.setValueAtTime(MIN_GAIN, when);
    voice.subGain.gain.setValueAtTime(MIN_GAIN, when);
    voice.noiseGain.gain.setValueAtTime(MIN_GAIN, when);
    voice.aGain.gain.linearRampToValueAtTime(oscAAmount, when + oscFadeIn);
    voice.bGain.gain.linearRampToValueAtTime(oscBAmount, when + oscFadeIn);
    voice.subGain.gain.linearRampToValueAtTime(subAmount, when + oscFadeIn);
    voice.noiseGain.gain.linearRampToValueAtTime(noiseAmount, when + oscFadeIn);
    voice.aGain.gain.setValueAtTime(oscAAmount, fadeOutAt);
    voice.bGain.gain.setValueAtTime(oscBAmount, fadeOutAt);
    voice.subGain.gain.setValueAtTime(subAmount, fadeOutAt);
    voice.noiseGain.gain.setValueAtTime(noiseAmount, fadeOutAt);
    voice.aGain.gain.linearRampToValueAtTime(MIN_GAIN, stopAt);
    voice.bGain.gain.linearRampToValueAtTime(MIN_GAIN, stopAt);
    voice.subGain.gain.linearRampToValueAtTime(MIN_GAIN, stopAt);
    voice.noiseGain.gain.linearRampToValueAtTime(MIN_GAIN, stopAt);

    voice.amp.gain.cancelScheduledValues(when);
    voice.amp.gain.setValueAtTime(MIN_GAIN, when);
    voice.amp.gain.linearRampToValueAtTime(peak, when + safeAttack);
    voice.amp.gain.linearRampToValueAtTime(Math.max(MIN_GAIN, peak * sustain), when + safeAttack + decay);
    voice.amp.gain.setValueAtTime(Math.max(MIN_GAIN, peak * sustain), when + noteDuration);
    voice.amp.gain.linearRampToValueAtTime(MIN_GAIN, when + noteDuration + safeRelease);

    const oscA = context.createOscillator();
    const oscB = context.createOscillator();
    const oscSub = context.createOscillator();
    const noise = context.createBufferSource();
    const noiseBuffer = this.getNoiseBuffer();
    oscA.type = oscWaveformA;
    oscB.type = oscWaveformB;
    oscSub.type = oscWaveformA === "sine" ? "sine" : "triangle";
    const baseFreq = midiToFreq(pitch);
    oscA.frequency.setValueAtTime(baseFreq, when);
    oscB.frequency.setValueAtTime(baseFreq, when);
    oscSub.frequency.setValueAtTime(Math.max(20, baseFreq * 0.5), when);
    oscA.detune.setValueAtTime(-detuneCents * 0.5, when);
    oscB.detune.setValueAtTime(detuneCents * 0.5, when);
    oscSub.detune.setValueAtTime(-detuneCents * 0.15, when);
    oscA.connect(voice.aPan);
    oscB.connect(voice.bPan);
    oscSub.connect(voice.subPan);
    if (noiseBuffer) {
      noise.buffer = noiseBuffer;
      noise.connect(voice.noiseFilter);
    }

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
      lfoDepth.connect(oscSub.detune);
    }

    oscA.start(when);
    oscB.start(when);
    oscSub.start(when);
    if (noise.buffer) {
      noise.start(when);
    }
    lfo?.start(when);
    oscA.stop(stopAt);
    oscB.stop(stopAt);
    oscSub.stop(stopAt);
    if (noise.buffer) {
      noise.stop(stopAt);
    }
    lfo?.stop(stopAt);
    voice.activeUntil = stopAt;
    voice.state = "release";

    let remainingEnded = 3;
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
    oscSub.onended = markEnded;
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

    const decay = Math.max(0.09, track.instrument.decay * 0.8 + 0.1);
    const level = Math.max(MIN_GAIN, velocity * track.instrument.gain * 1.12);
    const snap = Math.max(0, Math.min(1, track.instrument.drive * 1.1 + 0.18));

    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseHp = context.createBiquadFilter();
    const noiseBp = context.createBiquadFilter();
    const noiseAmp = context.createGain();

    const snapNoise = context.createBufferSource();
    snapNoise.buffer = noiseBuffer;
    const snapHp = context.createBiquadFilter();
    const snapAmp = context.createGain();

    const toneA = context.createOscillator();
    const toneB = context.createOscillator();
    const toneAmp = context.createGain();

    const mix = context.createGain();
    const drive = context.createWaveShaper();
    const bodyEq = context.createBiquadFilter();
    const topEq = context.createBiquadFilter();

    noiseHp.type = "highpass";
    noiseHp.frequency.setValueAtTime(700 + snap * 220, when);
    noiseBp.type = "bandpass";
    noiseBp.frequency.setValueAtTime(1500 + snap * 280, when);
    noiseBp.Q.setValueAtTime(0.5, when);
    noiseAmp.gain.setValueAtTime(MIN_GAIN, when);
    noiseAmp.gain.linearRampToValueAtTime(level * 0.88, when + 0.001);
    noiseAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, when + decay);

    snapHp.type = "highpass";
    snapHp.frequency.setValueAtTime(2400 + snap * 650, when);
    snapAmp.gain.setValueAtTime(MIN_GAIN, when);
    snapAmp.gain.linearRampToValueAtTime(level * 0.1, when + 0.0012);
    snapAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, when + Math.min(0.032, decay * 0.28));

    toneA.type = "triangle";
    toneB.type = "sine";
    toneA.frequency.setValueAtTime(198 + snap * 18, when);
    toneB.frequency.setValueAtTime(292 + snap * 20, when);
    toneA.frequency.exponentialRampToValueAtTime(168, when + decay * 0.88);
    toneB.frequency.exponentialRampToValueAtTime(244, when + decay * 0.74);
    toneAmp.gain.setValueAtTime(MIN_GAIN, when);
    toneAmp.gain.linearRampToValueAtTime(level * 0.42, when + 0.0012);
    toneAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, when + decay * 0.85);

    drive.curve = createDriveCurve(Math.max(0.12, Math.min(0.42, snap * 0.72))) as unknown as Float32Array<ArrayBuffer>;
    drive.oversample = "2x";

    bodyEq.type = "peaking";
    bodyEq.frequency.setValueAtTime(185, when);
    bodyEq.Q.setValueAtTime(1.05, when);
    bodyEq.gain.setValueAtTime(2.4, when);

    topEq.type = "highshelf";
    topEq.frequency.setValueAtTime(4600, when);
    topEq.gain.setValueAtTime(0.12, when);

    noise.connect(noiseHp);
    noiseHp.connect(noiseBp);
    noiseBp.connect(noiseAmp);
    noiseAmp.connect(mix);

    snapNoise.connect(snapHp);
    snapHp.connect(snapAmp);
    snapAmp.connect(mix);

    toneA.connect(toneAmp);
    toneB.connect(toneAmp);
    toneAmp.connect(mix);

    mix.connect(drive);
    drive.connect(bodyEq);
    bodyEq.connect(topEq);
    topEq.connect(output);

    noise.start(when);
    noise.stop(when + decay + 0.03);
    snapNoise.start(when);
    snapNoise.stop(when + Math.min(0.03, decay * 0.26) + 0.008);
    toneA.start(when);
    toneB.start(when);
    toneA.stop(when + decay + 0.03);
    toneB.stop(when + decay + 0.03);
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

    const decay = Math.max(0.04, 0.032 + track.instrument.decay * 0.22);
    const level = Math.max(MIN_GAIN, velocity * track.instrument.gain * 0.9);
    const brightness = Math.max(0, Math.min(1, track.instrument.cutoff / 10000));
    const metal = Math.max(0, Math.min(1, track.instrument.drive * 0.9 + 0.2));

    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseHp = context.createBiquadFilter();
    const noiseBp = context.createBiquadFilter();
    const noiseAmp = context.createGain();

    const metallicMix = context.createGain();
    const metallicRatios = [1, 1.341, 1.666, 1.93, 2.47, 2.92];
    const metallicOscs: OscillatorNode[] = [];
    const metallicGains: GainNode[] = [];
    const metallicBase = 2200 + brightness * 800;

    for (const ratio of metallicRatios) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(metallicBase * ratio, when);
      gain.gain.setValueAtTime(0.05 + metal * 0.014, when);
      osc.connect(gain);
      gain.connect(metallicMix);
      metallicOscs.push(osc);
      metallicGains.push(gain);
    }

    const metallicHp = context.createBiquadFilter();
    const metallicBp = context.createBiquadFilter();
    const metallicAmp = context.createGain();
    const mix = context.createGain();
    const drive = context.createWaveShaper();
    const air = context.createBiquadFilter();

    noiseHp.type = "highpass";
    noiseHp.frequency.setValueAtTime(4100 + brightness * 1100, when);
    noiseBp.type = "bandpass";
    noiseBp.frequency.setValueAtTime(6200 + brightness * 1000, when);
    noiseBp.Q.setValueAtTime(0.45, when);
    noiseAmp.gain.setValueAtTime(MIN_GAIN, when);
    noiseAmp.gain.linearRampToValueAtTime(level * 0.96, when + 0.0008);
    noiseAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, when + decay);

    metallicHp.type = "highpass";
    metallicHp.frequency.setValueAtTime(4300 + brightness * 700, when);
    metallicBp.type = "bandpass";
    metallicBp.frequency.setValueAtTime(7600 + brightness * 900, when);
    metallicBp.Q.setValueAtTime(0.62, when);
    metallicAmp.gain.setValueAtTime(MIN_GAIN, when);
    metallicAmp.gain.linearRampToValueAtTime(level * 0.5, when + 0.0008);
    metallicAmp.gain.exponentialRampToValueAtTime(MIN_GAIN, when + decay * 0.92);

    drive.curve = createDriveCurve(Math.max(0.1, Math.min(0.3, metal * 0.5))) as unknown as Float32Array<ArrayBuffer>;
    drive.oversample = "2x";

    air.type = "highshelf";
    air.frequency.setValueAtTime(7800, when);
    air.gain.setValueAtTime(0.85 + brightness * 0.95, when);

    noise.connect(noiseHp);
    noiseHp.connect(noiseBp);
    noiseBp.connect(noiseAmp);
    noiseAmp.connect(mix);

    metallicMix.connect(metallicHp);
    metallicHp.connect(metallicBp);
    metallicBp.connect(metallicAmp);
    metallicAmp.connect(mix);

    mix.connect(drive);
    drive.connect(air);
    air.connect(output);

    noise.start(when);
    noise.stop(when + decay + 0.014);
    for (const osc of metallicOscs) {
      osc.start(when);
      osc.stop(when + decay + 0.016);
    }
    for (const gain of metallicGains) {
      gain.gain.exponentialRampToValueAtTime(MIN_GAIN, when + decay * 0.92);
    }
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
