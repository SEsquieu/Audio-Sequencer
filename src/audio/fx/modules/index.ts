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

export const createFxModule = (context: AudioContext, fx: FxInstance): FxModuleHandle => {
  if (fx.type === "saturator") {
    return createSaturatorModule(context, fx as FxInstance<"saturator">);
  }
  return createEq3Module(context, fx as FxInstance<"eq3">);
};

export type { FxModuleHandle };
