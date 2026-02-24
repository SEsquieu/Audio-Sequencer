export type FxType = "saturator" | "eq3" | "chorus" | "djFilter";

export interface SaturatorParams {
  drive: number;
  mix: number;
  output: number;
}

export interface Eq3Params {
  low: number;
  mid: number;
  high: number;
  lowFreq: number;
  midFreq: number;
  highFreq: number;
  midQ: number;
}

export interface ChorusParams {
  rate: number;
  depth: number;
  mix: number;
}

export interface DjFilterParams {
  cutoff: number;
  q: number;
  mode: "lp" | "hp";
}

export interface FxParamsByType {
  saturator: SaturatorParams;
  eq3: Eq3Params;
  chorus: ChorusParams;
  djFilter: DjFilterParams;
}

export type FxParams = FxParamsByType[FxType];

export interface FxInstance<T extends FxType = FxType> {
  id: string;
  type: T;
  enabled: boolean;
  params: FxParamsByType[T];
}

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const clampRange = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

export const defaultFxParams = (type: FxType): FxParamsByType[FxType] => {
  if (type === "saturator") {
    return {
      drive: 0.2,
      mix: 0.45,
      output: 0.95,
    };
  }
  if (type === "eq3") {
    return {
      low: 0,
      mid: 0,
      high: 0,
      lowFreq: 180,
      midFreq: 1200,
      highFreq: 5200,
      midQ: 0.9,
    };
  }
  if (type === "chorus") {
    return {
      rate: 0.28,
      depth: 0.45,
      mix: 0.38,
    };
  }
  return {
    cutoff: 0.58,
    q: 0.24,
    mode: "lp",
  };
};

export const createFxInstance = (type: FxType, id: string): FxInstance => ({
  id,
  type,
  enabled: true,
  params: defaultFxParams(type) as FxParams,
});
