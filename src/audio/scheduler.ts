import { SongState } from "../types/song";
import { InstrumentEngine } from "./instrumentEngine";
import { normalizeSynthCell } from "./songModel";

export interface ScheduledTick {
  bar: number;
  step: number;
  when: number;
}

type ScheduledStepEvent =
  | {
      type: "synthNote";
      trackIndex: number;
      trackId: string;
      pitch: number;
      velocity: number;
      length: number;
      tempo: number;
      when: number;
    }
  | {
      type: "drumHit";
      trackIndex: number;
      trackId: string;
      lane: "kick" | "snare" | "hat";
      velocity: number;
      when: number;
    };

const drumLaneOrder: Record<"kick" | "snare" | "hat", number> = {
  kick: 0,
  snare: 1,
  hat: 2,
};

const eventSortKey = (event: ScheduledStepEvent): [number, number, number] => {
  if (event.type === "synthNote") {
    return [event.trackIndex, 0, -event.pitch];
  }
  return [event.trackIndex, 1, drumLaneOrder[event.lane]];
};

const compareEvents = (a: ScheduledStepEvent, b: ScheduledStepEvent): number => {
  const aKey = eventSortKey(a);
  const bKey = eventSortKey(b);
  if (aKey[0] !== bKey[0]) {
    return aKey[0] - bKey[0];
  }
  if (aKey[1] !== bKey[1]) {
    return aKey[1] - bKey[1];
  }
  return aKey[2] - bKey[2];
};

export const scheduleSongStep = (
  song: SongState,
  tick: ScheduledTick,
  mutedTrackIds: ReadonlySet<string>,
  instrumentEngine: InstrumentEngine
): void => {
  const events: ScheduledStepEvent[] = [];

  for (const [trackIndex, track] of song.tracks.entries()) {
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
        events.push({
          type: "synthNote",
          trackIndex,
          trackId: track.id,
          pitch: note.pitch,
          velocity: note.velocity,
          length: note.length,
          tempo: song.tempo,
          when: tick.when,
        });
      }
    }

    if (track.type === "drums" && pattern.type === "drums") {
      const hit = pattern.steps[tick.step];
      if (hit.kick > 0) {
        events.push({
          type: "drumHit",
          trackIndex,
          trackId: track.id,
          lane: "kick",
          velocity: hit.kick,
          when: tick.when,
        });
      }
      if (hit.snare > 0) {
        events.push({
          type: "drumHit",
          trackIndex,
          trackId: track.id,
          lane: "snare",
          velocity: hit.snare,
          when: tick.when,
        });
      }
      if (hit.hat > 0) {
        events.push({
          type: "drumHit",
          trackIndex,
          trackId: track.id,
          lane: "hat",
          velocity: hit.hat,
          when: tick.when,
        });
      }
    }
  }

  events.sort(compareEvents);

  for (const event of events) {
    const track = song.tracks[event.trackIndex];
    if (!track || track.id !== event.trackId) {
      continue;
    }
    if (event.type === "synthNote") {
      instrumentEngine.playSynthNote(
        track,
        event.pitch,
        event.velocity,
        event.length,
        event.when,
        event.tempo
      );
      continue;
    }
    if (event.lane === "kick") {
      instrumentEngine.playKick(track, event.when, event.velocity);
    } else if (event.lane === "snare") {
      instrumentEngine.playSnare(track, event.when, event.velocity);
    } else {
      instrumentEngine.playHat(track, event.when, event.velocity);
    }
  }
};
