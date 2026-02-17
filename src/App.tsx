import {
  CSSProperties,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { aiProposePatch } from "./ai/aiProposePatch";
import { AudioEngine, getEffectiveLoopBars } from "./audio/engine";
import { AdsrEnvelopeEditor } from "./components/AdsrEnvelopeEditor";
import { FilterEqPad } from "./components/FilterEqPad";
import { SynthModPads } from "./components/SynthModPads";
import { getMatchingPresetId, getPresetsForType } from "./state/instrumentPresets";
import { useSong } from "./state/songContext";
import { JsonPatchOp, PatchMeta, SongState, SynthStep, Track, TrackType, WaveformType } from "./types/song";

const MIN_OCTAVE_BASE = 24;
const MAX_OCTAVE_BASE = 96;
const MIN_VISIBLE_PITCH = 24; // C1
const MAX_VISIBLE_PITCH = 107; // B7
const DEFAULT_OCTAVE_BASE = 60;
const BASS_OCTAVE_BASE = 36;
const OCTAVE_SCRUB_STEP_PX = 16;
const OCTAVE_TRANSITION_MS = 180;
const TIMELINE_LABEL_REM = 6;
const TIMELINE_ROW_GAP_REM = 0.45;
const TIMELINE_BAR_INNER_PAD_REM = 0.2;
const TIMELINE_BAR_WIDTH_REM = 2.15;
const TIMELINE_BAR_GAP_REM = 0.3;

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const deepClone = <T,>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const getPitchClass = (pitch: number) => ((pitch % 12) + 12) % 12;
const isBlackKey = (pitch: number) => [1, 3, 6, 8, 10].includes(getPitchClass(pitch));
const toNoteName = (pitch: number) => noteNames[getPitchClass(pitch)];
const toNoteWithOctave = (pitch: number) => `${toNoteName(pitch)}${Math.floor(pitch / 12) - 1}`;
const isPitchInEditableRange = (pitch: number) => pitch >= MIN_VISIBLE_PITCH && pitch <= MAX_VISIBLE_PITCH;

const normalizeSynthCell = (cell: unknown): SynthStep[] => {
  if (!cell) {
    return [];
  }
  if (Array.isArray(cell)) {
    return cell.filter(
      (n): n is SynthStep =>
        typeof n === "object" &&
        n !== null &&
        typeof (n as SynthStep).pitch === "number" &&
        typeof (n as SynthStep).length === "number" &&
        typeof (n as SynthStep).velocity === "number"
    );
  }
  if (
    typeof cell === "object" &&
    typeof (cell as SynthStep).pitch === "number" &&
    typeof (cell as SynthStep).length === "number" &&
    typeof (cell as SynthStep).velocity === "number"
  ) {
    return [cell as SynthStep];
  }
  return [];
};

const nextPatternIdFromRecord = (patterns: Record<string, unknown>): string => {
  const maxId = Object.keys(patterns).reduce((max, id) => {
    const n = Number(id);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return String(maxId + 1);
};

const createEmptySynthSteps = (): SynthStep[][] => Array.from({ length: 16 }, () => []);
const createEmptyDrumSteps = () => Array.from({ length: 16 }, () => ({ kick: 0, snare: 0, hat: 0 }));
type SynthStepVisual = "off" | "single" | "start" | "middle" | "end";
type NumericInstrumentKey = Exclude<keyof Track["instrument"], "oscWaveformA" | "oscWaveformB">;

const findPreviousOverlappingStart = (steps: SynthStep[][], pitch: number, startStep: number): number | null => {
  for (let step = startStep - 1; step >= 0; step -= 1) {
    const note = normalizeSynthCell(steps[step]).find((n) => n.pitch === pitch);
    if (!note) {
      continue;
    }
    if (step + Math.max(1, note.length) > startStep) {
      return step;
    }
    return null;
  }
  return null;
};

const getSynthStepVisual = (steps: SynthStep[][], pitch: number, stepIndex: number): SynthStepVisual => {
  for (let start = stepIndex; start >= 0; start -= 1) {
    const note = normalizeSynthCell(steps[start]).find((n) => n.pitch === pitch);
    if (!note) {
      continue;
    }
    const end = Math.min(15, start + Math.max(1, note.length) - 1);
    if (stepIndex < start || stepIndex > end) {
      continue;
    }
    if (start === end) {
      return "single";
    }
    if (stepIndex === start) {
      return "start";
    }
    if (stepIndex === end) {
      return "end";
    }
    return "middle";
  }
  return "off";
};

const getDefaultOctaveForTrack = (track?: Track): number => {
  if (!track || track.type !== "synth") {
    return DEFAULT_OCTAVE_BASE;
  }
  if (track.id.includes("bass") || track.name.toLowerCase().includes("bass")) {
    return BASS_OCTAVE_BASE;
  }
  return DEFAULT_OCTAVE_BASE;
};

const buildDefaultInstrument = (type: TrackType): Track["instrument"] =>
  type === "synth"
    ? {
        attack: 0.01,
        decay: 0.18,
        sustain: 0.5,
        release: 0.22,
        cutoff: 2200,
        resonance: 1,
        gain: 0.45,
        lofiAmount: 0,
        detune: 6,
        drive: 0.12,
        vibratoRate: 5.5,
        vibratoDepth: 8,
        oscWaveformA: "sawtooth",
        oscWaveformB: "square",
        oscMix: 0.5,
      }
    : {
        attack: 0.001,
        decay: 0.12,
        sustain: 0,
        release: 0.06,
        cutoff: 8000,
        resonance: 0.2,
        gain: 0.7,
        lofiAmount: 0,
        detune: 0,
        drive: 0.08,
        vibratoRate: 0,
        vibratoDepth: 0,
        oscWaveformA: "triangle",
        oscWaveformB: "triangle",
        oscMix: 0.5,
      };

interface SynthDragState {
  startStep: number;
  endStep: number;
  pitch: number;
  moved: boolean;
  startClientX: number;
  cellWidth: number;
}

interface LoopRange {
  start: number;
  end: number;
}

interface LoopDragState {
  anchor: number;
  moved: boolean;
}

interface OctaveScrubState {
  pointerId: number;
  startY: number;
  startBase: number;
  lastStepDelta: number;
}

function App() {
  const {
    song,
    committedSong,
    auditionPatchId,
    canUndo,
    canRedo,
    commitPatch,
    startAudition,
    stopAudition,
    acceptPatch,
    undo,
    redo,
    resetSong,
    applySingleReplace,
  } = useSong();

  const [selectedTrack, setSelectedTrack] = useState(0);
  const [selectedBar, setSelectedBar] = useState(0);
  const [lockToActive, setLockToActive] = useState(false);
  const [mutedTrackIds, setMutedTrackIds] = useState<string[]>([]);
  const [loopRange, setLoopRange] = useState<LoopRange | null>(null);
  const [loopDrag, setLoopDrag] = useState<LoopDragState | null>(null);
  const [playhead, setPlayhead] = useState({ bar: 0, step: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [synthDrag, setSynthDrag] = useState<SynthDragState | null>(null);
  const [adsrOpen, setAdsrOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [modOpen, setModOpen] = useState(false);
  const [oscOpen, setOscOpen] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [isSoundOpen, setIsSoundOpen] = useState(false);
  const [octaveBase, setOctaveBase] = useState(DEFAULT_OCTAVE_BASE);
  const [octaveScrubOffsetPx, setOctaveScrubOffsetPx] = useState(0);
  const [octaveTransition, setOctaveTransition] = useState<{
    from: number;
    to: number;
    direction: 1 | -1;
    running: boolean;
  } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [candidates, setCandidates] = useState<PatchMeta[]>([]);
  const [trackOctaves, setTrackOctaves] = useState<Record<string, number>>({});

  const engineRef = useRef<AudioEngine | null>(null);
  const songRef = useRef<SongState>(song);
  const octaveScrubRef = useRef<OctaveScrubState | null>(null);
  const octaveTransitionTimerRef = useRef<number | null>(null);
  const suppressBarClickRef = useRef(false);
  const activeSynthPointerIdRef = useRef<number | null>(null);
  const timelineRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const syncingTimelineScrollRef = useRef(false);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);

  useEffect(() => {
    songRef.current = song;
  }, [song]);

  useEffect(() => {
    if (!engineRef.current) {
      const engine = new AudioEngine();
      engine.onTick((info) => setPlayhead(info));
      engine.setMasterVolume(masterVolume);
      engineRef.current = engine;
    }
  }, [masterVolume]);

  useEffect(() => {
    engineRef.current?.setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    engineRef.current?.setMutedTrackIds(mutedTrackIds);
  }, [mutedTrackIds]);

  useEffect(() => {
    if (!import.meta.env.DEV || !isPlaying) {
      return;
    }
    const timerId = window.setInterval(() => {
      const diagnostics = engineRef.current?.getTimingDiagnostics();
      if (!diagnostics) {
        return;
      }
      const msg = [
        "[audio-timing]",
        `policy=${diagnostics.liveEditPolicy}`,
        `steps=${diagnostics.scheduledSteps}`,
        `lookaheadMs=${diagnostics.lookaheadMs.toFixed(1)}`,
        `aheadMs=${diagnostics.scheduleAheadTimeMs.toFixed(1)}`,
        `wakeLateMs=${diagnostics.schedulerWakeLateMs.toFixed(2)}`,
        `wakeLateMaxMs=${diagnostics.schedulerWakeLateMaxMs.toFixed(2)}`,
        `stepErrMs=${diagnostics.observedStepIntervalErrorMs.toFixed(3)}`,
        `stepErrMaxMs=${diagnostics.observedStepIntervalErrorMaxMs.toFixed(3)}`,
        `voiceSteals=${diagnostics.synthVoiceSteals}`,
      ].join(" ");
      console.info(msg);
    }, 2000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isPlaying]);

  useEffect(() => {
    if (!lockToActive) {
      return;
    }
    const activeBar = Math.max(0, Math.min(song.bars - 1, playhead.bar));
    if (selectedBar !== activeBar) {
      setSelectedBar(activeBar);
    }
  }, [lockToActive, playhead.bar, selectedBar, song.bars]);

  useEffect(() => {
    setLoopRange((prev) => {
      if (!prev) {
        return prev;
      }
      const maxBar = Math.max(0, song.bars - 1);
      const nextStart = Math.max(0, Math.min(prev.start, maxBar));
      const nextEnd = Math.max(nextStart, Math.min(prev.end, maxBar));
      if (nextStart === prev.start && nextEnd === prev.end) {
        return prev;
      }
      return { start: nextStart, end: nextEnd };
    });
  }, [song.bars]);

  useEffect(() => {
    if (!engineRef.current) {
      return;
    }
    if (loopRange === null) {
      engineRef.current.setLoopRange(null);
      return;
    }
    engineRef.current.setLoopRange(loopRange.start, loopRange.end);
  }, [loopRange]);

  const safeTrackIndex = Math.min(selectedTrack, Math.max(0, song.tracks.length - 1));
  const track = song.tracks[safeTrackIndex] ?? song.tracks[0];
  const patternId = track?.lane[selectedBar] ?? track?.lane[0];
  const pattern = patternId ? track?.patterns[patternId] : undefined;
  const playheadPatternId = track?.lane[playhead.bar] ?? track?.lane[0];
  const isEditorStepTrackingActive =
    Boolean(patternId) && patternId !== "0" && patternId === playheadPatternId;
  const synthPatternSteps =
    track?.type === "synth" && pattern?.type === "synth" ? pattern.steps : createEmptySynthSteps();
  const drumPatternSteps =
    track?.type === "drums" && pattern?.type === "drums" ? pattern.steps : createEmptyDrumSteps();

  const barOptions = useMemo(() => Array.from({ length: song.bars }, (_, i) => i), [song.bars]);
  const trackPatternIds = useMemo(() => {
    if (!track) {
      return [];
    }
    return Object.keys(track.patterns).sort((a, b) => Number(a) - Number(b));
  }, [track]);
  const patternSelectValue = patternId && track?.patterns[patternId] ? patternId : "__unassigned";
  const effectiveLoopBars = useMemo(() => getEffectiveLoopBars(song), [song]);
  const loopRangeStart = loopRange?.start ?? 0;
  const loopRangeBars =
    loopRange !== null
      ? Math.max(1, loopRange.end - loopRange.start + 1)
      : Math.max(1, Math.min(song.bars, effectiveLoopBars));
  const loopRegionLeftPercent = (loopRangeStart / song.bars) * 100;
  const loopRegionPercent = (loopRangeBars / song.bars) * 100;
  const loopStepsTotal = Math.max(1, loopRangeBars * 16);
  const loopRelativeStep = (playhead.bar - loopRangeStart) * 16 + playhead.step;
  const loopRelativeBars = Math.max(0, Math.min(loopStepsTotal - 1, loopRelativeStep)) / 16;
  const globalSweepLeftRem =
    TIMELINE_LABEL_REM +
    TIMELINE_ROW_GAP_REM +
    TIMELINE_BAR_INNER_PAD_REM +
    (loopRangeStart + loopRelativeBars) * (TIMELINE_BAR_WIDTH_REM + TIMELINE_BAR_GAP_REM);
  const availablePresets = useMemo(() => (track ? getPresetsForType(track.type) : []), [track]);
  const selectedPresetId = useMemo(
    () => (track ? getMatchingPresetId(track.type, track.instrument) : null),
    [track]
  );
  const buildPitchRows = useCallback((base: number) => {
    const rows: Array<{ pitch: number; ghost: boolean; inRange: boolean }> = [];
    for (let pitch = base + 13; pitch >= base + 12; pitch -= 1) {
      rows.push({ pitch, ghost: true, inRange: isPitchInEditableRange(pitch) });
    }
    for (let pitch = base + 11; pitch >= base; pitch -= 1) {
      rows.push({ pitch, ghost: false, inRange: isPitchInEditableRange(pitch) });
    }
    for (let pitch = base - 1; pitch >= base - 2; pitch -= 1) {
      rows.push({ pitch, ghost: true, inRange: isPitchInEditableRange(pitch) });
    }
    return rows;
  }, []);
  const pitchRows = useMemo(() => buildPitchRows(octaveBase), [octaveBase, buildPitchRows]);
  const editorSweepStyle = useMemo(
    () => ({ "--play-step": playhead.step } as CSSProperties),
    [playhead.step]
  );

  useEffect(() => {
    if (!track || track.type !== "synth") {
      return;
    }
    const preferred = trackOctaves[track.id] ?? getDefaultOctaveForTrack(track);
    if (preferred !== octaveBase) {
      setOctaveBase(preferred);
    }
  }, [octaveBase, track, trackOctaves]);

  useEffect(() => {
    if (!track) {
      setIsSoundOpen(false);
    }
  }, [track]);

  useEffect(() => {
    if (!track || track.type !== "synth") {
      setOctaveScrubOffsetPx(0);
    }
  }, [track]);

  useEffect(() => {
    return () => {
      if (octaveTransitionTimerRef.current !== null) {
        window.clearTimeout(octaveTransitionTimerRef.current);
      }
    };
  }, []);

  const onPlay = useCallback(async () => {
    if (!engineRef.current) {
      return;
    }
    if (engineRef.current.playing) {
      return;
    }
    await engineRef.current.play(() => songRef.current);
    setIsPlaying(true);
  }, []);

  const syncTimelineScroll = useCallback((sourceIndex: number, scrollLeft: number) => {
    if (syncingTimelineScrollRef.current) {
      return;
    }
    syncingTimelineScrollRef.current = true;
    setTimelineScrollLeft(scrollLeft);
    timelineRowRefs.current.forEach((el, idx) => {
      if (!el || idx === sourceIndex) {
        return;
      }
      if (Math.abs(el.scrollLeft - scrollLeft) > 0.5) {
        el.scrollLeft = scrollLeft;
      }
    });
    syncingTimelineScrollRef.current = false;
  }, []);

  useEffect(() => {
    timelineRowRefs.current.forEach((el) => {
      if (!el) {
        return;
      }
      if (Math.abs(el.scrollLeft - timelineScrollLeft) > 0.5) {
        el.scrollLeft = timelineScrollLeft;
      }
    });
  }, [song.tracks.length, timelineScrollLeft]);

  const onPause = useCallback(() => {
    if (!engineRef.current || !engineRef.current.playing) {
      return;
    }
    engineRef.current.pause();
    setIsPlaying(false);
  }, []);

  const onStop = useCallback(() => {
    if (!engineRef.current) {
      return;
    }
    engineRef.current.stop();
    setIsPlaying(false);
  }, []);

  const toggleTrackMute = (trackId: string) => {
    setMutedTrackIds((prev) =>
      prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId]
    );
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }

      event.preventDefault();
      if (isPlaying) {
        onPause();
      } else {
        void onPlay();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying, onPause, onPlay]);

  const createAndCommit = (label: string, ops: JsonPatchOp[]) => {
    commitPatch({
      id: uid(),
      author: "user",
      label,
      explanation: label,
      ops,
    });
  };

  const onTempoChange = (value: number) => {
    applySingleReplace("/tempo", value, "Change Tempo");
  };

  const onToggleSynthCell = (stepIndex: number, pitch: number) => {
    if (!track || track.type !== "synth" || !patternId || !isPitchInEditableRange(pitch)) {
      return;
    }

    const isUnassigned = patternId === "0" || !pattern || pattern.type !== "synth";
    const targetPatternId = isUnassigned ? nextPatternIdFromRecord(track.patterns) : patternId;
    const sourceSteps = isUnassigned ? createEmptySynthSteps() : pattern.steps;

    const current = normalizeSynthCell(sourceSteps[stepIndex]);
    const hasPitch = current.some((note) => note.pitch === pitch);
    if (!hasPitch && current.length >= 4) {
      return;
    }
    const nextValue = hasPitch
      ? current.filter((note) => note.pitch !== pitch)
      : [...current, { pitch, velocity: 0.9, length: 1 }].sort((a, b) => b.pitch - a.pitch);

    const ops: JsonPatchOp[] = [];
    if (isUnassigned) {
      ops.push(
        {
          op: "add",
          path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}`,
          value: {
            type: "synth",
            steps: sourceSteps,
          },
        },
        {
          op: "replace",
          path: `/tracks/${safeTrackIndex}/lane/${selectedBar}`,
          value: targetPatternId,
        }
      );
    }

    if (!hasPitch) {
      const overlapStart = findPreviousOverlappingStart(sourceSteps, pitch, stepIndex);
      if (overlapStart !== null) {
        const overlapNotes = normalizeSynthCell(sourceSteps[overlapStart]);
        const clippedLength = Math.max(1, stepIndex - overlapStart);
        const nextOverlapNotes = overlapNotes.map((note) =>
          note.pitch === pitch ? { ...note, length: clippedLength } : note
        );
        ops.push({
          op: "replace",
          path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}/steps/${overlapStart}`,
          value: nextOverlapNotes,
        });
      }
    }

    ops.push({
      op: "replace",
      path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}/steps/${stepIndex}`,
      value: nextValue,
    });

    createAndCommit("Edit Synth Step", ops);
  };

  const onSetSynthNoteLength = (startStep: number, endStep: number, pitch: number) => {
    if (!track || track.type !== "synth" || !patternId || !isPitchInEditableRange(pitch)) {
      return;
    }

    const normalizedEnd = Math.max(startStep, Math.min(15, endStep));
    const length = normalizedEnd - startStep + 1;
    const isUnassigned = patternId === "0" || !pattern || pattern.type !== "synth";
    const targetPatternId = isUnassigned ? nextPatternIdFromRecord(track.patterns) : patternId;
    const sourceSteps = isUnassigned ? createEmptySynthSteps() : pattern.steps;

    const startNotes = normalizeSynthCell(sourceSteps[startStep]);
    const existing = startNotes.find((note) => note.pitch === pitch);
    const withoutPitch = startNotes.filter((note) => note.pitch !== pitch);
    if (!existing && withoutPitch.length >= 4) {
      return;
    }

    const nextStartNotes = [
      ...withoutPitch,
      existing
        ? { ...existing, length }
        : {
            pitch,
            velocity: 0.9,
            length,
          },
    ].sort((a, b) => b.pitch - a.pitch);

    const ops: JsonPatchOp[] = [];
    if (isUnassigned) {
      ops.push(
        {
          op: "add",
          path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}`,
          value: {
            type: "synth",
            steps: sourceSteps,
          },
        },
        {
          op: "replace",
          path: `/tracks/${safeTrackIndex}/lane/${selectedBar}`,
          value: targetPatternId,
        }
      );
    }

    const overlapStart = findPreviousOverlappingStart(sourceSteps, pitch, startStep);
    if (overlapStart !== null) {
      const overlapNotes = normalizeSynthCell(sourceSteps[overlapStart]);
      const clippedLength = Math.max(1, startStep - overlapStart);
      const nextOverlapNotes = overlapNotes.map((note) =>
        note.pitch === pitch ? { ...note, length: clippedLength } : note
      );
      ops.push({
        op: "replace",
        path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}/steps/${overlapStart}`,
        value: nextOverlapNotes,
      });
    }

    ops.push({
      op: "replace",
      path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}/steps/${startStep}`,
      value: nextStartNotes,
    });

    for (let step = startStep + 1; step <= normalizedEnd; step += 1) {
      const notes = normalizeSynthCell(sourceSteps[step]);
      if (!notes.some((note) => note.pitch === pitch)) {
        continue;
      }
      ops.push({
        op: "replace",
        path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}/steps/${step}`,
        value: notes.filter((note) => note.pitch !== pitch),
      });
    }

    createAndCommit("Extend Synth Note", ops);
  };

  const onSynthPointerDown = (stepIndex: number, pitch: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (
      (event.pointerType === "mouse" && event.button !== 0) ||
      !track ||
      track.type !== "synth" ||
      !isPitchInEditableRange(pitch)
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeSynthPointerIdRef.current = event.pointerId;
    const cellRect = event.currentTarget.getBoundingClientRect();
    setSynthDrag({
      startStep: stepIndex,
      endStep: stepIndex,
      pitch,
      moved: false,
      startClientX: event.clientX,
      cellWidth: Math.max(1, cellRect.width),
    });
  };

  const onSynthPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!synthDrag) {
      return;
    }
    if (activeSynthPointerIdRef.current !== event.pointerId) {
      return;
    }
    if (event.pointerType === "mouse" && (event.buttons & 1) !== 1) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - synthDrag.startClientX;
    const stepDelta = Math.round(deltaX / synthDrag.cellWidth);
    const stepIndex = Math.max(0, Math.min(15, synthDrag.startStep + stepDelta));

    setSynthDrag((prev) => {
      if (!prev || prev.endStep === stepIndex) {
        return prev;
      }
      return {
        ...prev,
        endStep: stepIndex,
        moved: prev.moved || stepIndex !== prev.startStep,
      };
    });
  };

  const onSynthPointerEnter = (stepIndex: number, pitch: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if ((event.buttons & 1) !== 1 || !isPitchInEditableRange(pitch)) {
      return;
    }
    setSynthDrag((prev) => {
      if (!prev || prev.pitch !== pitch || prev.endStep === stepIndex) {
        return prev;
      }
      return {
        ...prev,
        endStep: stepIndex,
        moved: prev.moved || stepIndex !== prev.startStep,
      };
    });
  };

  const finalizeSynthDrag = useCallback(() => {
    if (!synthDrag) {
      return;
    }

    const { startStep, endStep, pitch, moved } = synthDrag;
    setSynthDrag(null);

    if (!moved || endStep === startStep) {
      onToggleSynthCell(startStep, pitch);
      return;
    }

    onSetSynthNoteLength(startStep, endStep, pitch);
  }, [onSetSynthNoteLength, onToggleSynthCell, synthDrag]);

  useEffect(() => {
    if (!synthDrag) {
      return;
    }

    const onPointerDone = () => {
      activeSynthPointerIdRef.current = null;
      finalizeSynthDrag();
    };
    window.addEventListener("pointerup", onPointerDone);
    window.addEventListener("pointercancel", onPointerDone);
    return () => {
      window.removeEventListener("pointerup", onPointerDone);
      window.removeEventListener("pointercancel", onPointerDone);
    };
  }, [finalizeSynthDrag, synthDrag]);

  const onToggleDrumCell = (stepIndex: number, lane: "kick" | "snare" | "hat") => {
    if (!track || track.type !== "drums" || !patternId) {
      return;
    }

    const isUnassigned = patternId === "0" || !pattern || pattern.type !== "drums";
    const targetPatternId = isUnassigned ? nextPatternIdFromRecord(track.patterns) : patternId;
    const sourceSteps = isUnassigned ? createEmptyDrumSteps() : pattern.steps;

    const row = sourceSteps[stepIndex];
    const next = row[lane] > 0 ? 0 : lane === "hat" ? 0.6 : 1;

    const ops: JsonPatchOp[] = [];
    if (isUnassigned) {
      ops.push(
        {
          op: "add",
          path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}`,
          value: {
            type: "drums",
            steps: sourceSteps,
          },
        },
        {
          op: "replace",
          path: `/tracks/${safeTrackIndex}/lane/${selectedBar}`,
          value: targetPatternId,
        }
      );
    }

    ops.push({
      op: "replace",
      path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}/steps/${stepIndex}/${lane}`,
      value: next,
    });

    createAndCommit("Edit Drum Step", ops);
  };

  const onParamChange = (key: NumericInstrumentKey, value: number) => {
    applySingleReplace(`/tracks/${safeTrackIndex}/instrument/${key}`, value, `Adjust ${key}`);
  };

  const onWaveformChange = (key: "oscWaveformA" | "oscWaveformB", value: WaveformType) => {
    applySingleReplace(`/tracks/${safeTrackIndex}/instrument/${key}`, value, `Adjust ${key}`);
  };

  const onPresetChange = (presetId: string) => {
    if (!track || presetId === "custom") {
      return;
    }

    const preset = availablePresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    createAndCommit(`Apply ${preset.label} Preset`, [
      {
        op: "replace",
        path: `/tracks/${safeTrackIndex}/instrument`,
        value: { ...preset.params },
      },
    ]);
  };

  const addBars = (count = 4) => {
    const ops: JsonPatchOp[] = [
      {
        op: "replace",
        path: "/bars",
        value: song.bars + count,
      },
    ];

    song.tracks.forEach((_, idx) => {
      for (let i = 0; i < count; i += 1) {
        ops.push({
          op: "add",
          path: `/tracks/${idx}/lane/-`,
          value: "0",
        });
      }
    });

    createAndCommit(`Add ${count} Bars`, ops);
  };

  const assignPatternToBar = (nextPatternId: string) => {
    if (!track) {
      return;
    }

    if (nextPatternId === "__unassigned") {
      return;
    }

    if (!track.patterns[nextPatternId]) {
      return;
    }

    if (patternId === nextPatternId) {
      return;
    }

    createAndCommit("Assign Pattern To Bar", [
      {
        op: "replace",
        path: `/tracks/${safeTrackIndex}/lane/${selectedBar}`,
        value: nextPatternId,
      },
    ]);
  };

  const createPatternForBar = () => {
    if (!track || !patternId) {
      return;
    }

    const newPatternId = nextPatternIdFromRecord(track.patterns);
    const template =
      pattern && ((track.type === "synth" && pattern.type === "synth") || (track.type === "drums" && pattern.type === "drums"))
        ? deepClone(pattern)
        : track.type === "synth"
          ? { type: "synth" as const, steps: createEmptySynthSteps() }
          : { type: "drums" as const, steps: createEmptyDrumSteps() };

    createAndCommit("Create Pattern For Bar", [
      {
        op: "add",
        path: `/tracks/${safeTrackIndex}/patterns/${newPatternId}`,
        value: template,
      },
      {
        op: "replace",
        path: `/tracks/${safeTrackIndex}/lane/${selectedBar}`,
        value: newPatternId,
      },
    ]);
  };

  const addTrack = (type: TrackType) => {
    const typeCount = song.tracks.filter((t) => t.type === type).length;
    const trackIndex = song.tracks.length;
    const name = type === "synth" ? `Synth ${typeCount + 1}` : `Drums ${typeCount + 1}`;
    const id = `t-${type}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
    const lane = Array.from({ length: song.bars }, () => "0");

    const newTrack: Track =
      type === "synth"
        ? {
            id,
            name,
            type: "synth",
            instrument: buildDefaultInstrument("synth"),
            patterns: {
              "1": {
                type: "synth",
                steps: createEmptySynthSteps(),
              },
            },
            lane,
          }
        : {
            id,
            name,
            type: "drums",
            instrument: buildDefaultInstrument("drums"),
            patterns: {
              "1": {
                type: "drums",
                steps: createEmptyDrumSteps(),
              },
            },
            lane,
          };

    createAndCommit(`Add ${type === "synth" ? "Synth" : "Drums"} Track`, [
      {
        op: "add",
        path: "/tracks/-",
        value: newTrack,
      },
    ]);
    setSelectedTrack(trackIndex);
  };

  const generateCandidates = (text: string) => {
    const next = aiProposePatch(
      text,
      committedSong,
      {
        selectedTrackId: track?.id,
        selectedBar,
      },
      0.6,
      {}
    ).map((patch, idx) => ({
      ...patch,
      id: `${patch.id}-${idx}-${Date.now()}`,
    }));

    setCandidates(next);
  };

  const onSubmitPrompt = (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) {
      return;
    }
    generateCandidates(prompt.trim());
  };

  const auditionToggle = (candidate: PatchMeta) => {
    if (auditionPatchId === candidate.id) {
      stopAudition();
      return;
    }
    startAudition(candidate);
  };

  const rejectCandidate = (id: string) => {
    if (auditionPatchId === id) {
      stopAudition();
    }
    setCandidates((prev) => prev.filter((p) => p.id !== id));
  };

  const acceptCandidate = (candidate: PatchMeta) => {
    acceptPatch(candidate);
    setCandidates((prev) => prev.filter((p) => p.id !== candidate.id));
  };

  const newSong = () => {
    if (engineRef.current?.playing) {
      engineRef.current.stop();
      setIsPlaying(false);
    }
    resetSong();
    setCandidates([]);
    setSelectedTrack(0);
    setSelectedBar(0);
    setMutedTrackIds([]);
    setLoopRange(null);
    setLoopDrag(null);
    setTrackOctaves({});
    setOctaveBase(DEFAULT_OCTAVE_BASE);
    setOctaveTransition(null);
  };

  const onTimelineBarPointerDown = (bar: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !loopRange) {
      return;
    }
    if (bar < loopRange.start || bar > loopRange.end) {
      return;
    }
    event.preventDefault();
    setLoopDrag({ anchor: bar, moved: false });
  };

  const onTimelineBarPointerEnter = (bar: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if ((event.buttons & 1) !== 1 || !loopDrag) {
      return;
    }
    const nextStart = Math.min(loopDrag.anchor, bar);
    const nextEnd = Math.max(loopDrag.anchor, bar);
    setLoopRange({ start: nextStart, end: nextEnd });
    setLoopDrag((prev) =>
      prev
        ? {
            ...prev,
            moved: prev.moved || bar !== prev.anchor,
          }
        : prev
    );
  };

  useEffect(() => {
    if (!loopDrag) {
      return;
    }
    const finishDrag = () => {
      if (loopDrag.moved) {
        suppressBarClickRef.current = true;
      }
      setLoopDrag(null);
    };
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [loopDrag]);

  const applyOctaveBase = useCallback(
    (target: number) => {
      if (!track || track.type !== "synth") {
        return;
      }
      const clamped = Math.max(MIN_OCTAVE_BASE, Math.min(MAX_OCTAVE_BASE, target));
      const visibleBase = octaveTransition?.to ?? octaveBase;
      if (clamped === visibleBase) {
        return;
      }
      if (octaveTransitionTimerRef.current !== null) {
        window.clearTimeout(octaveTransitionTimerRef.current);
      }
      setOctaveTransition({
        from: visibleBase,
        to: clamped,
        direction: clamped > visibleBase ? 1 : -1,
        running: false,
      });
      window.requestAnimationFrame(() => {
        setOctaveTransition((prev) => (prev ? { ...prev, running: true } : prev));
      });
      octaveTransitionTimerRef.current = window.setTimeout(() => {
        setOctaveBase(clamped);
        setTrackOctaves((prev) => ({ ...prev, [track.id]: clamped }));
        setOctaveTransition(null);
        octaveTransitionTimerRef.current = null;
      }, OCTAVE_TRANSITION_MS);
    },
    [octaveBase, octaveTransition, track]
  );

  const onOctaveScrubPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!track || track.type !== "synth") {
      return;
    }
    event.preventDefault();
    const visibleBase = octaveTransition?.to ?? octaveBase;
    octaveScrubRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startBase: visibleBase,
      lastStepDelta: 0,
    };
    setOctaveScrubOffsetPx(0);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onOctaveScrubPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = octaveScrubRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaY = event.clientY - drag.startY;
    const stepDelta = Math.trunc(deltaY / OCTAVE_SCRUB_STEP_PX);
    if (stepDelta === drag.lastStepDelta) {
      const remainder = deltaY - stepDelta * OCTAVE_SCRUB_STEP_PX;
      setOctaveScrubOffsetPx(remainder);
      return;
    }
    drag.lastStepDelta = stepDelta;
    const remainder = deltaY - stepDelta * OCTAVE_SCRUB_STEP_PX;
    setOctaveScrubOffsetPx(remainder);
    applyOctaveBase(drag.startBase + stepDelta);
  };

  const onOctaveScrubPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = octaveScrubRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    octaveScrubRef.current = null;
    setOctaveScrubOffsetPx(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const renderPitchRows = (rows: Array<{ pitch: number; ghost: boolean; inRange: boolean }>) =>
    rows.map(({ pitch, ghost, inRange }) => (
      <div
        key={pitch}
        className={[
          "grid-row",
          "synth-row",
          ghost ? "ghost-row" : "",
          !inRange ? "out-of-range" : "",
          getPitchClass(pitch) === 0
            ? "key-c"
            : getPitchClass(pitch) === 7
              ? "key-g"
              : isBlackKey(pitch)
                ? "key-black"
                : "key-white",
        ].join(" ")}
      >
        <span className="row-label">{inRange ? toNoteName(pitch) : ""}</span>
        {Array.from({ length: 16 }, (_, step) => {
          if (!inRange) {
            return <span key={`${pitch}-${step}`} className="step-cell synth-cell hidden-cell" aria-hidden="true" />;
          }
          const previewEnd = synthDrag ? Math.max(synthDrag.startStep, synthDrag.endStep) : -1;
          const isDragPreviewOn =
            Boolean(synthDrag) &&
            synthDrag?.pitch === pitch &&
            step >= synthDrag.startStep &&
            step <= previewEnd;
          let synthVisual = getSynthStepVisual(synthPatternSteps, pitch, step);
          if (isDragPreviewOn && synthDrag) {
            if (synthDrag.startStep === previewEnd) {
              synthVisual = "single";
            } else if (step === synthDrag.startStep) {
              synthVisual = "start";
            } else if (step === previewEnd) {
              synthVisual = "end";
            } else {
              synthVisual = "middle";
            }
          }
          return (
            <button
              key={`${pitch}-${step}`}
              className={[
                "step-cell",
                "synth-cell",
                synthVisual !== "off" ? "on" : "",
                `note-${synthVisual}`,
              ].join(" ")}
              data-synth-cell="1"
              data-step={step}
              data-pitch={pitch}
              onPointerDown={(event) => onSynthPointerDown(step, pitch, event)}
              onPointerMove={onSynthPointerMove}
              onPointerEnter={(event) => onSynthPointerEnter(step, pitch, event)}
            />
          );
        })}
      </div>
    ));

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Beepbox x Strudel x AI Patch</h1>
        <div className="top-controls">
          <div className="control-group transport-group">
            <button
              onClick={() => {
                if (isPlaying) {
                  onPause();
                  return;
                }
                void onPlay();
              }}
              aria-label={isPlaying ? "Pause" : "Play"}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button onClick={onStop} aria-label="Stop" title="Stop">
              ⏹
            </button>
          </div>
          <span className="controls-divider" aria-hidden="true" />
          <div className="control-group history-group">
            <button onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo">
              ↶
            </button>
            <button onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo">
              ↷
            </button>
          </div>
          <span className="controls-divider" aria-hidden="true" />
          <button onClick={newSong}>New Song</button>
          <button
            type="button"
            className="ai-dock-button"
            onClick={() => {
              setIsSoundOpen(false);
              setIsAiOpen(true);
            }}
            aria-label="Open Smart Patch panel"
          >
            Smart Patch
          </button>
          {track && (
            <button
              type="button"
              className="sound-dock-button"
              onClick={() => {
                setIsAiOpen(false);
                setIsSoundOpen(true);
              }}
              aria-label="Open Sound panel"
            >
              Sound
            </button>
          )}
        </div>
        <div className="status-row">
          <label>
            Tempo
            <input
              type="range"
              min={70}
              max={180}
              step={1}
              value={song.tempo}
              onChange={(e) => onTempoChange(Number(e.target.value))}
            />
            <span>{song.tempo}</span>
          </label>
          <label className="master-volume">
            Master
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={masterVolume}
              onChange={(e) => setMasterVolume(Number(e.target.value))}
            />
            <span>{Math.round(masterVolume * 100)}%</span>
          </label>
          <span>
            Playhead: Bar {playhead.bar + 1} Step {playhead.step + 1}
          </span>
        </div>
      </header>

      <main className="panel">
        <div className="workspace">
          <section className="main-view">
            {track && (
              <section>
                {track.type === "synth" && (
                  <div className="octave-shell">
                    <div className="octave-editor-shell">
                      <div
                        className={[
                          "octave-grid-viewport",
                          octaveTransition ? "octave-transition" : "",
                          octaveTransition?.direction === 1 ? "dir-up" : "dir-down",
                          octaveTransition?.running ? "running" : "",
                        ].join(" ")}
                        style={{
                          ...editorSweepStyle,
                          "--octave-scrub-offset": `${octaveScrubOffsetPx}px`,
                        } as CSSProperties}
                      >
                        {!octaveTransition && (
                          <div className="step-grid octave-layer step-grid-editor synth-editor">
                            {isEditorStepTrackingActive && <div className="editor-sweep" aria-hidden="true" />}
                            {renderPitchRows(pitchRows)}
                          </div>
                        )}
                        {octaveTransition && (
                          <>
                            <div className="step-grid octave-layer old step-grid-editor synth-editor">
                              {isEditorStepTrackingActive && <div className="editor-sweep" aria-hidden="true" />}
                              {renderPitchRows(buildPitchRows(octaveTransition.from))}
                            </div>
                            <div className="step-grid octave-layer new step-grid-editor synth-editor">
                              {isEditorStepTrackingActive && <div className="editor-sweep" aria-hidden="true" />}
                              {renderPitchRows(buildPitchRows(octaveTransition.to))}
                            </div>
                          </>
                        )}
                      </div>

                      <div
                        className="octave-scrubber"
                        onPointerDown={onOctaveScrubPointerDown}
                        onPointerMove={onOctaveScrubPointerMove}
                        onPointerUp={onOctaveScrubPointerEnd}
                        onPointerCancel={onOctaveScrubPointerEnd}
                        role="slider"
                        aria-label="Octave scrubber"
                        aria-orientation="vertical"
                        aria-valuemin={MIN_OCTAVE_BASE}
                        aria-valuemax={MAX_OCTAVE_BASE}
                        aria-valuenow={octaveBase}
                        aria-valuetext={`${toNoteWithOctave(octaveBase)} to ${toNoteWithOctave(
                          octaveBase + 11
                        )}`}
                      >
                        <div className="octave-scrubber-header">
                          {toNoteWithOctave(octaveBase)}-{toNoteWithOctave(octaveBase + 11)}
                        </div>
                        <div
                          className="octave-scrubber-range"
                          style={
                            {
                              "--octave-window-top": `${
                                ((MAX_OCTAVE_BASE - octaveBase) / (MAX_OCTAVE_BASE - MIN_OCTAVE_BASE + 12)) * 100
                              }%`,
                              "--octave-window-height": `${(12 / (MAX_OCTAVE_BASE - MIN_OCTAVE_BASE + 12)) * 100}%`,
                            } as CSSProperties
                          }
                        >
                          <div className="octave-scrubber-window" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {track.type === "drums" && (
                  <div
                    className="step-grid step-grid-editor"
                    style={editorSweepStyle}
                  >
                    {isEditorStepTrackingActive && <div className="editor-sweep" aria-hidden="true" />}
                    {(["kick", "snare", "hat"] as const).map((lane) => (
                      <div key={lane} className="grid-row">
                        <span className="row-label">{lane}</span>
                        {Array.from({ length: 16 }, (_, step) => {
                          const velocity = drumPatternSteps[step][lane];
                          return (
                            <button
                              key={`${lane}-${step}`}
                              className={[
                                "step-cell",
                                velocity > 0 ? "on" : "",
                              ].join(" ")}
                              onClick={() => onToggleDrumCell(step, lane)}
                            >
                              {velocity > 0 ? "*" : ""}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </section>

          {track && (
            <aside
              className={["sound-column", isSoundOpen ? "open" : ""].join(" ")}
              aria-label="Sound Controls"
            >
              <div className="sound-sheet-header">
                <h2>Sound - {track.name}</h2>
                <button
                  type="button"
                  className="sound-sheet-close"
                  onClick={() => setIsSoundOpen(false)}
                  aria-label="Close Sound panel"
                >
                  Close
                </button>
              </div>
              <label className="preset-select">
                <span>Preset</span>
                <select value={selectedPresetId ?? "custom"} onChange={(e) => onPresetChange(e.target.value)}>
                  <option value="custom">Custom</option>
                  {availablePresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              {track.type === "synth" && (
                <div className="sound-card-section">
                  <button
                    type="button"
                    className={oscOpen ? "section-toggle open" : "section-toggle"}
                    onClick={() => setOscOpen((prev) => !prev)}
                    aria-expanded={oscOpen}
                  >
                    Osc
                  </button>
                  {oscOpen && (
                    <div className="osc-controls">
                      <label className="waveform-row">
                        <span>Osc A</span>
                        <select
                          value={track.instrument.oscWaveformA}
                          onChange={(e) => onWaveformChange("oscWaveformA", e.target.value as WaveformType)}
                        >
                          <option value="sine">Sine</option>
                          <option value="triangle">Triangle</option>
                          <option value="sawtooth">Saw</option>
                          <option value="square">Square</option>
                        </select>
                      </label>
                      <label className="waveform-row">
                        <span>Osc B</span>
                        <select
                          value={track.instrument.oscWaveformB}
                          onChange={(e) => onWaveformChange("oscWaveformB", e.target.value as WaveformType)}
                        >
                          <option value="sine">Sine</option>
                          <option value="triangle">Triangle</option>
                          <option value="sawtooth">Saw</option>
                          <option value="square">Square</option>
                        </select>
                      </label>
                      <label>
                        <span>Osc Mix</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.instrument.oscMix}
                          onChange={(e) => onParamChange("oscMix", Number(e.target.value))}
                        />
                        <span>{track.instrument.oscMix.toFixed(2)}</span>
                      </label>
                    </div>
                  )}
                </div>
              )}
              <div className="sound-card-section">
                <button
                  type="button"
                  className={adsrOpen ? "section-toggle open" : "section-toggle"}
                  onClick={() => setAdsrOpen((prev) => !prev)}
                  aria-expanded={adsrOpen}
                >
                  Envelope
                </button>
                {adsrOpen && (
                  <AdsrEnvelopeEditor
                    attack={track.instrument.attack}
                    decay={track.instrument.decay}
                    sustain={track.instrument.sustain}
                    release={track.instrument.release}
                    onChange={onParamChange}
                  />
                )}
              </div>
              <div className="sound-card-section">
                <button
                  type="button"
                  className={filterOpen ? "section-toggle open" : "section-toggle"}
                  onClick={() => setFilterOpen((prev) => !prev)}
                  aria-expanded={filterOpen}
                >
                  Filter EQ
                </button>
                {filterOpen && (
                  <FilterEqPad
                    cutoff={track.instrument.cutoff}
                    resonance={track.instrument.resonance}
                    onChange={onParamChange}
                  />
                )}
              </div>
              {track.type === "synth" && (
                <div className="sound-card-section">
                  <button
                    type="button"
                    className={modOpen ? "section-toggle open" : "section-toggle"}
                    onClick={() => setModOpen((prev) => !prev)}
                    aria-expanded={modOpen}
                  >
                    Mod
                  </button>
                  {modOpen && (
                    <SynthModPads
                      detune={track.instrument.detune}
                      drive={track.instrument.drive}
                      vibratoRate={track.instrument.vibratoRate}
                      vibratoDepth={track.instrument.vibratoDepth}
                      onChange={onParamChange}
                    />
                  )}
                </div>
              )}
              <div className="sliders">
                {(
                  [
                    ["gain", 0, 1.2, 0.01],
                    ["lofiAmount", 0, 1, 0.01],
                  ] as Array<[NumericInstrumentKey, number, number, number]>
                ).map(([name, min, max, step]) => (
                  <label key={name}>
                    <span>{name}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={track.instrument[name]}
                      onChange={(e) => onParamChange(name, Number(e.target.value))}
                    />
                    <span>{track.instrument[name].toFixed(3)}</span>
                  </label>
                ))}
              </div>
            </aside>
          )}
        </div>
      </main>

      <section className="timeline-dock" aria-label="Timeline">
        {track && (
          <div className="timeline-controls">
            <div className="timeline-controls-left">
              <span>
                Bar: <strong>{selectedBar + 1}</strong>
              </span>
              <label>
                Pattern
                <select value={patternSelectValue} onChange={(e) => assignPatternToBar(e.target.value)}>
                  <option value="__unassigned" disabled>
                    Unassigned
                  </option>
                  {trackPatternIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={createPatternForBar}>
                New Pattern
              </button>
              <button type="button" onClick={() => addBars(4)}>
                Add 4 Bars
              </button>
              {loopRange !== null && (
                <button type="button" onClick={() => setLoopRange(null)}>
                  Clear Loop (Bars {loopRange.start + 1}-{loopRange.end + 1})
                </button>
              )}
            </div>
            <div className="timeline-controls-center">
              <button
                type="button"
                className={lockToActive ? "lock-active-button on" : "lock-active-button"}
                onClick={() => setLockToActive((prev) => !prev)}
                aria-pressed={lockToActive}
                title="Lock editor to currently playing bar"
              >
                {lockToActive ? "Lock To Active: On" : "Lock To Active: Off"}
              </button>
            </div>
            <div className="timeline-controls-right">
              <button type="button" onClick={() => addTrack("synth")}>
                Add Synth Track
              </button>
              <button type="button" onClick={() => addTrack("drums")}>
                Add Drums Track
              </button>
            </div>
          </div>
        )}

        <div className="timeline-rows-wrap">
          <div
            className="timeline-global-sweep"
            style={{ left: `calc(${globalSweepLeftRem}rem - ${timelineScrollLeft}px)` }}
            aria-hidden="true"
          />
          {song.tracks.map((t, trackIndex) => (
            <div
              key={t.id}
              className={mutedTrackIds.includes(t.id) ? "timeline-row muted" : "timeline-row"}
            >
              <div className={safeTrackIndex === trackIndex ? "timeline-track-label active" : "timeline-track-label"}>
                <button
                  type="button"
                  className={mutedTrackIds.includes(t.id) ? "mute-toggle muted" : "mute-toggle"}
                  onClick={() => toggleTrackMute(t.id)}
                  aria-label={mutedTrackIds.includes(t.id) ? `Unmute ${t.name}` : `Mute ${t.name}`}
                  title={mutedTrackIds.includes(t.id) ? `Unmute ${t.name}` : `Mute ${t.name}`}
                >
                  {mutedTrackIds.includes(t.id) ? "🔇" : "🔊"}
                </button>
                {t.name}
              </div>
              <div
                className="bar-grid"
                ref={(el) => {
                  timelineRowRefs.current[trackIndex] = el;
                }}
                onScroll={(event) => syncTimelineScroll(trackIndex, event.currentTarget.scrollLeft)}
              >
                <div
                  className="bar-grid-inner"
                  style={{
                    gridTemplateColumns: `repeat(${song.bars}, 2.15rem)`,
                  }}
                >
                <div
                  className="timeline-loop-region"
                  style={{
                    width: `${loopRegionPercent}%`,
                    left: `calc(0.2rem + ${loopRegionLeftPercent}%)`,
                  }}
                  aria-hidden="true"
                />
                {barOptions.map((bar) => (
                  <button
                    key={`${t.id}-${bar}`}
                    className={[
                      "bar-cell",
                      selectedBar === bar && safeTrackIndex === trackIndex ? "active" : "",
                      loopRange && bar >= loopRange.start && bar <= loopRange.end ? "looped" : "",
                    ].join(" ")}
                    onClick={() => {
                      if (suppressBarClickRef.current) {
                        suppressBarClickRef.current = false;
                        return;
                      }
                      setSelectedTrack(trackIndex);
                      if (!lockToActive) {
                        setSelectedBar(bar);
                      }
                    }}
                    onDoubleClick={() => {
                      setSelectedTrack(trackIndex);
                      if (!lockToActive) {
                        setSelectedBar(bar);
                      }
                      setLoopRange((prev) =>
                        prev && prev.start === bar && prev.end === bar
                          ? null
                          : { start: bar, end: bar }
                      );
                    }}
                    onPointerDown={(event) => onTimelineBarPointerDown(bar, event)}
                    onPointerEnter={(event) => onTimelineBarPointerEnter(bar, event)}
                  >
                    {t.lane[bar]}
                  </button>
                ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {isSoundOpen && (
        <button
          type="button"
          className="sound-sheet-backdrop"
          onClick={() => setIsSoundOpen(false)}
          aria-label="Close Sound panel"
        />
      )}
      {isAiOpen && <button type="button" className="ai-sheet-backdrop" onClick={() => setIsAiOpen(false)} />}

      <section className={["ai-sheet", isAiOpen ? "open" : ""].join(" ")} aria-label="Smart Patch Panel">
        <div className="ai-sheet-header">
          <h2>Smart Patch Proposals</h2>
          <button type="button" onClick={() => setIsAiOpen(false)}>
            Close
          </button>
        </div>

        <div className="preset-row">
          {[
            ["Punchier", "make drums punchy"],
            ["Lo-fi", "make it lofi"],
            ["Add swing", "add swing"],
            ["Add variation", "add variation"],
          ].map(([label, p]) => (
            <button
              key={label}
              onClick={() => {
                setPrompt(p);
                generateCandidates(p);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmitPrompt} className="ai-form">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the patch change you want..."
          />
          <button type="submit">Propose</button>
        </form>

        <div className="candidate-list">
          {candidates.map((candidate) => (
            <article key={candidate.id} className="candidate-card">
              <h3>{candidate.label}</h3>
              <p>{candidate.explanation}</p>
              <div className="candidate-actions">
                <button onClick={() => auditionToggle(candidate)}>
                  {auditionPatchId === candidate.id ? "Stop Audition" : "Audition"}
                </button>
                <button onClick={() => acceptCandidate(candidate)}>Accept</button>
                <button onClick={() => rejectCandidate(candidate.id)}>Reject</button>
              </div>
            </article>
          ))}
          {candidates.length === 0 && <p>No patch candidates yet. Use presets or type a prompt.</p>}
        </div>
      </section>
    </div>
  );
}

export default App;
