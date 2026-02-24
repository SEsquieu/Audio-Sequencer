import { SongState, DelayDivision } from "../types/song";
import { FxRack } from "./fx/FxRack";
import { FxInstance } from "./fx/types";

interface TrackSendValues {
  delay: number;
  reverb: number;
  delayTone: number;
  reverbTone: number;
  reverbLowCut: number;
}

interface TrackBusEntry {
  input: GainNode;
  rackIn: GainNode;
  rackOut: GainNode;
  postGain: GainNode;
  sendTap: GainNode;
  sendDelayGain: GainNode;
  sendDelayTone: BiquadFilterNode;
  sendReverbGain: GainNode;
  sendReverbLowCut: BiquadFilterNode;
  sendReverbTone: BiquadFilterNode;
  insertRack: FxRack;
  type: "synth" | "drums";
  nodes: AudioNode[];
  disconnect: () => void;
}

interface DelayBus extends SendBusBase {
  inputFilter: BiquadFilterNode;
  delay: DelayNode;
  feedbackGain: GainNode;
  feedbackTone: BiquadFilterNode;
  wet: GainNode;
}

interface ReverbBus extends SendBusBase {
  preDelay: DelayNode;
  convA: ConvolverNode;
  convB: ConvolverNode;
  convGainA: GainNode;
  convGainB: GainNode;
  tone: BiquadFilterNode;
  wet: GainNode;
  activeConvolver: 0 | 1;
  lastIrKey: string;
}

interface SendBusBase {
  in: GainNode;
  returnGain: GainNode;
  nodes: AudioNode[];
}

export class MixerGraph {
  private static readonly MASTER_SUM_HEADROOM = 0.72;
  private static readonly TRACK_POST_TRIM_SYNTH = 0.92;
  private static readonly TRACK_POST_TRIM_DRUMS = 0.68;
  private static readonly DELAY_SEND_MAX_GAIN = 1.5;
  private static readonly REVERB_SEND_MAX_GAIN = 1.7;

