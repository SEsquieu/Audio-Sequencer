import { SongState, SynthStep, Track } from "../types/song";

const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
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

interface TickInfo {
  bar: number;
  step: number;
}

const normalizeSynthCell = (cell: unknown): SynthStep[] => {
  if (!cell) {
    return [];
  }
  if (Array.isArray(cell)) {
    return cell.filter(
      (n): n is SynthStep =>
        typeof n === "object" &&
        n !== null &&
        typeof (n as SynthStep).pitch === "number" &&
        typeof (n as SynthStep).length === "number" &&
        typeof (n as SynthStep).velocity === "number"
    );
  }
  if (
    typeof cell === "object" &&
    typeof (cell as SynthStep).pitch === "number" &&
    typeof (cell as SynthStep).length === "number" &&
    typeof (cell as SynthStep).velocity === "number"
  ) {
    return [cell as SynthStep];
  }
  return [];
};

const patternHasContent = (pattern: SongState["tracks"][number]["patterns"][string]): boolean => {
  if (pattern.type === "synth") {
    return pattern.steps.some((cell) => normalizeSynthCell(cell).length > 0);
  }
  return pattern.steps.some((step) => step.kick > 0 || step.snare > 0 || step.hat > 0);
};

export const getEffectiveLoopBars = (song: SongState): number => {
  let lastActiveBar = -1;

  for (let bar = 0; bar < song.bars; bar += 1) {
    for (const track of song.tracks) {
      const patternId = track.lane[bar] ?? track.lane[0];
      const pattern = track.patterns[patternId];
      if (pattern && patternHasContent(pattern)) {
        lastActiveBar = Math.max(lastActiveBar, bar);
      }
    }
  }

  if (lastActiveBar >= 0) {
    return Math.max(1, lastActiveBar + 1);
  }
  return Math.max(1, song.bars);
};

