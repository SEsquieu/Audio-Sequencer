import { SongState } from "../types/song";

interface TrackBusEntry {
  input: GainNode;
}

export class MixerGraph {
  private masterGain: GainNode | null = null;
  private trackBuses = new Map<string, TrackBusEntry>();
  private masterVolume = 0.8;

  init(context: AudioContext, masterVolume: number): void {
    this.masterVolume = masterVolume;
    if (!this.masterGain) {
      this.masterGain = context.createGain();
      this.masterGain.gain.setValueAtTime(this.masterVolume, context.currentTime);
      this.masterGain.connect(context.destination);
    }
  }

  getOutputNode(context: AudioContext): AudioNode {
    return this.masterGain ?? context.destination;
  }

  getTrackInputNode(context: AudioContext, trackId: string): AudioNode {
    const existing = this.trackBuses.get(trackId);
    if (existing) {
      return existing.input;
    }
    const bus = context.createGain();
    bus.gain.setValueAtTime(1, context.currentTime);
    bus.connect(this.getOutputNode(context));
    this.trackBuses.set(trackId, { input: bus });
    return bus;
  }

  pruneTrackBuses(song: SongState): void {
    const liveTrackIds = new Set(song.tracks.map((track) => track.id));
    for (const [trackId, bus] of this.trackBuses.entries()) {
      if (liveTrackIds.has(trackId)) {
        continue;
      }
      bus.input.disconnect();
      this.trackBuses.delete(trackId);
    }
  }

  setMasterVolume(context: AudioContext | null, value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.masterVolume = clamped;
    if (!context || !this.masterGain) {
      return;
    }
    const when = context.currentTime;
    this.masterGain.gain.cancelScheduledValues(when);
    this.masterGain.gain.setTargetAtTime(clamped, when, 0.01);
  }
}
