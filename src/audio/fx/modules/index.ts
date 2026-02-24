import { FxInstance, clamp01, clampRange } from "../types";
import { rampParam } from "../util";

interface FxModuleHandle {
  input: AudioNode;
  output: AudioNode;
  setParams: (params: unknown, when: number) => void;
  dispose: () => void;
}

const makeDriveCurve = (amount: number): Float32Array => {
  const size = 1024;
  const curve = new Float32Array(size);
  const k = Math.max(0, amount) * 55 + 1;
  for (let i = 0; i < size; i += 1) {
    const x = (i * 2) / (size - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
};

const createSaturatorModule = (context: AudioContext, fx: FxInstance<"saturator">): FxModuleHandle => {
  const input = context.createGain();
  const dry = context.createGain();
  const pre = context.createGain();
  const shaper = context.createWaveShaper();
  const wet = context.createGain();
  const output = context.createGain();

  shaper.oversample = "2x";

  input.connect(dry);
  input.connect(pre);
  pre.connect(shaper);
  shaper.connect(wet);
  dry.connect(output);
  wet.connect(output);

  const setParams = (params: unknown, when: number) => {
    const next = params as FxInstance<"saturator">["params"];
    const drive = clamp01(next?.drive ?? 0.2);
    const mix = clamp01(next?.mix ?? 0.45);
    const outputGain = clampRange(next?.output ?? 0.95, 0, 2);
    shaper.curve = makeDriveCurve(drive) as unknown as Float32Array<ArrayBuffer>;
    rampParam(pre.gain, 1 + drive * 3.4, when, 0.02);
    rampParam(dry.gain, 1 - mix, when, 0.02);
    rampParam(wet.gain, mix, when, 0.02);
    rampParam(output.gain, outputGain, when, 0.02);
  };

  setParams(fx.params, context.currentTime);

  return {
    input,
    output,
    setParams,
    dispose: () => {
      input.disconnect();
      dry.disconnect();
      pre.disconnect();
      shaper.disconnect();
      wet.disconnect();
      output.disconnect();
    },
  };
};

const createEq3Module = (context: AudioContext, fx: FxInstance<"eq3">): FxModuleHandle => {
  const input = context.createGain();
  const low = context.createBiquadFilter();
  const mid = context.createBiquadFilter();
  const high = context.createBiquadFilter();
  const output = context.createGain();

  low.type = "lowshelf";
  mid.type = "peaking";
  high.type = "highshelf";

  input.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(output);

  const setParams = (params: unknown, when: number) => {
    const next = params as FxInstance<"eq3">["params"];
    rampParam(low.gain, clampRange(next?.low ?? 0, -18, 18), when, 0.02);
    rampParam(mid.gain, clampRange(next?.mid ?? 0, -18, 18), when, 0.02);
    rampParam(high.gain, clampRange(next?.high ?? 0, -18, 18), when, 0.02);
    rampParam(low.frequency, clampRange(next?.lowFreq ?? 180, 40, 1200), when, 0.02);
    rampParam(mid.frequency, clampRange(next?.midFreq ?? 1200, 180, 6000), when, 0.02);
    rampParam(high.frequency, clampRange(next?.highFreq ?? 5200, 1200, 14000), when, 0.02);
    rampParam(mid.Q, clampRange(next?.midQ ?? 0.9, 0.2, 8), when, 0.02);
    rampParam(output.gain, 1, when, 0.02);
  };

  setParams(fx.params, context.currentTime);

  return {
    input,
    output,
    setParams,
    dispose: () => {
      input.disconnect();
      low.disconnect();
      mid.disconnect();
      high.disconnect();
      output.disconnect();
    },
  };
};

const createChorusModule = (context: AudioContext, fx: FxInstance<"chorus">): FxModuleHandle => {
  const input = context.createGain();
  const dry = context.createGain();
  const wet = context.createGain();
  const output = context.createGain();
  const delayL = context.createDelay(0.05);
  const delayR = context.createDelay(0.05);
  const panL = context.createStereoPanner();
  const panR = context.createStereoPanner();
  const lfo = context.createOscillator();
  const lfoDepthL = context.createGain();
  const lfoDepthR = context.createGain();

  panL.pan.setValueAtTime(-0.55, context.currentTime);
  panR.pan.setValueAtTime(0.55, context.currentTime);

  input.connect(dry);
  input.connect(delayL);
  input.connect(delayR);
  delayL.connect(panL);
  delayR.connect(panR);
  panL.connect(wet);
  panR.connect(wet);
  dry.connect(output);
  wet.connect(output);

  lfo.type = "sine";
  lfo.connect(lfoDepthL);
  lfo.connect(lfoDepthR);
  lfoDepthL.connect(delayL.delayTime);
  lfoDepthR.connect(delayR.delayTime);
  lfo.start();

  const setParams = (params: unknown, when: number) => {
    const next = params as FxInstance<"chorus">["params"];
    const rate = clamp01(next?.rate ?? 0.28);
    const depth = clamp01(next?.depth ?? 0.45);
    const mix = clamp01(next?.mix ?? 0.38);
    const rateHz = 0.08 + rate * 5.4;
    const baseDelay = 0.010 + depth * 0.007;
    const depthSeconds = 0.0006 + depth * 0.0062;

    rampParam(lfo.frequency, rateHz, when, 0.03);
    rampParam(delayL.delayTime, baseDelay, when, 0.03);
    rampParam(delayR.delayTime, Math.max(0.001, baseDelay * 1.08), when, 0.03);
    rampParam(lfoDepthL.gain, depthSeconds, when, 0.03);
    rampParam(lfoDepthR.gain, -depthSeconds * 0.93, when, 0.03);
    rampParam(dry.gain, 1 - mix * 0.78, when, 0.03);
    rampParam(wet.gain, mix * 0.92, when, 0.03);
  };

  setParams(fx.params, context.currentTime);

  return {
    input,
    output,
    setParams,
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        // already stopped
      }
      input.disconnect();
      dry.disconnect();
      wet.disconnect();
      output.disconnect();
      delayL.disconnect();
      delayR.disconnect();
      panL.disconnect();
      panR.disconnect();
      lfo.disconnect();
      lfoDepthL.disconnect();
      lfoDepthR.disconnect();
    },
  };
};