  private masterIn: GainNode | null = null;
  private masterRackIn: GainNode | null = null;
  private masterRackOut: GainNode | null = null;
  private masterInsertRack: FxRack | null = null;
  private masterSafetyDrive: GainNode | null = null;
  private masterSafetyShaper: WaveShaperNode | null = null;
  private masterSafetyOutput: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private delayBus: DelayBus | null = null;
  private reverbBus: ReverbBus | null = null;
  private trackBuses = new Map<string, TrackBusEntry>();
  private trackTypeById = new Map<string, "synth" | "drums">();
  private trackSendById = new Map<string, TrackSendValues>();
  private trackInsertFxById = new Map<string, FxInstance[]>();
  private masterFx: FxInstance[] = [];
  private masterVolume = 0.8;
  private masterSafetyEnabled = false;
  private masterSafetyAmount = 0;
  private delayFx: SongState["sendFx"]["delay"] = {
    division: "1/8",
    feedback: 0.42,
    wet: 0.34,
    tone: 0.72,
  };
  private reverbFx: SongState["sendFx"]["reverb"] = {
    preDelay: 0.08,
    decay: 0.48,
    tone: 0.62,
    wet: 0.42,
    eco: false,
  };

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  }

  private mapSendGain(value: number, kind: "delay" | "reverb"): number {
    const normalized = this.clamp01(value);
    const shaped = normalized <= 0 ? 0 : normalized ** 0.8;
    const maxGain =
      kind === "delay" ? MixerGraph.DELAY_SEND_MAX_GAIN : MixerGraph.REVERB_SEND_MAX_GAIN;
    return shaped * maxGain;
  }

  private mapTrackDelaySendToneHz(value: number): number {
    const t = this.clamp01(value);
    return 1200 + t * 10800;
  }

  private mapTrackReverbSendToneHz(value: number): number {
    const t = this.clamp01(value);
    return 900 + t * 10100;
  }

  private mapTrackReverbLowCutHz(value: number): number {
    const t = this.clamp01(value);
    return 40 + t * 560;
  }

  private mapDelayDivisionToSeconds(tempo: number, division: DelayDivision): number {
    const safeTempo = Math.max(40, Math.min(240, tempo || 120));
    const quarter = 60 / safeTempo;
    if (division === "1/4") {
      return quarter;
    }
    if (division === "1/8") {
      return quarter * 0.5;
    }
    if (division === "1/8d") {
      return quarter * 0.75;
    }
    return quarter * 0.25;
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
    this.masterInsertRack = new FxRack(context);
    this.masterSafetyDrive = context.createGain();
    this.masterSafetyShaper = context.createWaveShaper();
    this.masterSafetyOutput = context.createGain();
    this.masterGain = context.createGain();

    this.masterIn.gain.setValueAtTime(MixerGraph.MASTER_SUM_HEADROOM, context.currentTime);
    this.masterRackIn.gain.setValueAtTime(1, context.currentTime);
    this.masterRackOut.gain.setValueAtTime(1, context.currentTime);
    this.masterSafetyDrive.gain.setValueAtTime(1, context.currentTime);
    this.masterSafetyShaper.curve = null;
    this.masterSafetyShaper.oversample = "2x";
    this.masterSafetyOutput.gain.setValueAtTime(1, context.currentTime);
    this.masterGain.gain.setValueAtTime(this.masterVolume, context.currentTime);

    this.masterIn.connect(this.masterRackIn);
    this.masterRackIn.connect(this.masterInsertRack.rackIn);
    this.masterInsertRack.rackOut.connect(this.masterRackOut);
    this.masterRackOut.connect(this.masterSafetyDrive);
    this.masterSafetyDrive.connect(this.masterSafetyShaper);
    this.masterSafetyShaper.connect(this.masterSafetyOutput);
    this.masterSafetyOutput.connect(this.masterGain);
    this.masterGain.connect(context.destination);

    this.delayBus = this.createDelayBus(context);
    this.reverbBus = this.createReverbBus(context);
    this.delayBus.returnGain.connect(this.masterIn);
    this.reverbBus.returnGain.connect(this.masterIn);

    this.setMasterSafety({ enabled: this.masterSafetyEnabled, amount: this.masterSafetyAmount }, context);
    this.masterInsertRack.setFxInstances(this.masterFx);
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
    base.rackIn.connect(base.insertRack.rackIn);
    base.insertRack.rackOut.connect(base.rackOut);
    return base;
  }

  private createDelayBus(context: AudioContext): DelayBus {
    const input = context.createGain();
    const inputFilter = context.createBiquadFilter();
    const delay = context.createDelay(1.5);
    const feedbackGain = context.createGain();
    const feedbackTone = context.createBiquadFilter();
    const wet = context.createGain();

    input.gain.setValueAtTime(1, context.currentTime);
    inputFilter.type = "lowpass";
    inputFilter.frequency.setValueAtTime(7600, context.currentTime);
    delay.delayTime.setValueAtTime(0.375, context.currentTime);
    feedbackGain.gain.setValueAtTime(0.42, context.currentTime);
    feedbackTone.type = "lowpass";
    feedbackTone.frequency.setValueAtTime(6200, context.currentTime);
    wet.gain.setValueAtTime(0.32, context.currentTime);

    input.connect(inputFilter);
    inputFilter.connect(delay);
    delay.connect(wet);
    delay.connect(feedbackTone);
    feedbackTone.connect(feedbackGain);
    feedbackGain.connect(delay);

    return {
      in: input,
      returnGain: wet,
      inputFilter,
      delay,
      feedbackGain,
      feedbackTone,
      wet,
      nodes: [input, inputFilter, delay, feedbackGain, feedbackTone, wet],
    };
  }

  private createReverbBus(context: AudioContext): ReverbBus {
    const input = context.createGain();
    const preDelay = context.createDelay(0.25);
    const convA = context.createConvolver();
    const convB = context.createConvolver();
    const convGainA = context.createGain();
    const convGainB = context.createGain();
    const tone = context.createBiquadFilter();
    const wet = context.createGain();

    input.gain.setValueAtTime(1, context.currentTime);
    preDelay.delayTime.setValueAtTime(0.018, context.currentTime);
    convA.buffer = this.createImpulseResponse(context, 1.8, 2.4);
    tone.type = "lowpass";
    tone.frequency.setValueAtTime(5600, context.currentTime);
    wet.gain.setValueAtTime(0.26, context.currentTime);
    convGainA.gain.setValueAtTime(1, context.currentTime);
    convGainB.gain.setValueAtTime(0, context.currentTime);

    input.connect(preDelay);
    preDelay.connect(convA);
    preDelay.connect(convB);
    convA.connect(convGainA);
    convB.connect(convGainB);
    convGainA.connect(tone);
    convGainB.connect(tone);
    tone.connect(wet);

    return {
      in: input,
      returnGain: wet,
      preDelay,
      convA,
      convB,
      convGainA,
      convGainB,
      tone,
      wet,
      activeConvolver: 0,
      lastIrKey: "init",
      nodes: [input, preDelay, convA, convB, convGainA, convGainB, tone, wet],
    };
  }

  private createTrackBusBase(context: AudioContext): TrackBusEntry {
    const input = context.createGain();
    const rackIn = context.createGain();
    const rackOut = context.createGain();
    const postGain = context.createGain();
    const sendTap = context.createGain();
    const sendDelayGain = context.createGain();
    const sendDelayTone = context.createBiquadFilter();
    const sendReverbGain = context.createGain();
    const sendReverbLowCut = context.createBiquadFilter();
    const sendReverbTone = context.createBiquadFilter();
    const insertRack = new FxRack(context);

    input.gain.setValueAtTime(1, context.currentTime);
    rackIn.gain.setValueAtTime(1, context.currentTime);
    rackOut.gain.setValueAtTime(1, context.currentTime);
    postGain.gain.setValueAtTime(MixerGraph.TRACK_POST_TRIM_SYNTH, context.currentTime);
    sendTap.gain.setValueAtTime(1, context.currentTime);
    sendDelayGain.gain.setValueAtTime(0, context.currentTime);
    sendReverbGain.gain.setValueAtTime(0, context.currentTime);
    sendDelayTone.type = "lowpass";
    sendDelayTone.frequency.setValueAtTime(this.mapTrackDelaySendToneHz(0.72), context.currentTime);
    sendReverbLowCut.type = "highpass";
    sendReverbLowCut.frequency.setValueAtTime(this.mapTrackReverbLowCutHz(0.24), context.currentTime);
    sendReverbTone.type = "lowpass";
    sendReverbTone.frequency.setValueAtTime(this.mapTrackReverbSendToneHz(0.62), context.currentTime);

    input.connect(rackIn);
    rackOut.connect(postGain);
    postGain.connect(sendTap);
    sendTap.connect(this.getOutputNode(context));
    if (this.delayBus) {
      sendTap.connect(sendDelayGain);
      sendDelayGain.connect(sendDelayTone);
      sendDelayTone.connect(this.delayBus.in);
    }
    if (this.reverbBus) {
      sendTap.connect(sendReverbGain);
      sendReverbGain.connect(sendReverbLowCut);
      sendReverbLowCut.connect(sendReverbTone);
      sendReverbTone.connect(this.reverbBus.in);
    }

    const entry: TrackBusEntry = {
      input,
      rackIn,
      rackOut,
      postGain,
      sendTap,
      sendDelayGain,
      sendDelayTone,
      sendReverbGain,
      sendReverbLowCut,
      sendReverbTone,
      insertRack,
      type: "synth",
      nodes: [
        input,
        rackIn,
        rackOut,
        postGain,
        sendTap,
        sendDelayGain,
        sendDelayTone,
        sendReverbGain,
        sendReverbLowCut,
        sendReverbTone,
      ],
      disconnect: () => {
        entry.insertRack.dispose();
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
    lowTone.gain.setValueAtTime(1.25, context.currentTime);

    highTone.type = "highshelf";
    highTone.frequency.setValueAtTime(4200, context.currentTime);
    highTone.gain.setValueAtTime(0.6, context.currentTime);

    base.rackIn.connect(drive);
    drive.connect(compressor);
    compressor.connect(lowTone);
    lowTone.connect(highTone);
    highTone.connect(base.insertRack.rackIn);
    base.insertRack.rackOut.connect(base.rackOut);

    base.type = "drums";
    base.postGain.gain.setValueAtTime(MixerGraph.TRACK_POST_TRIM_DRUMS, context.currentTime);
    base.nodes.push(drive, compressor, lowTone, highTone);
    return base;
  }

  private applyTrackSendState(context: AudioContext, trackId: string, entry: TrackBusEntry): void {
    const values = this.trackSendById.get(trackId) ?? {
      delay: 0,
      reverb: 0,
      delayTone: 0.72,
      reverbTone: 0.62,
      reverbLowCut: 0.24,
    };
    const when = context.currentTime;
    this.rampParam(entry.sendDelayGain.gain, this.mapSendGain(values.delay, "delay"), when);
    this.rampParam(entry.sendReverbGain.gain, this.mapSendGain(values.reverb, "reverb"), when);
    this.rampParam(entry.sendDelayTone.frequency, this.mapTrackDelaySendToneHz(values.delayTone), when, 0.02);
    this.rampParam(entry.sendReverbTone.frequency, this.mapTrackReverbSendToneHz(values.reverbTone), when, 0.02);
    this.rampParam(entry.sendReverbLowCut.frequency, this.mapTrackReverbLowCutHz(values.reverbLowCut), when, 0.02);
  }

  private applyTrackInsertFxState(trackId: string, entry: TrackBusEntry): void {
    entry.insertRack.setFxInstances(this.trackInsertFxById.get(trackId) ?? []);
  }

  private applyDelayBusFx(context: AudioContext, tempo: number): void {
    if (!this.delayBus) {
      return;
    }
    const when = context.currentTime;
    const delayTime = this.mapDelayDivisionToSeconds(tempo, this.delayFx.division);
    const feedback = Math.max(0, Math.min(0.88, this.delayFx.feedback * 0.88));
    const wet = Math.max(0, Math.min(0.7, this.delayFx.wet * 0.7));
    const toneHz = 1800 + this.delayFx.tone * 9200;
    this.rampParam(this.delayBus.delay.delayTime, delayTime, when, 0.03);
    this.rampParam(this.delayBus.feedbackGain.gain, feedback, when, 0.03);
    this.rampParam(this.delayBus.feedbackTone.frequency, toneHz, when, 0.03);
    this.rampParam(this.delayBus.inputFilter.frequency, Math.min(14000, toneHz + 2200), when, 0.03);
    this.rampParam(this.delayBus.wet.gain, wet, when, 0.03);
  }

  private rebuildReverbIrIfNeeded(context: AudioContext): void {
    if (!this.reverbBus) {
      return;
    }
    const lengthSeconds = this.reverbFx.eco ? 0.8 + this.reverbFx.decay * 1.2 : 1.2 + this.reverbFx.decay * 2.8;
    const decayPower = 1.6 + this.reverbFx.decay * 3.4;
    const key = `${this.reverbFx.eco ? 1 : 0}:${lengthSeconds.toFixed(2)}:${decayPower.toFixed(2)}`;
    if (this.reverbBus.lastIrKey === key) {
      return;
    }
    this.reverbBus.lastIrKey = key;
    const nextIndex: 0 | 1 = this.reverbBus.activeConvolver === 0 ? 1 : 0;
    const nextConv = nextIndex === 0 ? this.reverbBus.convA : this.reverbBus.convB;
    const nextGain = nextIndex === 0 ? this.reverbBus.convGainA : this.reverbBus.convGainB;
    const prevGain = nextIndex === 0 ? this.reverbBus.convGainB : this.reverbBus.convGainA;
    nextConv.buffer = this.createImpulseResponse(context, lengthSeconds, decayPower);
    const when = context.currentTime;
    this.rampParam(nextGain.gain, 1, when, 0.04);
    this.rampParam(prevGain.gain, 0, when, 0.04);
    this.reverbBus.activeConvolver = nextIndex;
  }

  private applyReverbBusFx(context: AudioContext): void {
    if (!this.reverbBus) {
      return;
    }
    this.rebuildReverbIrIfNeeded(context);
    const when = context.currentTime;
    const preDelaySeconds = this.reverbFx.preDelay * 0.08;
    const toneHz = 1400 + this.reverbFx.tone * 9800;
    const wet = Math.max(0, Math.min(0.85, this.reverbFx.wet * 0.8));
    this.rampParam(this.reverbBus.preDelay.delayTime, preDelaySeconds, when, 0.03);
    this.rampParam(this.reverbBus.tone.frequency, toneHz, when, 0.03);
    this.rampParam(this.reverbBus.wet.gain, wet, when, 0.03);
  }

  private applyBusAndMasterState(song: SongState): void {
    const context = (this.masterIn?.context as AudioContext | undefined) ?? null;
    if (!context) {
      return;
    }
    this.delayFx = song.sendFx?.delay ?? this.delayFx;
    this.reverbFx = song.sendFx?.reverb ?? this.reverbFx;
    this.applyDelayBusFx(context, song.tempo);
    this.applyReverbBusFx(context);
    this.setMasterSafety(song.masterSafety ?? { enabled: false, amount: 0 });
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
        this.applyTrackInsertFxState(trackId, existing);
        return existing.input;
      }
      this.fadeAndDisposeTrackBus(context, existing);
      this.trackBuses.delete(trackId);
    }

    const type = this.trackTypeById.get(trackId) ?? "synth";
    const next = type === "drums" ? this.createDrumBus(context) : this.createSynthBus(context);
    this.applyTrackSendState(context, trackId, next);
    this.applyTrackInsertFxState(trackId, next);
    this.trackBuses.set(trackId, next);
    return next.input;
  }

  pruneTrackBuses(song: SongState): void {
    this.trackTypeById.clear();
    this.masterFx = song.masterFx ?? [];
    this.masterInsertRack?.setFxInstances(this.masterFx);
    this.applyBusAndMasterState(song);
    for (const track of song.tracks) {
      this.trackTypeById.set(track.id, track.type);
      const maybeSend = (track as typeof track & {
        send?: Partial<TrackSendValues>;
      }).send;
      if (maybeSend) {
        this.setTrackSend(track.id, {
          delay: maybeSend.delay ?? 0,
          reverb: maybeSend.reverb ?? 0,
          delayTone: maybeSend.delayTone ?? 0.72,
          reverbTone: maybeSend.reverbTone ?? 0.62,
          reverbLowCut: maybeSend.reverbLowCut ?? 0.24,
        });
      }
      const insertFx = (track as typeof track & { insertFx?: FxInstance[] }).insertFx ?? [];
      this.trackInsertFxById.set(track.id, insertFx);
      this.trackBuses.get(track.id)?.insertRack.setFxInstances(insertFx);
    }

    const liveTrackIds = new Set(song.tracks.map((track) => track.id));
    for (const [trackId, bus] of this.trackBuses.entries()) {
      if (liveTrackIds.has(trackId)) {
        continue;
      }
      this.trackSendById.delete(trackId);
      this.trackInsertFxById.delete(trackId);
      // Existing nodes may still be ringing; fade out before disconnecting.
      const audioContext = bus.input.context as AudioContext;
      this.fadeAndDisposeTrackBus(audioContext, bus);
      this.trackBuses.delete(trackId);
    }
  }

  setTrackSend(trackId: string, values: Partial<TrackSendValues>): void {
    const previous = this.trackSendById.get(trackId) ?? {
      delay: 0,
      reverb: 0,
      delayTone: 0.72,
      reverbTone: 0.62,
      reverbLowCut: 0.24,
    };
    const next: TrackSendValues = {
      delay: this.clamp01(values.delay ?? previous.delay),
      reverb: this.clamp01(values.reverb ?? previous.reverb),
      delayTone: this.clamp01(values.delayTone ?? previous.delayTone),
      reverbTone: this.clamp01(values.reverbTone ?? previous.reverbTone),
      reverbLowCut: this.clamp01(values.reverbLowCut ?? previous.reverbLowCut),
    };
    this.trackSendById.set(trackId, next);

    const bus = this.trackBuses.get(trackId);
    if (!bus) {
      return;
    }
    const when = bus.input.context.currentTime;
    this.rampParam(bus.sendDelayGain.gain, this.mapSendGain(next.delay, "delay"), when);
    this.rampParam(bus.sendReverbGain.gain, this.mapSendGain(next.reverb, "reverb"), when);
    this.rampParam(bus.sendDelayTone.frequency, this.mapTrackDelaySendToneHz(next.delayTone), when, 0.02);
    this.rampParam(bus.sendReverbTone.frequency, this.mapTrackReverbSendToneHz(next.reverbTone), when, 0.02);
    this.rampParam(bus.sendReverbLowCut.frequency, this.mapTrackReverbLowCutHz(next.reverbLowCut), when, 0.02);
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
    if (this.masterSafetyShaper) {
      this.masterSafetyShaper.curve =
        amount > 0.0001
          ? (this.createDriveCurve(0.02 + amount * 0.22) as unknown as Float32Array<ArrayBuffer>)
          : null;
    }
    const drive = 1 + amount * 0.22;
    const makeup = Math.max(0.86, 1 - amount * 0.16);
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
