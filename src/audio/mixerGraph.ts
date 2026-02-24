import { SongState } from "../types/song";

interface TrackSendValues {
  delay: number;
  reverb: number;
}

interface TrackBusEntry {
  input: GainNode;
  rackIn: GainNode;
  rackOut: GainNode;
  postGain: GainNode;
  sendTap: GainNode;
  sendDelayGain: GainNode;
  sendReverbGain: GainNode;
  type: "synth" | "drums";
  nodes: AudioNode[];
  disconnect: () => void;
}

interface SendBus {
  in: GainNode;
  returnGain: GainNode;
  nodes: AudioNode[];
}

export class MixerGraph {
  private masterIn: GainNode | null = null;
  private masterRackIn: GainNode | null = null;
  private masterRackOut: GainNode | null = null;
  private masterSafetyDrive: GainNode | null = null;
  private masterSafetyShaper: WaveShaperNode | null = null;
  private masterSafetyOutput: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private delayBus: SendBus | null = null;
  private reverbBus: SendBus | null = null;
  private trackBuses = new Map<string, TrackBusEntry>();
  private trackTypeById = new Map<string, "synth" | "drums">();
  private trackSendById = new Map<string, TrackSendValues>();
  private masterVolume = 0.8;
  private masterSafetyEnabled = true;
  private masterSafetyAmount = 0.2;

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  }

  private rampParam(param: AudioParam, value: number, when: number, timeConstant = 0.015): void {
    param.cancelScheduledValues(when);
    param.setTargetAtTime(value, when, timeConstant);
  }

  private createImpulseResponse(context: AudioContext, seconds: number, decay: number): AudioBuffer {
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
      const channel = buffer.getChannelData(channelIndex);
      for (let i = 0; i < length; i += 1) {
        const t = i / Math.max(1, length - 1);
        const envelope = (1 - t) ** Math.max(1, decay);
        channel[i] = (Math.random() * 2 - 1) * envelope;
      }
    }
    return buffer;
  }

  init(context: AudioContext, masterVolume: number): void {
    this.masterVolume = masterVolume;
    if (this.masterGain) {
      return;
    }

    this.masterIn = context.createGain();
    this.masterRackIn = context.createGain();
    this.masterRackOut = context.createGain();
    this.masterSafetyDrive = context.createGain();
    this.masterSafetyShaper = context.createWaveShaper();
    this.masterSafetyOutput = context.createGain();
    this.masterGain = context.createGain();

    this.masterIn.gain.setValueAtTime(1, context.currentTime);
    this.masterRackIn.gain.setValueAtTime(1, context.currentTime);
    this.masterRackOut.gain.setValueAtTime(1, context.currentTime);
    this.masterSafetyDrive.gain.setValueAtTime(1, context.currentTime);
    this.masterSafetyShaper.curve = this.createDriveCurve(0.35) as unknown as Float32Array<ArrayBuffer>;
    this.masterSafetyShaper.oversample = "2x";
    this.masterSafetyOutput.gain.setValueAtTime(1, context.currentTime);
    this.masterGain.gain.setValueAtTime(this.masterVolume, context.currentTime);

    this.masterIn.connect(this.masterRackIn);
    this.masterRackIn.connect(this.masterRackOut);
    this.masterRackOut.connect(this.masterSafetyDrive);
    this.masterSafetyDrive.connect(this.masterSafetyShaper);
    this.masterSafetyShaper.connect(this.masterSafetyOutput);
    this.masterSafetyOutput.connect(this.masterGain);
    this.masterGain.connect(context.destination);

    this.delayBus = this.createDelayBus(context);
    this.reverbBus = this.createReverbBus(context);
    this.delayBus.returnGain.connect(this.masterIn);
    this.reverbBus.returnGain.connect(this.masterIn);

    this.setMasterSafety({ enabled: true, amount: this.masterSafetyAmount }, context);
  }

  getOutputNode(context: AudioContext): AudioNode {
    return this.masterIn ?? context.destination;
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
    const base = this.createTrackBusBase(context);
    base.rackIn.connect(base.rackOut);
    return base;
  }

  private createDelayBus(context: AudioContext): SendBus {
    const input = context.createGain();
    const inputFilter = context.createBiquadFilter();
    const delay = context.createDelay(1.5);
    const feedbackGain = context.createGain();
    const feedbackTone = context.createBiquadFilter();
    const wet = context.createGain();

    input.gain.setValueAtTime(1, context.currentTime);
    inputFilter.type = "lowpass";
    inputFilter.frequency.setValueAtTime(6200, context.currentTime);
    delay.delayTime.setValueAtTime(0.25, context.currentTime);
    feedbackGain.gain.setValueAtTime(0.28, context.currentTime);
    feedbackTone.type = "lowpass";
    feedbackTone.frequency.setValueAtTime(4800, context.currentTime);
    wet.gain.setValueAtTime(0.2, context.currentTime);

    input.connect(inputFilter);
    inputFilter.connect(delay);
    delay.connect(wet);
    delay.connect(feedbackTone);
    feedbackTone.connect(feedbackGain);
    feedbackGain.connect(delay);

    return {
      in: input,
      returnGain: wet,
      nodes: [input, inputFilter, delay, feedbackGain, feedbackTone, wet],
    };
  }

  private createReverbBus(context: AudioContext): SendBus {
    const input = context.createGain();
    const preDelay = context.createDelay(0.25);
    const convolver = context.createConvolver();
    const tone = context.createBiquadFilter();
    const wet = context.createGain();

    input.gain.setValueAtTime(1, context.currentTime);
    preDelay.delayTime.setValueAtTime(0.018, context.currentTime);
    convolver.buffer = this.createImpulseResponse(context, 1.8, 2.4);
    tone.type = "lowpass";
    tone.frequency.setValueAtTime(5200, context.currentTime);
    wet.gain.setValueAtTime(0.22, context.currentTime);

    input.connect(preDelay);
    preDelay.connect(convolver);
    convolver.connect(tone);
    tone.connect(wet);

    return {
      in: input,
      returnGain: wet,
      nodes: [input, preDelay, convolver, tone, wet],
    };
  }

  private createTrackBusBase(context: AudioContext): TrackBusEntry {
    const input = context.createGain();
    const rackIn = context.createGain();
    const rackOut = context.createGain();
    const postGain = context.createGain();
    const sendTap = context.createGain();
    const sendDelayGain = context.createGain();
    const sendReverbGain = context.createGain();

    input.gain.setValueAtTime(1, context.currentTime);
    rackIn.gain.setValueAtTime(1, context.currentTime);
    rackOut.gain.setValueAtTime(1, context.currentTime);
    postGain.gain.setValueAtTime(1, context.currentTime);
    sendTap.gain.setValueAtTime(1, context.currentTime);
    sendDelayGain.gain.setValueAtTime(0, context.currentTime);
    sendReverbGain.gain.setValueAtTime(0, context.currentTime);

    input.connect(rackIn);
    rackOut.connect(postGain);
    postGain.connect(sendTap);
    sendTap.connect(this.getOutputNode(context));
    if (this.delayBus) {
      sendTap.connect(sendDelayGain);
      sendDelayGain.connect(this.delayBus.in);
    }
    if (this.reverbBus) {
      sendTap.connect(sendReverbGain);
      sendReverbGain.connect(this.reverbBus.in);
    }

    const entry: TrackBusEntry = {
      input,
      rackIn,
      rackOut,
      postGain,
      sendTap,
      sendDelayGain,
      sendReverbGain,
      type: "synth",
      nodes: [input, rackIn, rackOut, postGain, sendTap, sendDelayGain, sendReverbGain],
      disconnect: () => {
        for (const node of entry.nodes) {
          node.disconnect();
        }
      },
    };
    return entry;
  }

  private createDrumBus(context: AudioContext): TrackBusEntry {
    const base = this.createTrackBusBase(context);
    const drive = context.createWaveShaper();
    const compressor = context.createDynamicsCompressor();
    const lowTone = context.createBiquadFilter();
    const highTone = context.createBiquadFilter();

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

    base.rackIn.connect(drive);
    drive.connect(compressor);
    compressor.connect(lowTone);
    lowTone.connect(highTone);
    highTone.connect(base.rackOut);

    base.type = "drums";
    base.nodes.push(drive, compressor, lowTone, highTone);
    return base;
  }

  private applyTrackSendState(context: AudioContext, trackId: string, entry: TrackBusEntry): void {
    const values = this.trackSendById.get(trackId) ?? { delay: 0, reverb: 0 };
    const when = context.currentTime;
    this.rampParam(entry.sendDelayGain.gain, this.clamp01(values.delay), when);
    this.rampParam(entry.sendReverbGain.gain, this.clamp01(values.reverb), when);
  }

  private fadeAndDisposeTrackBus(context: AudioContext, entry: TrackBusEntry): void {
    const when = context.currentTime;
    this.rampParam(entry.postGain.gain, 0, when, 0.01);
    this.rampParam(entry.sendDelayGain.gain, 0, when, 0.01);
    this.rampParam(entry.sendReverbGain.gain, 0, when, 0.01);
    window.setTimeout(() => {
      try {
        entry.disconnect();
      } catch {
        // Ignore late disconnect races during context teardown.
      }
    }, 80);
  }

  getTrackInputNode(context: AudioContext, trackId: string): AudioNode {
    const existing = this.trackBuses.get(trackId);
    if (existing) {
      const desiredType = this.trackTypeById.get(trackId) ?? "synth";
      if (existing.type === desiredType) {
        this.applyTrackSendState(context, trackId, existing);
        return existing.input;
      }
      this.fadeAndDisposeTrackBus(context, existing);
      this.trackBuses.delete(trackId);
    }

    const type = this.trackTypeById.get(trackId) ?? "synth";
    const next = type === "drums" ? this.createDrumBus(context) : this.createSynthBus(context);
    this.applyTrackSendState(context, trackId, next);
    this.trackBuses.set(trackId, next);
    return next.input;
  }

  pruneTrackBuses(song: SongState): void {
    this.trackTypeById.clear();
    for (const track of song.tracks) {
      this.trackTypeById.set(track.id, track.type);
      const maybeSend = (track as typeof track & {
        send?: Partial<TrackSendValues>;
      }).send;
      if (maybeSend) {
        this.setTrackSend(track.id, {
          delay: maybeSend.delay ?? 0,
          reverb: maybeSend.reverb ?? 0,
        });
      }
    }

    const liveTrackIds = new Set(song.tracks.map((track) => track.id));
    for (const [trackId, bus] of this.trackBuses.entries()) {
      if (liveTrackIds.has(trackId)) {
        continue;
      }
      this.trackSendById.delete(trackId);
      // Existing nodes may still be ringing; fade out before disconnecting.
      const audioContext = bus.input.context as AudioContext;
      this.fadeAndDisposeTrackBus(audioContext, bus);
      this.trackBuses.delete(trackId);
    }
  }

  setTrackSend(trackId: string, values: Partial<TrackSendValues>): void {
    const previous = this.trackSendById.get(trackId) ?? { delay: 0, reverb: 0 };
    const next: TrackSendValues = {
      delay: this.clamp01(values.delay ?? previous.delay),
      reverb: this.clamp01(values.reverb ?? previous.reverb),
    };
    this.trackSendById.set(trackId, next);

    const bus = this.trackBuses.get(trackId);
    if (!bus) {
      return;
    }
    const when = bus.input.context.currentTime;
    this.rampParam(bus.sendDelayGain.gain, next.delay, when);
    this.rampParam(bus.sendReverbGain.gain, next.reverb, when);
  }

  setMasterSafety(
    config: number | { amount?: number; enabled?: boolean },
    contextOverride: AudioContext | null = null
  ): void {
    if (typeof config === "number") {
      this.masterSafetyAmount = this.clamp01(config);
      this.masterSafetyEnabled = true;
    } else {
      if (typeof config.amount === "number") {
        this.masterSafetyAmount = this.clamp01(config.amount);
      }
      if (typeof config.enabled === "boolean") {
        this.masterSafetyEnabled = config.enabled;
      }
    }

    const context = contextOverride ?? this.masterSafetyDrive?.context ?? null;
    if (!context || !this.masterSafetyDrive || !this.masterSafetyOutput) {
      return;
    }

    const amount = this.masterSafetyEnabled ? this.masterSafetyAmount : 0;
    const drive = 1 + amount * 1.6;
    const makeup = 1 / Math.max(1, 1 + amount * 0.65);
    const when = context.currentTime;
    this.rampParam(this.masterSafetyDrive.gain, drive, when, 0.02);
    this.rampParam(this.masterSafetyOutput.gain, makeup, when, 0.02);
  }

  setMasterVolume(context: AudioContext | null, value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.masterVolume = clamped;
    if (!context || !this.masterGain) {
      return;
    }
    const when = context.currentTime;
    this.rampParam(this.masterGain.gain, clamped, when, 0.01);
  }
}