const createDjFilterModule = (context: AudioContext, fx: FxInstance<"djFilter">): FxModuleHandle => {
  const input = context.createGain();
  const filter = context.createBiquadFilter();
  const output = context.createGain();

  input.connect(filter);
  filter.connect(output);

  const setParams = (params: unknown, when: number) => {
    const next = params as FxInstance<"djFilter">["params"];
    const cutoffNorm = clamp01(next?.cutoff ?? 0.58);
    const qNorm = clamp01(next?.q ?? 0.24);
    const mode = next?.mode === "hp" ? "highpass" : "lowpass";
    const minHz = 30;
    const maxHz = 18000;
    const cutoffHz = minHz * (maxHz / minHz) ** cutoffNorm;
    filter.type = mode;
    rampParam(filter.frequency, cutoffHz, when, 0.02);
    rampParam(filter.Q, 0.4 + qNorm * 17, when, 0.02);
    rampParam(output.gain, 1, when, 0.02);
  };

  setParams(fx.params, context.currentTime);

  return {
    input,
    output,
    setParams,
    dispose: () => {
      input.disconnect();
      filter.disconnect();
      output.disconnect();
    },
  };
};

export const createFxModule = (context: AudioContext, fx: FxInstance): FxModuleHandle => {
  if (fx.type === "saturator") {
    return createSaturatorModule(context, fx as FxInstance<"saturator">);
  }
  if (fx.type === "eq3") {
    return createEq3Module(context, fx as FxInstance<"eq3">);
  }
  if (fx.type === "chorus") {
    return createChorusModule(context, fx as FxInstance<"chorus">);
  }
  return createDjFilterModule(context, fx as FxInstance<"djFilter">);
};

export type { FxModuleHandle };
