import { SongState } from "../types/song";
import { normalizeInstrumentParams } from "./instrumentDefaults";
import { FxInstance, FxType, defaultFxParams } from "../audio/fx/types";

const isFxType = (value: unknown): value is FxType => value === "saturator" || value === "eq3";

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
    },
    insertFx: normalizeFxInstances((track as typeof track & { insertFx?: unknown }).insertFx),
  })),
});
