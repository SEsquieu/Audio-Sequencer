import { applyPatch } from "../../state/patch";
import { SongState } from "../../types/song";
import { CompiledDiffCandidate, DiffValidationResult } from "./types";

const isValidPatchPath = (path: string): boolean => typeof path === "string" && path.startsWith("/") && path.length > 1;

const pathTouchesDrumTrack = (song: SongState, path: string): boolean => {
  const match = path.match(/^\/tracks\/(\d+)\b/);
  if (!match) {
    return false;
  }
  const track = song.tracks[Number(match[1])];
  return track?.type === "drums";
};

const violatesLocks = (song: SongState, path: string, locks?: Record<string, boolean>): string | null => {
  if (!locks) {
    return null;
  }

  if ((locks.timing || locks.rhythm) && (/^\/tempo$/.test(path) || /^\/swing$/.test(path))) {
    return "timing";
  }
  if ((locks.arrangement || locks.structure) && (/^\/tracks\/\d+\/lane\//.test(path) || /^\/tracks\/\d+\/patterns\//.test(path))) {
    return "arrangement";
  }
  if (locks.drums && pathTouchesDrumTrack(song, path)) {
    return "drums";
  }
  if (
    (locks.tone || locks.sound) &&
    (/^\/tracks\/\d+\/instrument\//.test(path) ||
      /^\/tracks\/\d+\/insertFx\//.test(path) ||
      /^\/masterFx\//.test(path) ||
      /^\/masterSafety\//.test(path))
  ) {
    return "sound";
  }
  if (
    (locks.routing || locks.fx) &&
    (/^\/tracks\/\d+\/send\//.test(path) || /^\/sendFx\//.test(path))
  ) {
    return "routing";
  }
  if (
    locks.melody &&
    /^\/tracks\/\d+\/patterns\/[^/]+\/steps\/\d+\/\d+\/pitch$/.test(path)
  ) {
    return "melody";
  }
  if (
    locks.rhythm &&
    (/^\/tracks\/\d+\/patterns\/[^/]+\/steps\/\d+\/(kick|snare|hat)$/.test(path) ||
      /^\/tracks\/\d+\/patterns\/[^/]+\/steps\/\d+\/\d+\/length$/.test(path))
  ) {
    return "rhythm";
  }

  return null;
};

export const validateCompiledDiffCandidate = (
  song: SongState,
  candidate: CompiledDiffCandidate,
  locks?: Record<string, boolean>
): DiffValidationResult => {
  const warnings: string[] = [];

  if (candidate.patch.ops.length === 0) {
    return { ok: false, warnings, affectedPaths: [], error: "Empty patch" };
  }

  for (const op of candidate.patch.ops) {
    if (!isValidPatchPath(op.path)) {
      return {
        ok: false,
        warnings,
        affectedPaths: candidate.affectedPaths,
        error: `Invalid patch path: ${op.path}`,
      };
    }
    const lockViolation = violatesLocks(song, op.path, locks);
    if (lockViolation) {
      return {
        ok: false,
        warnings,
        affectedPaths: candidate.affectedPaths,
        error: `Blocked by ${lockViolation} lock`,
      };
    }
  }

  if (candidate.patch.ops.length > 64) {
    warnings.push("Large patch candidate");
  }

  try {
    applyPatch(song, candidate.patch.ops);
  } catch (error) {
    return {
      ok: false,
      warnings,
      affectedPaths: candidate.affectedPaths,
      error: error instanceof Error ? error.message : "Patch simulation failed",
    };
  }

  return {
    ok: true,
    warnings,
    affectedPaths: candidate.affectedPaths,
  };
};
