import { SongState } from "../types/song";

interface TrackBusEntry {
  input: GainNode;
  type: "synth" | "drums";
  disconnect: () => void;
}

export class MixerGraph {
  private masterGain: GainNode | null = null;
  private trackBuses = new Map<string, TrackBusEntry>();
  private trackTypeById = new Map<string, "synth" | "drums">();
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

  private createDriveCurve(amount: number): Float32Array {
    const samples = 1024;
    const curve = new Float32Array(samples);
    const k = Math.max(0, amount) * 55 + 1;
    for (let i = 0; i < samples; i += 1) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  private createSynthBus(context: AudioContext): TrackBusEntry {
    const input = context.createGain();
    input.gain.setValueAtTime(1, context.currentTime);
    input.connect(this.getOutputNode(context));
    return {
      input,
      type: "synth",
      disconnect: () => {
        input.disconnect();
      },
    };
  }

  private createDrumBus(context: AudioContext): TrackBusEntry {
    const input = context.createGain();
    const drive = context.createWaveShaper();
    const compressor = context.createDynamicsCompressor();
    const lowTone = context.createBiquadFilter();
    const highTone = context.createBiquadFilter();

    input.gain.setValueAtTime(1, context.currentTime);

    drive.curve = this.createDriveCurve(0.22) as unknown as Float32Array<ArrayBuffer>;
    drive.oversample = "2x";

    compressor.threshold.setValueAtTime(-16, context.currentTime);
    compressor.knee.setValueAtTime(22, context.currentTime);
    compressor.ratio.setValueAtTime(3.2, context.currentTime);
    compressor.attack.setValueAtTime(0.003, context.currentTime);
    compressor.release.setValueAtTime(0.12, context.currentTime);

    lowTone.type = "lowshelf";
    lowTone.frequency.setValueAtTime(130, context.currentTime);
    lowTone.gain.setValueAtTime(2.5, context.currentTime);

    highTone.type = "highshelf";
    highTone.frequency.setValueAtTime(4200, context.currentTime);
    highTone.gain.setValueAtTime(1.3, context.currentTime);

    input.connect(drive);
    drive.connect(compressor);
    compressor.connect(lowTone);
    lowTone.connect(highTone);
    highTone.connect(this.getOutputNode(context));

    return {
      input,
      type: "drums",
      disconnect: () => {
        input.disconnect();
        drive.disconnect();
        compressor.disconnect();
        lowTone.disconnect();
        highTone.disconnect();
      },
    };
  }

  getTrackInputNode(context: AudioContext, trackId: string): AudioNode {
    const existing = this.trackBuses.get(trackId);
    if (existing) {
      const desiredType = this.trackTypeById.get(trackId) ?? "synth";
      if (existing.type === desiredType) {
        return existing.input;
      }
      existing.disconnect();
      this.trackBuses.delete(trackId);
    }

    const type = this.trackTypeById.get(trackId) ?? "synth";
    const next = type === "drums" ? this.createDrumBus(context) : this.createSynthBus(context);
    this.trackBuses.set(trackId, next);
    return next.input;
  }

  pruneTrackBuses(song: SongState): void {
    this.trackTypeById.clear();
    for (const track of song.tracks) {
      this.trackTypeById.set(track.id, track.type);
    }

    const liveTrackIds = new Set(song.tracks.map((track) => track.id));
    for (const [trackId, bus] of this.trackBuses.entries()) {
      if (liveTrackIds.has(trackId)) {
        continue;
      }
      bus.disconnect();
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
