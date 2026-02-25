import { PatchMeta, SongState } from "../types/song";
import {
  proposeDiffPatchCandidates,
  proposeDiffPatchCandidatesAsync,
  proposeDiffPatchCandidatesAsyncDetailed,
} from "./diffEngine/engine";
import { DiffEngineDiagnostics } from "./diffEngine/types";

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

export const aiProposePatchAsync = async (
  prompt: string,
  song: SongState,
  scope: AiScope,
  intensity = 0.5,
  locks?: { [key: string]: boolean },
  options?: { isPlaying?: boolean; preferOffline?: boolean; providerPreference?: string | "auto" }
): Promise<PatchMeta[]> => {
  return proposeDiffPatchCandidatesAsync({
    prompt,
    song,
    scope,
    intensity,
    locks,
    maxCandidates: 3,
    isPlaying: options?.isPlaying,
    preferOffline: options?.preferOffline,
    providerPreference: options?.providerPreference,
  });
};

export interface AiProposalResult {
  patches: PatchMeta[];
  diagnostics: DiffEngineDiagnostics;
}

export const aiProposePatchDetailedAsync = async (
  prompt: string,
  song: SongState,
  scope: AiScope,
  intensity = 0.5,
  locks?: { [key: string]: boolean },
  options?: { isPlaying?: boolean; preferOffline?: boolean; providerPreference?: string | "auto"; signal?: AbortSignal; timeoutMs?: number }
): Promise<AiProposalResult> => {
  return proposeDiffPatchCandidatesAsyncDetailed({
    prompt,
    song,
    scope,
    intensity,
    locks,
    maxCandidates: 3,
    isPlaying: options?.isPlaying,
    preferOffline: options?.preferOffline,
    providerPreference: options?.providerPreference,
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
  });
};
