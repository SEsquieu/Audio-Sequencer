import { JsonPatchOp, SongState } from "../types/song";
import { SmartPatchScope } from "./types";

const parsePathTrackIndex = (path: string): number | null => {
  const match = path.match(/^\/tracks\/(\d+)\//);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
};

const parseLaneBarIndex = (path: string): number | null => {
  const match = path.match(/^\/tracks\/\d+\/lane\/(\d+)$/);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
};

export const validateScopeOps = (ops: JsonPatchOp[], scope: SmartPatchScope, song: SongState): boolean => {
  if (scope.kind === "song") {
    return true;
  }

  if (typeof scope.trackIndex !== "number" || scope.trackIndex < 0 || scope.trackIndex >= song.tracks.length) {
    return false;
  }

  for (const op of ops) {
    const opTrackIndex = parsePathTrackIndex(op.path);
    if (opTrackIndex === null || opTrackIndex !== scope.trackIndex) {
      return false;
    }

    if (scope.kind === "bar" && typeof scope.bar === "number") {
      const laneBar = parseLaneBarIndex(op.path);
      if (laneBar !== null && laneBar !== scope.bar) {
        return false;
      }
    }
  }

  return true;
};

