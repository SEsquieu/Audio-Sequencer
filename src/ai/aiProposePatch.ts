import { PatchMeta, SongState } from "../types/song";
import { generateSmartPatchCandidates } from "../smartPatch/engine";
import { promptToIntents } from "../smartPatch/router";

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
  const intents = promptToIntents(
    prompt,
    {
      song,
      selectedTrackId: scope.selectedTrackId,
      selectedBar: scope.selectedBar,
      locks,
    },
    intensity
  );
  return generateSmartPatchCandidates(
    song,
    intents,
    {
      selectedTrackId: scope.selectedTrackId,
      selectedBar: scope.selectedBar,
      locks,
    },
    3
  );
};
