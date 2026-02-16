import { SongState, SynthStep, Track } from "../types/song";

const midiToFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

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

  async ensureContext() {
    if (!this.context) {
      this.context = new AudioContext();
      this.noiseBuffer = this.createNoiseBuffer(this.context);
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  onTick(listener: (info: TickInfo) => void) {
    this.tickListener = listener;
  }

  async start(getSong: () => SongState) {
    await this.ensureContext();
    if (!this.context || this.isPlaying) {
      return;
    }

    this.getSong = getSong;
    this.isPlaying = true;
    this.nextStepTime = this.context.currentTime + 0.02;
    this.currentBar = 0;
    this.currentStep = 0;
    this.scheduleAheadTime = Math.max(0.12, (this.context.baseLatency || 0) + 0.1);

    this.schedulerLoop();
  }

  stop() {
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.isPlaying = false;
    this.currentStep = 0;
    this.currentBar = 0;
    this.tickListener?.({ bar: 0, step: 0 });
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
    const loopBars = getEffectiveLoopBars(song);
    if (this.currentStep >= 16) {
      this.currentStep = 0;
      this.currentBar = (this.currentBar + 1) % loopBars;
    }
  }

  private scheduleStep(song: SongState, bar: number, step: number, when: number) {
    for (const track of song.tracks) {
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

    const { attack, decay, sustain, release, cutoff, resonance, gain, lofiAmount } = track.instrument;
    const stepDuration = 60 / tempo / 4;
    const noteDuration = Math.max(0.04, stepDuration * lengthSteps);

    const osc = this.context.createOscillator();
    osc.type = lofiAmount > 0.5 ? "square" : "sawtooth";
    osc.frequency.setValueAtTime(midiToFreq(pitch), when);

    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.max(120, cutoff * (1 - lofiAmount * 0.3)), when);
    filter.Q.setValueAtTime(Math.max(0.001, resonance), when);

    const amp = this.context.createGain();
    const peak = gain * velocity;

    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(peak, when + attack);
    amp.gain.linearRampToValueAtTime(peak * sustain, when + attack + decay);
    amp.gain.setValueAtTime(peak * sustain, when + noteDuration);
    amp.gain.linearRampToValueAtTime(0.0001, when + noteDuration + release);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(this.context.destination);

    osc.start(when);
    osc.stop(when + noteDuration + release + 0.02);
  }

  private playKick(track: Track, when: number, velocity: number) {
    if (!this.context) {
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
    amp.connect(this.context.destination);

    osc.start(when);
    osc.stop(when + decay + 0.02);
  }

  private playSnare(track: Track, when: number, velocity: number) {
    if (!this.context || !this.noiseBuffer) {
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
    noiseAmp.connect(this.context.destination);

    tone.connect(toneAmp);
    toneAmp.connect(this.context.destination);

    noise.start(when);
    noise.stop(when + decay + 0.02);
    tone.start(when);
    tone.stop(when + decay + 0.02);
  }

  private playHat(track: Track, when: number, velocity: number) {
    if (!this.context || !this.noiseBuffer) {
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
    amp.connect(this.context.destination);

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
