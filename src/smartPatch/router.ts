import { SongState } from "../types/song";
import { SmartPatchIntent, SmartPatchRuntimeContext } from "./types";

const resolveSelectedTrackIndex = (song: SongState, selectedTrackId?: string): number => {
  if (!selectedTrackId) {
    return 0;
  }
  const idx = song.tracks.findIndex((t) => t.id === selectedTrackId);
  return idx >= 0 ? idx : 0;
};

export const promptToIntents = (
  prompt: string,
  ctx: SmartPatchRuntimeContext,
  intensity = 0.5
): SmartPatchIntent[] => {
  const text = prompt.toLowerCase();
  const intents: SmartPatchIntent[] = [];
  const { song, locks } = ctx;

  const drumsIndex = song.tracks.findIndex((t) => t.type === "drums");
  const synthIndex = song.tracks.findIndex((t) => t.type === "synth");

  if (text.includes("punch") && drumsIndex >= 0 && !locks?.drums) {
    intents.push({
      action: "punchier_drums",
      intensity,
      scope: { kind: "track", trackIndex: drumsIndex },
    });
  }

  if (text.includes("lofi") && synthIndex >= 0 && !locks?.tone) {
    intents.push({
      action: "lofi_tone",
      intensity,
      scope: { kind: "track", trackIndex: synthIndex },
    });
  }

  if (text.includes("swing") && !locks?.timing) {
    intents.push({
      action: "add_swing",
      intensity,
      scope: { kind: "song" },
    });
  }

  if (text.includes("variation") && synthIndex >= 0 && !locks?.arrangement) {
    const targetBar = Math.min(song.bars - 1, Math.max(8, ctx.selectedBar ?? song.bars - 1));
    intents.push({
      action: "add_variation",
      intensity,
      scope: { kind: "bar", trackIndex: synthIndex, bar: targetBar },
    });
  }

  if (intents.length === 0 && song.tracks.length > 0) {
    intents.push({
      action: "gentle_lift",
      intensity,
      scope: { kind: "track", trackIndex: resolveSelectedTrackIndex(song, ctx.selectedTrackId) },
    });
  }

  return intents;
};

