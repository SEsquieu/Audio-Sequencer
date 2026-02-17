import { SongState } from "../types/song";
import { getEffectiveLoopBars } from "./songModel";

export interface LoopBounds {
  start: number;
  length: number;
}

export class StepTransport {
  private currentBar = 0;
  private currentStep = 0;
  private nextStepTime = 0;
  private loopStartBar: number | null = null;
  private loopEndBar: number | null = null;

  setLoopRange(startBar: number | null, endBar: number | null): void {
    if (startBar === null || endBar === null) {
      this.loopStartBar = null;
      this.loopEndBar = null;
      return;
    }
    const start = Math.max(0, Math.min(startBar, endBar));
    const end = Math.max(startBar, endBar);
    this.loopStartBar = start;
    this.loopEndBar = end;
  }

  getLoopRange(): { start: number | null; end: number | null } {
    return { start: this.loopStartBar, end: this.loopEndBar };
  }

  setPosition(bar: number, step: number): void {
    this.currentBar = Math.max(0, bar);
    this.currentStep = Math.max(0, Math.min(15, step));
  }

  getPosition(): { bar: number; step: number } {
    return { bar: this.currentBar, step: this.currentStep };
  }

  setNextStepTime(time: number): void {
    this.nextStepTime = time;
  }

  getNextStepTime(): number {
    return this.nextStepTime;
  }

  getLoopBounds(song: SongState): LoopBounds {
    if (this.loopStartBar !== null && this.loopEndBar !== null) {
      const maxBar = Math.max(0, song.bars - 1);
      const start = Math.max(0, Math.min(this.loopStartBar, maxBar));
      const end = Math.max(start, Math.min(this.loopEndBar, maxBar));
      return { start, length: Math.max(1, end - start + 1) };
    }
    return { start: 0, length: getEffectiveLoopBars(song) };
  }

  clampPositionToLoop(): boolean {
    if (this.loopStartBar === null || this.loopEndBar === null) {
      return false;
    }
    if (this.currentBar < this.loopStartBar || this.currentBar > this.loopEndBar) {
      this.currentBar = this.loopStartBar;
      this.currentStep = 0;
      return true;
    }
    return false;
  }

  advance(song: SongState): void {
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
}
