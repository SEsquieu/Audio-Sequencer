import { SongState } from "../types/song";
import { InstrumentEngine } from "./instrumentEngine";
import { normalizeSynthCell } from "./songModel";

export interface ScheduledTick {
  bar: number;
  step: number;
  when: number;
}

export const scheduleSongStep = (
  song: SongState,
  tick: ScheduledTick,
  mutedTrackIds: ReadonlySet<string>,
  instrumentEngine: InstrumentEngine
): void => {
  for (const track of song.tracks) {
    if (mutedTrackIds.has(track.id)) {
      continue;
    }
    const patternId = track.lane[tick.bar] ?? track.lane[0];
    const pattern = track.patterns[patternId];
    if (!pattern) {
      continue;
    }

    if (track.type === "synth" && pattern.type === "synth") {
      const notes = normalizeSynthCell(pattern.steps[tick.step]);
      for (const note of notes) {
        instrumentEngine.playSynthNote(
          track,
          note.pitch,
          note.velocity,
          note.length,
          tick.when,
          song.tempo
        );
      }
    }

    if (track.type === "drums" && pattern.type === "drums") {
      const hit = pattern.steps[tick.step];
      if (hit.kick > 0) {
        instrumentEngine.playKick(track, tick.when, hit.kick);
      }
      if (hit.snare > 0) {
        instrumentEngine.playSnare(track, tick.when, hit.snare);
      }
      if (hit.hat > 0) {
        instrumentEngine.playHat(track, tick.when, hit.hat);
      }
    }
  }
};
