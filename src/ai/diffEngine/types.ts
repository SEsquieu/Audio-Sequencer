import { JsonPatchOp, PatchMeta, SongState } from "../../types/song";

export interface DiffEngineScope {
  selectedTrackId?: string;
  selectedBar?: number;
}

export interface DiffEngineRequest {
  prompt: string;
  song: SongState;
  scope: DiffEngineScope;
  intensity?: number;
  locks?: Record<string, boolean>;
  maxCandidates?: number;
}

export type DiffPlanAction =
  | {
      type: "json_patch";
      ops: JsonPatchOp[];
      label?: string;
      explanation?: string;
      auditionBars?: number[];
    };

export interface DiffPlanCandidate {
  id: string;
  source: "ruleParser" | "smartPatch";
  confidence?: number;
  label?: string;
  explanation?: string;
  actions: DiffPlanAction[];
}

export interface CompiledDiffCandidate {
  patch: PatchMeta;
  source: DiffPlanCandidate["source"];
  confidence: number;
  affectedPaths: string[];
  warnings: string[];
  opCount: number;
}

export interface DiffValidationResult {
  ok: boolean;
  warnings: string[];
  affectedPaths: string[];
  error?: string;
}
