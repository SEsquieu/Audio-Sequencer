import { SongState } from "../types/song";
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

  async ensureContext() {
    if (!this.context) {
      this.context = new AudioContext();
      this.noiseBuffer = createNoiseBuffer(this.context);
      this.mixer.init(this.context, this.masterVolume);
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
    await this.ensureContext();
    if (!this.context || this.isPlaying) {
      return;
    }

    this.getSong = getSong;
    this.isPlaying = true;
    const loopStart = this.transport.getLoopRange().start ?? 0;
    if (resetPosition) {
      this.transport.setPosition(loopStart, 0);
      this.tickListener?.(this.transport.getPosition());
    } else if (this.transport.clampPositionToLoop()) {
      this.tickListener?.(this.transport.getPosition());
    }

    this.transport.setNextStepTime(this.context.currentTime + 0.02);
    this.recomputeSchedulingWindow(this.context.baseLatency || 0, 0);
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
  }

  stop() {
    this.pause();
    if (!this.context) {
      return;
    }
    this.instrumentEngine.stopAllVoices();
    this.transport.setPosition(this.transport.getLoopRange().start ?? 0, 0);
    this.transport.setNextStepTime(this.context.currentTime + 0.02);
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

  private scheduler() {
    if (!this.context || !this.getSong) {
      return;
    }

    const windowSong = this.liveEditPolicy === "schedulerWindow" ? this.getSong() : null;
    while (this.transport.getNextStepTime() < this.context.currentTime + this.scheduleAheadTime) {
      const song = windowSong ?? this.getSong();
      this.mixer.pruneTrackBuses(song);
      const position = this.transport.getPosition();
      const stepTime = this.transport.getNextStepTime();
      this.captureStepIntervalDiagnostics(song, stepTime);
      scheduleSongStep(
        song,
        { bar: position.bar, step: position.step, when: stepTime },
        this.mutedTrackIds,
        this.instrumentEngine
      );
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
    if (this.context) {
      const nowMs = performance.now();
      const lateMs = this.schedulerExpectedWakeMs > 0 ? Math.max(0, nowMs - this.schedulerExpectedWakeMs) : 0;
      this.lastWakeLateMs = lateMs;
      this.schedulerWakeLateMaxMs = Math.max(this.schedulerWakeLateMaxMs, lateMs);
      this.recomputeSchedulingWindow(this.context.baseLatency || 0, lateMs);
      this.schedulerExpectedWakeMs = nowMs + this.lookaheadMs;
      this.diagnosticsUpdatedAtMs = nowMs;
    }
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
