import { SongState, Track } from "../types/song";
import { createNoiseBuffer, InstrumentEngine } from "./instrumentEngine";
import { MixerGraph } from "./mixerGraph";
import { scheduleSongStep } from "./scheduler";
import { StepTransport } from "./transport";

interface TickInfo {
  bar: number;
  step: number;
}

export interface EngineTimingDiagnostics {
  schedulerWakeLateMs: number;
  schedulerWakeLateMaxMs: number;
  scheduleAheadTimeMs: number;
  lookaheadMs: number;
  scheduledSteps: number;
  observedStepIntervalMs: number;
  observedStepIntervalErrorMs: number;
  observedStepIntervalErrorMaxMs: number;
  liveEditPolicy: LiveEditPolicy;
  synthVoiceSteals: number;
  synthVoiceStealsByTrack: Record<string, number>;
  lastUpdatedAtMs: number;
}

export type LiveEditPolicy = "nextStep" | "schedulerWindow";

export { getEffectiveLoopBars } from "./songModel";

export class AudioEngine {
  private context: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private masterVolume = 0.8;
  private isPlaying = false;
  private lookaheadMs = 25;
  private scheduleAheadTime = 0.15;
  private schedulerExpectedWakeMs = 0;
  private timerId: number | null = null;
  private getSong: (() => SongState) | null = null;
  private latestSongState: SongState | null = null;
  private tickListener: ((info: TickInfo) => void) | null = null;
  private mutedTrackIds = new Set<string>();
  private schedulerWakeLateMaxMs = 0;
  private scheduledSteps = 0;
  private lastScheduledStepTime = 0;
  private observedStepIntervalMs = 0;
  private observedStepIntervalErrorMs = 0;
  private observedStepIntervalErrorMaxMs = 0;
  private lastWakeLateMs = 0;
  private diagnosticsUpdatedAtMs = 0;
  private liveEditPolicy: LiveEditPolicy = "nextStep";
  private useContextClock = false;
  private readonly transport = new StepTransport();
  private readonly mixer = new MixerGraph();
  private readonly instrumentEngine = new InstrumentEngine(
    () => this.context,
    () => this.noiseBuffer,
    (trackId) => {
      if (!this.context) {
        return null;
      }
      return this.mixer.getTrackInputNode(this.context, trackId);
    }
  );

