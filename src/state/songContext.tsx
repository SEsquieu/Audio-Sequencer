import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { HistoryEntry, JsonPatchOp, PatchMeta, SongState } from "../types/song";
import { createDefaultSong } from "./defaultSong";
import { applyPatch, invertPatch } from "./patch";

interface PersistedState {
  song: SongState;
  past: HistoryEntry[];
  future: HistoryEntry[];
}

interface SongContextValue {
  song: SongState;
  committedSong: SongState;
  auditionPatchId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  commitPatch: (patch: PatchMeta) => void;
  startAudition: (patch: PatchMeta) => void;
  stopAudition: () => void;
  acceptPatch: (patch: PatchMeta) => void;
  undo: () => void;
  redo: () => void;
  resetSong: () => void;
  applySingleReplace: (path: string, value: unknown, label: string, author?: "user" | "ai") => void;
}

const SongContext = createContext<SongContextValue | undefined>(undefined);

const patchId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const loadInitial = (): PersistedState => {
  return {
    song: createDefaultSong(),
    past: [],
    future: [],
  };
};

export const SongProvider = ({ children }: PropsWithChildren) => {
  const [{ song, past, future }, setState] = useState<PersistedState>(() => loadInitial());
  const [previewSong, setPreviewSong] = useState<SongState | null>(null);
  const [auditionPatchId, setAuditionPatchId] = useState<string | null>(null);

  const commitPatch = useCallback((patch: PatchMeta) => {
    setState((prev) => {
      const inverseOps = invertPatch(prev.song, patch.ops);
      const nextSong = applyPatch(prev.song, patch.ops);
      const entry: HistoryEntry = { patch, inverseOps };
      return {
        song: nextSong,
        past: [...prev.past, entry],
        future: [],
      };
    });
  }, []);

  const startAudition = useCallback(
    (patch: PatchMeta) => {
      setPreviewSong(applyPatch(song, patch.ops));
      setAuditionPatchId(patch.id);
    },
    [song]
  );

  const stopAudition = useCallback(() => {
    setPreviewSong(null);
    setAuditionPatchId(null);
  }, []);

  const acceptPatch = useCallback(
    (patch: PatchMeta) => {
      stopAudition();
      commitPatch(patch);
    },
    [commitPatch, stopAudition]
  );

  const undo = useCallback(() => {
    setState((prev) => {
      const entry = prev.past[prev.past.length - 1];
      if (!entry) {
        return prev;
      }
      const nextSong = applyPatch(prev.song, entry.inverseOps);
      return {
        song: nextSong,
        past: prev.past.slice(0, -1),
        future: [entry, ...prev.future],
      };
    });
    stopAudition();
  }, [stopAudition]);

  const redo = useCallback(() => {
    setState((prev) => {
      const entry = prev.future[0];
      if (!entry) {
        return prev;
      }
      const nextSong = applyPatch(prev.song, entry.patch.ops);
      return {
        song: nextSong,
        past: [...prev.past, entry],
        future: prev.future.slice(1),
      };
    });
    stopAudition();
  }, [stopAudition]);

  const resetSong = useCallback(() => {
    setState({
      song: createDefaultSong(),
      past: [],
      future: [],
    });
    stopAudition();
  }, [stopAudition]);

  const applySingleReplace = useCallback(
    (path: string, value: unknown, label: string, author: "user" | "ai" = "user") => {
      const ops: JsonPatchOp[] = [{ op: "replace", path, value }];
      commitPatch({
        id: patchId(),
        author,
        label,
        explanation: label,
        ops,
      });
    },
    [commitPatch]
  );

  const value = useMemo<SongContextValue>(
    () => ({
      song: previewSong ?? song,
      committedSong: song,
      auditionPatchId,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      commitPatch,
      startAudition,
      stopAudition,
      acceptPatch,
      undo,
      redo,
      resetSong,
      applySingleReplace,
    }),
    [
      previewSong,
      song,
      auditionPatchId,
      past.length,
      future.length,
      commitPatch,
      startAudition,
      stopAudition,
      acceptPatch,
      undo,
      redo,
      resetSong,
      applySingleReplace,
    ]
  );

  return <SongContext.Provider value={value}>{children}</SongContext.Provider>;
};

export const useSong = (): SongContextValue => {
  const context = useContext(SongContext);
  if (!context) {
    throw new Error("useSong must be used inside SongProvider");
  }
  return context;
};
