import { applyPatch } from "../../state/patch";
import { SongState } from "../../types/song";
import { CompiledDiffCandidate, DiffValidationResult } from "./types";

const isValidPatchPath = (path: string): boolean => typeof path === "string" && path.startsWith("/") && path.length > 1;

export const validateCompiledDiffCandidate = (
  song: SongState,
  candidate: CompiledDiffCandidate
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