  private async resumeContextWithTimeout(context: AudioContext, timeoutMs = 350): Promise<boolean> {
    const resumePromise = context
      .resume()
      .then(() => true)
      .catch(() => false);
    const timeoutPromise = new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(false), timeoutMs);
    });
    return Promise.race([resumePromise, timeoutPromise]);
  }

  async ensureContext(): Promise<boolean> {
    if (!this.context) {
      try {
        this.context = new AudioContext();
        this.noiseBuffer = createNoiseBuffer(this.context);
        this.mixer.init(this.context, this.masterVolume);
        if (this.latestSongState) {
          this.mixer.pruneTrackBuses(this.latestSongState);
        }
      } catch (error) {
        console.warn("[audio] Unable to create AudioContext. Running in silent mode.", error);
        this.context = null;
        this.noiseBuffer = null;
        return false;
      }
    }
    if (this.context.state === "suspended") {
      const resumed = await this.resumeContextWithTimeout(this.context);
      if (!resumed) {
        console.warn("[audio] Unable to resume AudioContext promptly. Running in silent mode.");
        return false;
      }
    }
    if (this.context.state !== "running") {
      return false;
    }
    return true;
  }

  onTick(listener: (info: TickInfo) => void) {
    this.tickListener = listener;
  }

  setMutedTrackIds(trackIds: string[]) {
    this.mutedTrackIds = new Set(trackIds);
  }

  syncSongState(song: SongState) {
    this.latestSongState = song;
    if (!this.context) {
      return;
    }
    this.mixer.pruneTrackBuses(song);
  }

  getTimingDiagnostics(): EngineTimingDiagnostics {
    const voiceDiagnostics = this.instrumentEngine.getDiagnostics();
    return {
      schedulerWakeLateMs: this.lastWakeLateMs,
      schedulerWakeLateMaxMs: this.schedulerWakeLateMaxMs,
      scheduleAheadTimeMs: this.scheduleAheadTime * 1000,
      lookaheadMs: this.lookaheadMs,
      scheduledSteps: this.scheduledSteps,
      observedStepIntervalMs: this.observedStepIntervalMs,
      observedStepIntervalErrorMs: this.observedStepIntervalErrorMs,
      observedStepIntervalErrorMaxMs: this.observedStepIntervalErrorMaxMs,
      liveEditPolicy: this.liveEditPolicy,
      synthVoiceSteals: voiceDiagnostics.synthVoiceSteals,
      synthVoiceStealsByTrack: voiceDiagnostics.synthVoiceStealsByTrack,
      lastUpdatedAtMs: this.diagnosticsUpdatedAtMs,
    };
  }

  setLiveEditPolicy(policy: LiveEditPolicy) {
    this.liveEditPolicy = policy;
  }

  setLoopRange(startBar: number | null, endBar: number | null = null) {
    this.transport.setLoopRange(startBar, endBar);
    const { start, end } = this.transport.getLoopRange();
    if (start === null || end === null) {
      return;
    }
    const position = this.transport.getPosition();
    if (position.bar < start || position.bar > end) {
      this.transport.setPosition(start, 0);
      const next = this.transport.getPosition();
      this.tickListener?.(next);
    }
  }

  async start(getSong: () => SongState) {
    await this.play(getSong, true);
  }

  async play(getSong: () => SongState, resetPosition = false) {
    const hasAudioContext = await this.ensureContext();
    this.useContextClock = hasAudioContext && this.context !== null;
    if (this.isPlaying) {
      return;
    }

    this.getSong = getSong;
    this.syncSongState(getSong());
    this.isPlaying = true;
    const loopStart = this.transport.getLoopRange().start ?? 0;
    if (resetPosition) {
      this.transport.setPosition(loopStart, 0);
      this.tickListener?.(this.transport.getPosition());
    } else if (this.transport.clampPositionToLoop()) {
      this.tickListener?.(this.transport.getPosition());
    }

    const startTime = this.useContextClock && this.context ? this.context.currentTime : performance.now() / 1000;
    this.transport.setNextStepTime(startTime + 0.02);
    this.recomputeSchedulingWindow(this.useContextClock ? (this.context?.baseLatency || 0) : 0, 0);
    this.schedulerExpectedWakeMs = performance.now() + this.lookaheadMs;
    this.resetTimingDiagnostics();
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
    this.schedulerExpectedWakeMs = 0;
    this.lastWakeLateMs = 0;
    this.isPlaying = false;
    this.useContextClock = false;
  }

  stop() {
    this.pause();
    this.instrumentEngine.stopAllVoices();
    this.transport.setPosition(this.transport.getLoopRange().start ?? 0, 0);
    const clockTime = this.useContextClock && this.context ? this.context.currentTime : performance.now() / 1000;
    this.transport.setNextStepTime(clockTime + 0.02);
    this.tickListener?.(this.transport.getPosition());
  }

  setMasterVolume(value: number) {
    const clamped = Math.max(0, Math.min(1, value));
    this.masterVolume = clamped;
    this.mixer.setMasterVolume(this.context, clamped);
  }

  get playing() {
    return this.isPlaying;
  }

  async previewSynthNote(
    track: Track,
    pitch: number,
    velocity = 0.9,
    lengthSteps = 1,
    tempo = 120
  ) {
    const hasAudioContext = await this.ensureContext();
    if (!hasAudioContext) {
      return;
    }
    if (!this.context) {
      return;
    }
    if (this.context.state !== "running") {
      try {
        await this.context.resume();
      } catch {
        return;
      }
    }
    if (this.latestSongState) {
      this.mixer.pruneTrackBuses(this.latestSongState);
    }
    const when = this.context.currentTime + 0.005;
    try {
      this.instrumentEngine.playSynthNote(track, pitch, velocity, lengthSteps, when, tempo);
    } catch {
      // Last-resort preview path for "always make sound" if synth rendering fails.
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440 * 2 ** ((pitch - 69) / 12), when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(0.12, when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
      osc.connect(gain);
      gain.connect(this.mixer.getOutputNode(this.context));
      osc.start(when);
      osc.stop(when + 0.22);
    }
  }

  async previewDrumHit(track: Track, lane: "kick" | "snare" | "hat", velocity = 1) {
    if (track.type !== "drums") {
      return;
    }
    const hasAudioContext = await this.ensureContext();
    if (!hasAudioContext) {
      return;
    }
    if (!this.context) {
      return;
    }
    if (this.context.state !== "running") {
      try {
        await this.context.resume();
      } catch {
        return;
      }
    }
    if (this.latestSongState) {
      this.mixer.pruneTrackBuses(this.latestSongState);
    }

    const when = this.context.currentTime + 0.005;
    if (lane === "kick") {
      this.instrumentEngine.playKick(track, when, velocity);
      return;
    }
    if (lane === "snare") {
      this.instrumentEngine.playSnare(track, when, velocity);
      return;
    }
    this.instrumentEngine.playHat(track, when, velocity);
  }

  private scheduler() {
    if (!this.getSong) {
      return;
    }
    const currentTime = this.useContextClock && this.context ? this.context.currentTime : performance.now() / 1000;

    const windowSong = this.liveEditPolicy === "schedulerWindow" ? this.getSong() : null;
    while (this.transport.getNextStepTime() < currentTime + this.scheduleAheadTime) {
      const song = windowSong ?? this.getSong();
      if (this.useContextClock && this.context) {
        this.mixer.pruneTrackBuses(song);
      }
      const position = this.transport.getPosition();
      const stepTime = this.transport.getNextStepTime();
      this.captureStepIntervalDiagnostics(song, stepTime);
      if (this.useContextClock && this.context) {
        scheduleSongStep(
          song,
          { bar: position.bar, step: position.step, when: stepTime },
          this.mutedTrackIds,
          this.instrumentEngine
        );
      }
      this.tickListener?.(position);
      this.scheduledSteps += 1;
      this.diagnosticsUpdatedAtMs = performance.now();
      this.transport.advance(song);
    }
  }

  private schedulerLoop = () => {
    if (!this.isPlaying) {
      return;
    }
    const nowMs = performance.now();
    const lateMs = this.schedulerExpectedWakeMs > 0 ? Math.max(0, nowMs - this.schedulerExpectedWakeMs) : 0;
    this.lastWakeLateMs = lateMs;
    this.schedulerWakeLateMaxMs = Math.max(this.schedulerWakeLateMaxMs, lateMs);
    this.recomputeSchedulingWindow(this.useContextClock ? (this.context?.baseLatency || 0) : 0, lateMs);
    this.schedulerExpectedWakeMs = nowMs + this.lookaheadMs;
    this.diagnosticsUpdatedAtMs = nowMs;
    this.scheduler();
    this.timerId = window.setTimeout(this.schedulerLoop, this.lookaheadMs);
  };

  private recomputeSchedulingWindow(baseLatency: number, lateMs: number) {
    const baseAhead = Math.max(0.12, Math.min(0.32, baseLatency * 2 + 0.08));
    const jitterCompensation = Math.min(0.05, lateMs / 1000);
    this.scheduleAheadTime = Math.max(0.12, Math.min(0.35, baseAhead + jitterCompensation));
    const computedLookahead = (this.scheduleAheadTime * 1000) / 3;
    this.lookaheadMs = Math.max(12, Math.min(45, Math.round(computedLookahead)));
  }

  private resetTimingDiagnostics() {
    this.schedulerWakeLateMaxMs = 0;
    this.scheduledSteps = 0;
    this.lastScheduledStepTime = 0;
    this.observedStepIntervalMs = 0;
    this.observedStepIntervalErrorMs = 0;
    this.observedStepIntervalErrorMaxMs = 0;
    this.lastWakeLateMs = 0;
    this.instrumentEngine.resetDiagnostics();
    this.diagnosticsUpdatedAtMs = performance.now();
  }

  private captureStepIntervalDiagnostics(song: SongState, stepTime: number) {
    if (this.lastScheduledStepTime <= 0) {
      this.lastScheduledStepTime = stepTime;
      return;
    }

    const observedInterval = (stepTime - this.lastScheduledStepTime) * 1000;
    const sixteenthMs = (60 / song.tempo / 4) * 1000;
    const clampedSwing = Math.max(0, Math.min(0.95, song.swing));
    const swingSkew = clampedSwing * 0.5;
    const expectedInterval = (this.transport.getPosition().step % 2 === 0 ? 1 - swingSkew : 1 + swingSkew) * sixteenthMs;
    const intervalError = observedInterval - expectedInterval;

    this.observedStepIntervalMs = observedInterval;
    this.observedStepIntervalErrorMs = intervalError;
    this.observedStepIntervalErrorMaxMs = Math.max(
      this.observedStepIntervalErrorMaxMs,
      Math.abs(intervalError)
    );
    this.lastScheduledStepTime = stepTime;
  }
}
