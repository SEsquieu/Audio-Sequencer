import { DelayBusTargetId, ReverbBusTargetId, SongState } from "../types/song";
import { normalizeInstrumentParams } from "./instrumentDefaults";
import { FxInstance, FxType, defaultFxParams } from "../audio/fx/types";

const isFxType = (value: unknown): value is FxType =>
  value === "saturator" || value === "eq3" || value === "chorus" || value === "djFilter";
const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const isDelayBusTargetId = (value: unknown): value is DelayBusTargetId =>
  value === "custom" || value === "echoA" || value === "echoB";
const isReverbBusTargetId = (value: unknown): value is ReverbBusTargetId =>
  value === "custom" || value === "roomA" || value === "hallB";

const normalizeFxInstances = (value: unknown): FxInstance[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index): FxInstance | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const fx = item as Partial<FxInstance>;
      if (!isFxType(fx.type)) {
        return null;
      }
      return {
        id: typeof fx.id === "string" && fx.id.length > 0 ? fx.id : `fx-${Date.now()}-${index}`,
        type: fx.type,
        enabled: fx.enabled !== false,
        params: {
          ...defaultFxParams(fx.type),
          ...(fx.params && typeof fx.params === "object" ? fx.params : {}),
        } as FxInstance["params"],
      };
    })
    .filter((fx): fx is FxInstance => !!fx);
};

export const normalizeSongState = (song: SongState): SongState => ({
  ...song,
  masterFx: normalizeFxInstances((song as SongState & { masterFx?: unknown }).masterFx),
  sendFx: {
    delay: {
      division:
        (song as SongState & { sendFx?: { delay?: { division?: SongState["sendFx"]["delay"]["division"] } } }).sendFx
          ?.delay?.division ?? "1/8",
      feedback: clamp01((song as SongState & { sendFx?: { delay?: { feedback?: number } } }).sendFx?.delay?.feedback, 0.42),
      wet: clamp01((song as SongState & { sendFx?: { delay?: { wet?: number } } }).sendFx?.delay?.wet, 0.34),
      tone: clamp01((song as SongState & { sendFx?: { delay?: { tone?: number } } }).sendFx?.delay?.tone, 0.72),
    },
    reverb: {
      preDelay: clamp01(
        (song as SongState & { sendFx?: { reverb?: { preDelay?: number } } }).sendFx?.reverb?.preDelay,
        0.08
      ),
      decay: clamp01((song as SongState & { sendFx?: { reverb?: { decay?: number } } }).sendFx?.reverb?.decay, 0.48),
      tone: clamp01((song as SongState & { sendFx?: { reverb?: { tone?: number } } }).sendFx?.reverb?.tone, 0.62),
      wet: clamp01((song as SongState & { sendFx?: { reverb?: { wet?: number } } }).sendFx?.reverb?.wet, 0.42),
      eco:
        (song as SongState & { sendFx?: { reverb?: { eco?: boolean } } }).sendFx?.reverb?.eco === true,
    },
  },
  masterSafety: {
    enabled:
      (song as SongState & { masterSafety?: { enabled?: boolean } }).masterSafety?.enabled === true,
    amount: clamp01((song as SongState & { masterSafety?: { amount?: number } }).masterSafety?.amount, 0.08),
  },
  performance: {
    ecoMode: (song as SongState & { performance?: { ecoMode?: boolean } }).performance?.ecoMode === true,
  },
  tracks: song.tracks.map((track) => ({
    ...track,
    instrument: normalizeInstrumentParams(track.type, track.instrument),
    send: {
      delay:
        typeof (track as typeof track & { send?: { delay?: number } }).send?.delay === "number"
          ? Math.max(0, Math.min(1, (track as typeof track & { send?: { delay?: number } }).send!.delay!))
          : 0,
      reverb:
        typeof (track as typeof track & { send?: { reverb?: number } }).send?.reverb === "number"
          ? Math.max(0, Math.min(1, (track as typeof track & { send?: { reverb?: number } }).send!.reverb!))
          : 0,
      delayTone:
        typeof (track as typeof track & { send?: { delayTone?: number } }).send?.delayTone === "number"
          ? Math.max(0, Math.min(1, (track as typeof track & { send?: { delayTone?: number } }).send!.delayTone!))
          : 0.72,
      reverbTone:
        typeof (track as typeof track & { send?: { reverbTone?: number } }).send?.reverbTone === "number"
          ? Math.max(
              0,
              Math.min(1, (track as typeof track & { send?: { reverbTone?: number } }).send!.reverbTone!)
            )
          : 0.62,
      reverbLowCut:
        typeof (track as typeof track & { send?: { reverbLowCut?: number } }).send?.reverbLowCut === "number"
          ? Math.max(
              0,
              Math.min(1, (track as typeof track & { send?: { reverbLowCut?: number } }).send!.reverbLowCut!)
            )
          : 0.24,
      delayBus: isDelayBusTargetId((track as typeof track & { send?: { delayBus?: unknown } }).send?.delayBus)
        ? ((track as typeof track & { send?: { delayBus?: DelayBusTargetId } }).send!.delayBus as DelayBusTargetId)
        : "custom",
      reverbBus: isReverbBusTargetId((track as typeof track & { send?: { reverbBus?: unknown } }).send?.reverbBus)
        ? ((track as typeof track & { send?: { reverbBus?: ReverbBusTargetId } }).send!.reverbBus as ReverbBusTargetId)
        : "custom",
    },
    insertFx: normalizeFxInstances((track as typeof track & { insertFx?: unknown }).insertFx),
  })),
});
