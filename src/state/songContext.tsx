import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useReducer,
} from "react";
import { JsonPatchOp, PatchMeta, SongState } from "../types/song";
import { createDefaultSong } from "./defaultSong";
import { applyPatch } from "./patch";
import { historyReducer, HistoryState } from "./history";
import { assertSongState, parseProject } from "./project";

interface PersistedSongSnapshot {
  version: 1;
  song: SongState;
}

interface SongContextValue {
  song: SongState;
  committedSong: SongState;
  auditionPatchId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: "saved" | "saving" | "error";
  stateError: string | null;
  commitPatch: (patch: PatchMeta) => void;
  startAudition: (patch: PatchMeta) => void;
  stopAudition: () => void;
  acceptPatch: (patch: PatchMeta) => void;
  undo: () => void;
  redo: () => void;
  resetSong: () => void;
  importSong: (song: SongState) => void;
  applySingleReplace: (path: string, value: unknown, label: string, author?: "user" | "ai") => void;
}

const SongContext = createContext<SongContextValue | undefined>(undefined);

const patchId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const STORAGE_KEY = "audio-sequencer:autosave:v1";

const loadInitial = (): HistoryState => {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedSongSnapshot>;
        if (parsed.version === 1 && parsed.song) {
          return {
            song: parseProject(parsed.song),
            past: [],
            future: [],
            error: null,
          };
        }
      }
    } catch (error) {
      console.warn("[song] Failed to load autosave snapshot", error);
    }
  }
  if (typeof window !== "undefined") {
    try {
      const backup = JSON.parse(window.localStorage.getItem(`${STORAGE_KEY}:backup`) || "null");
      if (backup?.version === 1) return { song: parseProject(backup.song), past: [], future: [], error: "Recovered the previous local snapshot." };
    } catch { /* No valid recovery snapshot. */ }
  }
  return {
    song: createDefaultSong(),
    past: [],
    future: [],
    error: null,
  };
};

export const SongProvider = ({ children }: PropsWithChildren) => {
  const [{ song, past, future, error }, dispatch] = useReducer(historyReducer, undefined, loadInitial);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [stateError, setStateError] = useState<string | null>(null);
  const [previewSong, setPreviewSong] = useState<SongState | null>(null);
  const [auditionPatchId, setAuditionPatchId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setSaveStatus("saving");
    const persist = () => {
      try {
        const snapshot: PersistedSongSnapshot = { version: 1, song };
        const old = window.localStorage.getItem(STORAGE_KEY);
        if (old) {
          try {
            const previous = JSON.parse(old);
            if (previous.version === 1) { parseProject(previous.song); window.localStorage.setItem(`${STORAGE_KEY}:backup`, old); }
          } catch { /* Preserve the last validated backup if current storage is corrupt. */ }
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        setSaveStatus("saved");
      } catch { setSaveStatus("error"); }
    };
    const timer = window.setTimeout(persist, 350);
    const flush = () => persist();
    const onVisibility = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [song]);

  const commitPatch = useCallback((patch: PatchMeta) => {
    setPreviewSong(null);
    setAuditionPatchId(null);
    dispatch({ type: "commit", patch, at: Date.now() });
    setStateError(null);
  }, []);

  const startAudition = useCallback(
    (patch: PatchMeta) => {
      try {
        const next = applyPatch(song, patch.ops);
        assertSongState(next);
        setPreviewSong(next);
        setAuditionPatchId(patch.id);
      } catch { setStateError("This proposal could not be auditioned safely."); }
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
    dispatch({type:"undo"});
    stopAudition();
  }, [stopAudition]);

  const redo = useCallback(() => {
    dispatch({type:"redo"});
    stopAudition();
  }, [stopAudition]);

  const resetSong = useCallback(() => {
    dispatch({type:"load",song:createDefaultSong()});
    stopAudition();
  }, [stopAudition]);

  const importSong = useCallback((nextSong: SongState) => {
    const validated = parseProject(nextSong);
    dispatch({type:"load",song:validated});
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
      saveStatus,
      stateError: stateError ?? error,
      commitPatch,
      startAudition,
      stopAudition,
      acceptPatch,
      undo,
      redo,
      resetSong,
      importSong,
      applySingleReplace,
    }),
    [
      previewSong,
      song,
      auditionPatchId,
      past.length,
      future.length,
      saveStatus,
      stateError,
      error,
      commitPatch,
      startAudition,
      stopAudition,
      acceptPatch,
      undo,
      redo,
      resetSong,
      importSong,
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