export class AudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterVolume = 0.8;
  private isPlaying = false;
  private lookaheadMs = 25;
  private scheduleAheadTime = 0.15;
  private nextStepTime = 0;
  private currentBar = 0;
  private currentStep = 0;
  private timerId: number | null = null;
  private getSong: (() => SongState) | null = null;
  private tickListener: ((info: TickInfo) => void) | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private loopStartBar: number | null = null;
  private loopEndBar: number | null = null;
  private mutedTrackIds = new Set<string>();

  async ensureContext() {
    if (!this.context) {
      this.context = new AudioContext();
      this.noiseBuffer = this.createNoiseBuffer(this.context);
      this.masterGain = this.context.createGain();
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.context.currentTime);
      this.masterGain.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  onTick(listener: (info: TickInfo) => void) {
    this.tickListener = listener;
  }

  setMutedTrackIds(trackIds: string[]) {
    this.mutedTrackIds = new Set(trackIds);
  }

  setLoopRange(startBar: number | null, endBar: number | null = null) {
    if (startBar === null || endBar === null) {
      this.loopStartBar = null;
      this.loopEndBar = null;
      return;
    }
    const start = Math.max(0, Math.min(startBar, endBar));
    const end = Math.max(startBar, endBar);
    this.loopStartBar = start;
    this.loopEndBar = end;

    if (this.currentBar < start || this.currentBar > end) {
      this.currentBar = start;
      this.currentStep = 0;
      this.tickListener?.({ bar: this.currentBar, step: this.currentStep });
    }
  }

  async start(getSong: () => SongState) {
    await this.play(getSong, true);
  }

  async play(getSong: () => SongState, resetPosition = false) {
    await this.ensureContext();
    if (!this.context || this.isPlaying) {
      return;
    }

    this.getSong = getSong;
    this.isPlaying = true;
    const loopStart = this.loopStartBar ?? 0;
    if (resetPosition) {
      this.currentBar = loopStart;
      this.currentStep = 0;
      this.tickListener?.({ bar: this.currentBar, step: this.currentStep });
    } else if (this.loopStartBar !== null && this.loopEndBar !== null) {
      if (this.currentBar < this.loopStartBar || this.currentBar > this.loopEndBar) {
        this.currentBar = this.loopStartBar;
        this.currentStep = 0;
        this.tickListener?.({ bar: this.currentBar, step: this.currentStep });
      }
    }
    this.nextStepTime = this.context.currentTime + 0.02;
    this.scheduleAheadTime = Math.max(0.12, (this.context.baseLatency || 0) + 0.1);

    this.schedulerLoop();
  }

  pause() {
    if (!this.isPlaying) {
      return;
    }
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.isPlaying = false;
  }

  stop() {
    this.pause();
    if (!this.context) {
      return;
    }
    this.currentBar = this.loopStartBar ?? 0;
    this.currentStep = 0;
    this.nextStepTime = this.context.currentTime + 0.02;
    this.tickListener?.({ bar: this.currentBar, step: this.currentStep });
  }

  setMasterVolume(value: number) {
    const clamped = Math.max(0, Math.min(1, value));
    this.masterVolume = clamped;
    if (!this.context || !this.masterGain) {
      return;
    }
    const when = this.context.currentTime;
    this.masterGain.gain.cancelScheduledValues(when);
    this.masterGain.gain.setTargetAtTime(clamped, when, 0.01);
  }

  private getOutputNode(): AudioNode | null {
    if (!this.context) {
      return null;
    }
    return this.masterGain ?? this.context.destination;
  }

  get playing() {
    return this.isPlaying;
  }

  private scheduler() {
    if (!this.context || !this.getSong) {
      return;
    }

    while (this.nextStepTime < this.context.currentTime + this.scheduleAheadTime) {
      const song = this.getSong();
      this.scheduleStep(song, this.currentBar, this.currentStep, this.nextStepTime);
      this.tickListener?.({ bar: this.currentBar, step: this.currentStep });
      this.advanceStep(song);
    }
  }

  private schedulerLoop = () => {
    if (!this.isPlaying) {
      return;
    }
    this.scheduler();
    this.timerId = window.setTimeout(this.schedulerLoop, this.lookaheadMs);
  };

  private advanceStep(song: SongState) {
    const sixteenth = 60 / song.tempo / 4;
    const clampedSwing = Math.max(0, Math.min(0.95, song.swing));
    const swingSkew = clampedSwing * 0.5;
    const stepFactor = this.currentStep % 2 === 0 ? 1 - swingSkew : 1 + swingSkew;
    this.nextStepTime += sixteenth * stepFactor;

    this.currentStep += 1;
    const { start, length } = this.getLoopBounds(song);
    if (this.currentStep >= 16) {
      this.currentStep = 0;
      this.currentBar += 1;
      if (this.currentBar >= start + length) {
        this.currentBar = start;
      }
    }
  }

  private getLoopBounds(song: SongState): { start: number; length: number } {
    if (this.loopStartBar !== null && this.loopEndBar !== null) {
      const maxBar = Math.max(0, song.bars - 1);
      const start = Math.max(0, Math.min(this.loopStartBar, maxBar));
      const end = Math.max(start, Math.min(this.loopEndBar, maxBar));
      return { start, length: Math.max(1, end - start + 1) };
    }
    return { start: 0, length: getEffectiveLoopBars(song) };
  }

  private scheduleStep(song: SongState, bar: number, step: number, when: number) {
    for (const track of song.tracks) {
      if (this.mutedTrackIds.has(track.id)) {
        continue;
      }
      const patternId = track.lane[bar] ?? track.lane[0];
      const pattern = track.patterns[patternId];
      if (!pattern) {
        continue;
      }

      if (track.type === "synth" && pattern.type === "synth") {
        const notes = normalizeSynthCell(pattern.steps[step]);
        for (const note of notes) {
          this.playSynthNote(track, note.pitch, note.velocity, note.length, when, song.tempo);
        }
      }

      if (track.type === "drums" && pattern.type === "drums") {
        const hit = pattern.steps[step];
        if (hit.kick > 0) {
          this.playKick(track, when, hit.kick);
        }
        if (hit.snare > 0) {
          this.playSnare(track, when, hit.snare);
        }
        if (hit.hat > 0) {
          this.playHat(track, when, hit.hat);
        }
      }
    }
  }

  private playSynthNote(
    track: Track,
    pitch: number,
    velocity: number,
    lengthSteps: number,
    when: number,
    tempo: number
  ) {
    if (!this.context) {
      return;
    }
    const output = this.getOutputNode();
    if (!output) {
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

    const oscA = this.context.createOscillator();
    const oscB = this.context.createOscillator();
    oscA.type = oscWaveformA;
    oscB.type = oscWaveformB;
    const baseFreq = midiToFreq(pitch);
    oscA.frequency.setValueAtTime(baseFreq, when);
    oscB.frequency.setValueAtTime(baseFreq, when);
    const detuneCents = Math.max(0, detune);
    oscA.detune.setValueAtTime(-detuneCents * 0.5, when);
    oscB.detune.setValueAtTime(detuneCents * 0.5, when);

    const mix = this.context.createGain();
    const aGain = this.context.createGain();
    const bGain = this.context.createGain();
    const mixAmount = Math.max(0, Math.min(1, oscMix));
    const oscFadeIn = 0.0015;
    const oscFadeOut = 0.003;
    aGain.gain.setValueAtTime(0, when);
    bGain.gain.setValueAtTime(0, when);
    aGain.gain.linearRampToValueAtTime(1 - mixAmount, when + oscFadeIn);
    bGain.gain.linearRampToValueAtTime(mixAmount, when + oscFadeIn);

    let lfo: OscillatorNode | null = null;
    let lfoDepth: GainNode | null = null;
    if (vibratoDepth > 0.001 && vibratoRate > 0.001) {
      lfo = this.context.createOscillator();
      lfoDepth = this.context.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(vibratoRate, when);
      lfoDepth.gain.setValueAtTime(vibratoDepth, when);
      lfo.connect(lfoDepth);
      lfoDepth.connect(oscA.detune);
      lfoDepth.connect(oscB.detune);
    }

    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.max(120, cutoff * (1 - lofiAmount * 0.3)), when);
    filter.Q.setValueAtTime(Math.max(0.001, resonance), when);

    const shaper = this.context.createWaveShaper();
    shaper.curve = createDriveCurve(Math.max(0, Math.min(1, drive))) as unknown as Float32Array<ArrayBuffer>;
    shaper.oversample = "2x";

    const amp = this.context.createGain();
    const peak = gain * velocity;

    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(peak, when + safeAttack);
    amp.gain.linearRampToValueAtTime(peak * sustain, when + safeAttack + decay);
    amp.gain.setValueAtTime(peak * sustain, when + noteDuration);
    amp.gain.linearRampToValueAtTime(0.0001, when + noteDuration + safeRelease);

    oscA.connect(aGain);
    oscB.connect(bGain);
    aGain.connect(mix);
    bGain.connect(mix);
    mix.connect(shaper);
    shaper.connect(filter);
    filter.connect(amp);
    amp.connect(output);

    oscA.start(when);
    oscB.start(when);
    lfo?.start(when);
    const stopAt = when + noteDuration + safeRelease + 0.02;
    const fadeOutAt = Math.max(when + oscFadeIn, stopAt - oscFadeOut);
    aGain.gain.setValueAtTime(1 - mixAmount, fadeOutAt);
    bGain.gain.setValueAtTime(mixAmount, fadeOutAt);
    aGain.gain.linearRampToValueAtTime(0.0001, stopAt);
    bGain.gain.linearRampToValueAtTime(0.0001, stopAt);
    oscA.stop(stopAt);
    oscB.stop(stopAt);
    lfo?.stop(stopAt);
  }

  private playKick(track: Track, when: number, velocity: number) {
    if (!this.context) {
      return;
    }
    const output = this.getOutputNode();
    if (!output) {
      return;
    }

    const osc = this.context.createOscillator();
    const amp = this.context.createGain();
    const decay = Math.max(0.03, track.instrument.decay + 0.03);
    const level = velocity * track.instrument.gain;

    osc.type = "sine";
    osc.frequency.setValueAtTime(160, when);
    osc.frequency.exponentialRampToValueAtTime(50, when + decay);

    amp.gain.setValueAtTime(level, when);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    osc.connect(amp);
    amp.connect(output);

    osc.start(when);
    osc.stop(when + decay + 0.02);
  }

  private playSnare(track: Track, when: number, velocity: number) {
    if (!this.context || !this.noiseBuffer) {
      return;
    }
    const output = this.getOutputNode();
    if (!output) {
      return;
    }

    const decay = Math.max(0.05, track.instrument.decay + 0.05);
    const gain = velocity * track.instrument.gain;

    const noise = this.context.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const noiseFilter = this.context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1800, when);

    const noiseAmp = this.context.createGain();
    noiseAmp.gain.setValueAtTime(gain * 0.6, when);
    noiseAmp.gain.exponentialRampToValueAtTime(0.0001, when + decay);

    const tone = this.context.createOscillator();
    tone.type = "triangle";
    tone.frequency.setValueAtTime(190, when);

    const toneAmp = this.context.createGain();
    toneAmp.gain.setValueAtTime(gain * 0.25, when);
    toneAmp.gain.exponentialRampToValueAtTime(0.0001, when + decay * 0.8);

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

  private playHat(track: Track, when: number, velocity: number) {
    if (!this.context || !this.noiseBuffer) {
      return;
    }
    const output = this.getOutputNode();
    if (!output) {
      return;
    }

    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;

    const hp = this.context.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(5200, when);

    const amp = this.context.createGain();
    amp.gain.setValueAtTime(velocity * track.instrument.gain * 0.35, when);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);

    source.connect(hp);
    hp.connect(amp);
    amp.connect(output);

    source.start(when);
    source.stop(when + 0.05);
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
