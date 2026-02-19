import { SongState } from "../types/song";
import { normalizeInstrumentParams } from "./instrumentDefaults";

export const normalizeSongState = (song: SongState): SongState => ({
  ...song,
  tracks: song.tracks.map((track) => ({
    ...track,
    instrument: normalizeInstrumentParams(track.type, track.instrument),
  })),
});

