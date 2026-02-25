import { PatchMeta, SongState } from "../types/song";
import { proposeDiffPatchCandidates } from "./diffEngine/engine";

export interface AiScope {
  selectedTrackId?: string;
  selectedBar?: number;
}

export const aiProposePatch = (
  prompt: string,
  song: SongState,
  scope: AiScope,
  intensity = 0.5,
  locks?: { [key: string]: boolean }
): PatchMeta[] => {
  return proposeDiffPatchCandidates({
    prompt,
    song,
    scope,
    intensity,
    locks,
    maxCandidates: 3,
  });
};
