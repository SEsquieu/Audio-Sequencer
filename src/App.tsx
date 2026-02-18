import {
  CSSProperties,
  ChangeEvent,
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
const TIMELINE_LABEL_REM_DESKTOP = 6;
const TIMELINE_ROW_GAP_REM_DESKTOP = 0.45;
const TIMELINE_LABEL_REM_MOBILE = 4.5;
const TIMELINE_ROW_GAP_REM_MOBILE = 0.35;
const TIMELINE_BAR_INNER_PAD_REM = 0.2;
const TIMELINE_BAR_WIDTH_REM = 2.15;
const TIMELINE_BAR_GAP_REM = 0.3;
const TIMELINE_BAR_LONG_PRESS_MS = 420;
const TIMELINE_BAR_LONG_PRESS_MOVE_PX = 10;

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

const findSynthNoteAtStep = (
  steps: SynthStep[][],
  pitch: number,
  stepIndex: number
): { start: number; length: number } | null => {
  for (let start = stepIndex; start >= 0; start -= 1) {
    const note = normalizeSynthCell(steps[start]).find((n) => n.pitch === pitch);
    if (!note) {
      continue;
    }
    const length = Math.max(1, note.length);
    const end = Math.min(15, start + length - 1);
    if (stepIndex >= start && stepIndex <= end) {
      return { start, length };
    }
  }
  return null;
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
  originNoteStart: number | null;
  originNoteLength: number | null;
}

interface LoopRange {
  start: number;
  end: number;
}

interface LoopDragState {
  anchor: number;
  moved: boolean;
  pointerId: number;
  pointerType: string;
  trackIndex: number;
  mode: "anchor" | "extendStart" | "extendEnd";
  fixedStart: number;
  fixedEnd: number;
}

interface OctaveScrubState {
  pointerId: number;
  startY: number;
  startBase: number;
  lastStepDelta: number;
  desktopDirect: boolean;
}

interface PianoWalkState {
  active: boolean;
  pointerId: number | null;
  lastPitch: number | null;
}

interface DrumWalkState {
  active: boolean;
  pointerId: number | null;
  lastLane: "kick" | "snare" | "hat" | null;
}

interface TimelineScrollMetrics {
  max: number;
  viewport: number;
}

interface TimelineBarActionState {
  trackIndex: number;
  bar: number;
  clientX: number;
  clientY: number;
}

interface ExportedSongFile {
  format: "audio-sequencer-song";
  version: 1;
  exportedAt: string;
  song: SongState;
}

const isSongStateLike = (value: unknown): value is SongState => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SongState>;
  if (
    typeof candidate.tempo !== "number" ||
    typeof candidate.swing !== "number" ||
    typeof candidate.bars !== "number" ||
    !Array.isArray(candidate.tracks)
  ) {
    return false;
  }
  return candidate.tracks.every((track) => {
    if (!track || typeof track !== "object") {
      return false;
    }
    const t = track as Partial<SongState["tracks"][number]>;
    return (
      typeof t.id === "string" &&
      typeof t.name === "string" &&
      (t.type === "synth" || t.type === "drums") &&
      !!t.instrument &&
      typeof t.instrument === "object" &&
      !!t.patterns &&
      typeof t.patterns === "object" &&
      Array.isArray(t.lane)
    );
  });
};

const parseImportedSong = (value: unknown): SongState | null => {
  if (isSongStateLike(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const wrapped = value as Partial<ExportedSongFile>;
  if (wrapped.format !== "audio-sequencer-song" || wrapped.version !== 1 || !isSongStateLike(wrapped.song)) {
    return null;
  }
  return wrapped.song;
};

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
    importSong,
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
  const [trackNoteSpanMemory, setTrackNoteSpanMemory] = useState<Record<string, number>>({});
  const [mobileTimelineControlsOpen, setMobileTimelineControlsOpen] = useState(false);
  const [timelineBarAction, setTimelineBarAction] = useState<TimelineBarActionState | null>(null);
  const [tempoDraft, setTempoDraft] = useState(() => String(song.tempo));
  const [isTempoFieldFocused, setIsTempoFieldFocused] = useState(false);
  const [isMobileTimelineLayout, setIsMobileTimelineLayout] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 899px)").matches;
  });

  const engineRef = useRef<AudioEngine | null>(null);
  const songRef = useRef<SongState>(song);
  const octaveScrubRef = useRef<OctaveScrubState | null>(null);
  const octaveTransitionTimerRef = useRef<number | null>(null);
  const pianoWalkRef = useRef<PianoWalkState>({
    active: false,
    pointerId: null,
    lastPitch: null,
  });
  const drumWalkRef = useRef<DrumWalkState>({
    active: false,
    pointerId: null,
    lastLane: null,
  });
  const suppressBarClickRef = useRef(false);
  const activeSynthPointerIdRef = useRef<number | null>(null);
  const timelineRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const syncingTimelineScrollRef = useRef(false);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [timelineScrollMetrics, setTimelineScrollMetrics] = useState<TimelineScrollMetrics>({
    max: 0,
    viewport: 1,
  });
  const timelineScrubberRef = useRef<HTMLDivElement | null>(null);
  const timelineScrubPointerIdRef = useRef<number | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const timelineBarLongPressRef = useRef<{
    pointerId: number;
    trackIndex: number;
    bar: number;
    startX: number;
    startY: number;
  } | null>(null);
  const timelineBarLongPressTimerRef = useRef<number | null>(null);
  const isLoopTouchDragActive = Boolean(loopDrag && loopDrag.pointerType !== "mouse");

  useEffect(() => {
    songRef.current = song;
  }, [song]);

  useEffect(() => {
    if (!isTempoFieldFocused) {
      setTempoDraft(String(song.tempo));
    }
  }, [isTempoFieldFocused, song.tempo]);

  useEffect(() => {
    if (!engineRef.current) {
      const engine = new AudioEngine();
      engine.onTick((info) => setPlayhead(info));
      engine.setMasterVolume(masterVolume);
      engineRef.current = engine;
    }
  }, [masterVolume]);

  const getOrCreateEngine = useCallback(() => {
    let engine = engineRef.current;
    if (!engine) {
      engine = new AudioEngine();
      engine.onTick((info) => setPlayhead(info));
      engine.setMasterVolume(masterVolume);
      engine.setMutedTrackIds(mutedTrackIds);
      engineRef.current = engine;
    }
    return engine;
  }, [masterVolume, mutedTrackIds]);

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
  const timelineLabelRem = isMobileTimelineLayout ? TIMELINE_LABEL_REM_MOBILE : TIMELINE_LABEL_REM_DESKTOP;
  const timelineRowGapRem = isMobileTimelineLayout ? TIMELINE_ROW_GAP_REM_MOBILE : TIMELINE_ROW_GAP_REM_DESKTOP;
  const globalSweepLeftRem =
    timelineLabelRem +
    timelineRowGapRem +
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
    const media = window.matchMedia("(max-width: 899px)");
    const handleChange = () => setIsMobileTimelineLayout(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (!isMobileTimelineLayout) {
      setMobileTimelineControlsOpen(false);
    }
  }, [isMobileTimelineLayout]);

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

  const updateTimelineScrollMetrics = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      return;
    }
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    setTimelineScrollMetrics((prev) => {
      if (Math.abs(prev.max - max) < 0.5 && Math.abs(prev.viewport - el.clientWidth) < 0.5) {
        return prev;
      }
      return { max, viewport: Math.max(1, el.clientWidth) };
    });
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

  useEffect(() => {
    const measure = () => updateTimelineScrollMetrics(timelineRowRefs.current[0] ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [song.bars, song.tracks.length, updateTimelineScrollMetrics]);

  const timelineViewportRatio =
    timelineScrollMetrics.max <= 0
      ? 1
      : Math.max(
          0.1,
          Math.min(1, timelineScrollMetrics.viewport / (timelineScrollMetrics.viewport + timelineScrollMetrics.max))
        );
  const timelineWindowWidthPercent = timelineViewportRatio * 100;
  const timelineWindowTravelPercent = Math.max(0, 100 - timelineWindowWidthPercent);
  const timelineWindowLeftPercent =
    timelineScrollMetrics.max <= 0
      ? 0
      : (Math.max(0, Math.min(timelineScrollMetrics.max, timelineScrollLeft)) / timelineScrollMetrics.max) *
        timelineWindowTravelPercent;

  const applyTimelineScrollFromClientX = useCallback(
    (clientX: number, scrubberEl: HTMLDivElement) => {
      if (timelineScrollMetrics.max <= 0) {
        return;
      }
      const rect = scrubberEl.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const nextScroll = ratio * timelineScrollMetrics.max;
      syncTimelineScroll(-1, nextScroll);
    },
    [syncTimelineScroll, timelineScrollMetrics.max]
  );

  const onTimelineScrubberPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (timelineScrollMetrics.max <= 0) {
      return;
    }
    event.preventDefault();
    timelineScrubPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    applyTimelineScrollFromClientX(event.clientX, event.currentTarget);
  };

  const onTimelineScrubberPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (timelineScrubPointerIdRef.current !== event.pointerId) {
      return;
    }
    if (event.pointerType === "mouse" && (event.buttons & 1) !== 1) {
      return;
    }
    applyTimelineScrollFromClientX(event.clientX, event.currentTarget);
  };

  const onTimelineScrubberPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (timelineScrubPointerIdRef.current !== event.pointerId) {
      return;
    }
    timelineScrubPointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

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
    const clamped = Math.max(70, Math.min(180, Math.round(value)));
    applySingleReplace("/tempo", clamped, "Change Tempo");
  };

  const commitTempoDraft = useCallback(() => {
    const parsed = Number(tempoDraft);
    if (Number.isFinite(parsed)) {
      onTempoChange(parsed);
    } else {
      setTempoDraft(String(song.tempo));
    }
  }, [onTempoChange, song.tempo, tempoDraft]);

  const onToggleSynthCell = (stepIndex: number, pitch: number) => {
    if (!track || track.type !== "synth" || !patternId || !isPitchInEditableRange(pitch)) {
      return;
    }

    const isUnassigned = patternId === "0" || !pattern || pattern.type !== "synth";
    const targetPatternId = isUnassigned ? nextPatternIdFromRecord(track.patterns) : patternId;
    const sourceSteps = isUnassigned ? createEmptySynthSteps() : pattern.steps;
    const rememberedLength = Math.max(1, Math.floor(trackNoteSpanMemory[track.id] ?? 1));
    const nextLength = Math.max(1, Math.min(16 - stepIndex, rememberedLength));

    const current = normalizeSynthCell(sourceSteps[stepIndex]);
    const hasPitch = current.some((note) => note.pitch === pitch);
    if (!hasPitch && current.length >= 4) {
      return;
    }
    const nextValue = hasPitch
      ? current.filter((note) => note.pitch !== pitch)
      : [...current, { pitch, velocity: 0.9, length: nextLength }].sort((a, b) => b.pitch - a.pitch);

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
        // Note-span persistence mode: do not clip and restart inside an active span.
        return;
      }
    }

    ops.push({
      op: "replace",
      path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}/steps/${stepIndex}`,
      value: nextValue,
    });

    if (!hasPitch && nextLength > 1) {
      const endStep = Math.min(15, stepIndex + nextLength - 1);
      for (let step = stepIndex + 1; step <= endStep; step += 1) {
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
    }

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
    setTrackNoteSpanMemory((prev) => ({ ...prev, [track.id]: length }));
  };

  const onRemoveSynthNote = (stepIndex: number, pitch: number) => {
    if (!track || track.type !== "synth" || !patternId || !pattern || pattern.type !== "synth") {
      return;
    }

    const sourceSteps = pattern.steps;
    const noteInfo = findSynthNoteAtStep(sourceSteps, pitch, stepIndex);
    if (!noteInfo) {
      return;
    }

    const ops: JsonPatchOp[] = [];
    const startNotes = normalizeSynthCell(sourceSteps[noteInfo.start]);
    ops.push({
      op: "replace",
      path: `/tracks/${safeTrackIndex}/patterns/${patternId}/steps/${noteInfo.start}`,
      value: startNotes.filter((note) => note.pitch !== pitch),
    });

    const end = Math.min(15, noteInfo.start + noteInfo.length - 1);
    for (let step = noteInfo.start + 1; step <= end; step += 1) {
      const notes = normalizeSynthCell(sourceSteps[step]);
      if (!notes.some((note) => note.pitch === pitch)) {
        continue;
      }
      ops.push({
        op: "replace",
        path: `/tracks/${safeTrackIndex}/patterns/${patternId}/steps/${step}`,
        value: notes.filter((note) => note.pitch !== pitch),
      });
    }

    createAndCommit("Remove Synth Note", ops);
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
    const origin = findSynthNoteAtStep(synthPatternSteps, pitch, stepIndex);
    setSynthDrag({
      startStep: stepIndex,
      endStep: stepIndex,
      pitch,
      moved: false,
      startClientX: event.clientX,
      cellWidth: Math.max(1, cellRect.width),
      originNoteStart: origin?.start ?? null,
      originNoteLength: origin?.length ?? null,
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

    const { startStep, endStep, pitch, moved, originNoteStart, originNoteLength } = synthDrag;
    setSynthDrag(null);

    if (originNoteStart !== null) {
      if (moved && endStep < startStep) {
        const originalEnd = Math.min(15, originNoteStart + Math.max(1, originNoteLength ?? 1) - 1);
        const nextEnd = Math.max(originNoteStart, Math.min(originalEnd, endStep));
        onSetSynthNoteLength(originNoteStart, nextEnd, pitch);
        return;
      }
      onRemoveSynthNote(startStep, pitch);
      return;
    }

    if (!moved || endStep === startStep) {
      onToggleSynthCell(startStep, pitch);
      return;
    }

    onSetSynthNoteLength(startStep, endStep, pitch);
  }, [onRemoveSynthNote, onSetSynthNoteLength, onToggleSynthCell, synthDrag]);

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

  const onPreviewSynthPitch = useCallback((pitch: number) => {
    if (!track || track.type !== "synth" || !isPitchInEditableRange(pitch)) {
      return;
    }
    const engine = getOrCreateEngine();
    void engine.previewSynthNote(track, pitch, 1, 2, song.tempo);
  }, [getOrCreateEngine, song.tempo, track]);

  const onPreviewDrumLane = useCallback(
    (lane: "kick" | "snare" | "hat") => {
      if (!track || track.type !== "drums") {
        return;
      }
      const engine = getOrCreateEngine();
      const velocity = lane === "hat" ? 0.75 : 1;
      void engine.previewDrumHit(track, lane, velocity);
    },
    [getOrCreateEngine, track]
  );

  const onPianoKeyPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, pitch: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isPitchInEditableRange(pitch)) {
      return;
    }
    pianoWalkRef.current.active = true;
    pianoWalkRef.current.pointerId = event.pointerId;
    pianoWalkRef.current.lastPitch = pitch;
    onPreviewSynthPitch(pitch);
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const walk = pianoWalkRef.current;
      if (!walk.active || walk.pointerId !== event.pointerId) {
        return;
      }
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const key = target?.closest("[data-piano-pitch]") as HTMLElement | null;
      if (!key) {
        return;
      }
      const pitchValue = Number(key.dataset.pianoPitch);
      if (!Number.isFinite(pitchValue) || !isPitchInEditableRange(pitchValue)) {
        return;
      }
      if (walk.lastPitch === pitchValue) {
        return;
      }
      walk.lastPitch = pitchValue;
      onPreviewSynthPitch(pitchValue);
    };

    const onPointerDone = (event: PointerEvent) => {
      const walk = pianoWalkRef.current;
      if (!walk.active || walk.pointerId !== event.pointerId) {
        return;
      }
      walk.active = false;
      walk.pointerId = null;
      walk.lastPitch = null;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerDone);
    window.addEventListener("pointercancel", onPointerDone);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerDone);
      window.removeEventListener("pointercancel", onPointerDone);
    };
  }, [onPreviewSynthPitch]);

  const onDrumLanePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    lane: "kick" | "snare" | "hat"
  ) => {
    event.preventDefault();
    event.stopPropagation();
    drumWalkRef.current.active = true;
    drumWalkRef.current.pointerId = event.pointerId;
    drumWalkRef.current.lastLane = lane;
    onPreviewDrumLane(lane);
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const walk = drumWalkRef.current;
      if (!walk.active || walk.pointerId !== event.pointerId) {
        return;
      }
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const laneEl = target?.closest("[data-drum-lane]") as HTMLElement | null;
      if (!laneEl) {
        return;
      }
      const lane = laneEl.dataset.drumLane as "kick" | "snare" | "hat" | undefined;
      if (!lane || (lane !== "kick" && lane !== "snare" && lane !== "hat")) {
        return;
      }
      if (walk.lastLane === lane) {
        return;
      }
      walk.lastLane = lane;
      onPreviewDrumLane(lane);
    };

    const onPointerDone = (event: PointerEvent) => {
      const walk = drumWalkRef.current;
      if (!walk.active || walk.pointerId !== event.pointerId) {
        return;
      }
      walk.active = false;
      walk.pointerId = null;
      walk.lastLane = null;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerDone);
    window.addEventListener("pointercancel", onPointerDone);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerDone);
      window.removeEventListener("pointercancel", onPointerDone);
    };
  }, [onPreviewDrumLane]);

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
    setTrackNoteSpanMemory({});
    setOctaveBase(DEFAULT_OCTAVE_BASE);
    setOctaveTransition(null);
  };

  const onSaveSongToFile = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const payload: ExportedSongFile = {
        format: "audio-sequencer-song",
        version: 1,
        exportedAt: new Date().toISOString(),
        song: committedSong,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = payload.exportedAt.replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `audio-sequencer-song-${stamp}.frog`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.warn("[song] Failed to export song file", error);
    }
  }, [committedSong]);

  const onImportSongClick = () => {
    importFileInputRef.current?.click();
  };

  const clearTimelineBarLongPressTimer = useCallback(() => {
    if (timelineBarLongPressTimerRef.current === null) {
      return;
    }
    window.clearTimeout(timelineBarLongPressTimerRef.current);
    timelineBarLongPressTimerRef.current = null;
  }, []);

  const cancelTimelineBarLongPress = useCallback(() => {
    timelineBarLongPressRef.current = null;
    clearTimelineBarLongPressTimer();
  }, [clearTimelineBarLongPressTimer]);

  const toggleSingleBarLoop = useCallback(
    (trackIndex: number, bar: number) => {
      setSelectedTrack(trackIndex);
      if (!lockToActive) {
        setSelectedBar(bar);
      }
      setLoopRange((prev) =>
        prev && prev.start === bar && prev.end === bar
          ? null
          : { start: bar, end: bar }
      );
    },
    [lockToActive]
  );

  const clearPatternAtBar = useCallback(
    (trackIndex: number, bar: number) => {
      const targetTrack = song.tracks[trackIndex];
      if (!targetTrack) {
        return;
      }
      const targetPatternId = targetTrack.lane[bar] ?? "0";
      if (targetPatternId === "0") {
        return;
      }

      const remainingUseCount = targetTrack.lane.reduce((count, lanePatternId, laneIndex) => {
        if (laneIndex === bar) {
          return count;
        }
        return lanePatternId === targetPatternId ? count + 1 : count;
      }, 0);

      const ops: JsonPatchOp[] = [
        {
          op: "replace",
          path: `/tracks/${trackIndex}/lane/${bar}`,
          value: "0",
        },
      ];

      if (remainingUseCount === 0 && targetTrack.patterns[targetPatternId]) {
        ops.push({
          op: "remove",
          path: `/tracks/${trackIndex}/patterns/${targetPatternId}`,
        });
      }

      createAndCommit("Clear Bar Pattern", ops);
      setSelectedTrack(trackIndex);
      if (!lockToActive) {
        setSelectedBar(bar);
      }
    },
    [createAndCommit, lockToActive, song.tracks]
  );

  const createBlankPatternAtBar = useCallback(
    (trackIndex: number, bar: number) => {
      const targetTrack = song.tracks[trackIndex];
      if (!targetTrack) {
        return;
      }
      const nextPatternId = nextPatternIdFromRecord(targetTrack.patterns);
      const patternValue =
        targetTrack.type === "synth"
          ? {
              type: "synth" as const,
              steps: createEmptySynthSteps(),
            }
          : {
              type: "drums" as const,
              steps: createEmptyDrumSteps(),
            };

      createAndCommit("Create Blank Pattern For Bar", [
        {
          op: "add",
          path: `/tracks/${trackIndex}/patterns/${nextPatternId}`,
          value: patternValue,
        },
        {
          op: "replace",
          path: `/tracks/${trackIndex}/lane/${bar}`,
          value: nextPatternId,
        },
      ]);
      setSelectedTrack(trackIndex);
      if (!lockToActive) {
        setSelectedBar(bar);
      }
    },
    [createAndCommit, lockToActive, song.tracks]
  );

  const onImportSongFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }

      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const nextSong = parseImportedSong(parsed);
        if (!nextSong) {
          throw new Error("Invalid song file format.");
        }

        if (engineRef.current?.playing) {
          engineRef.current.stop();
          setIsPlaying(false);
        }

        importSong(nextSong);
        setSelectedTrack(0);
        setSelectedBar(0);
        setLockToActive(false);
        setMutedTrackIds([]);
        setLoopRange(null);
        setLoopDrag(null);
        setTrackOctaves({});
        setTrackNoteSpanMemory({});
        setOctaveBase(DEFAULT_OCTAVE_BASE);
        setOctaveTransition(null);
        setCandidates([]);
      } catch (error) {
        console.warn("[song] Failed to import song file", error);
        window.alert("Could not import this file. Please choose a valid .frog or .json song export.");
      }
    },
    [importSong]
  );

  const onTimelineBarPointerDown = (trackIndex: number, bar: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "mouse") {
      timelineBarLongPressRef.current = {
        pointerId: event.pointerId,
        trackIndex,
        bar,
        startX: event.clientX,
        startY: event.clientY,
      };
      clearTimelineBarLongPressTimer();
      timelineBarLongPressTimerRef.current = window.setTimeout(() => {
        const pending = timelineBarLongPressRef.current;
        if (!pending || pending.pointerId !== event.pointerId) {
          return;
        }
        suppressBarClickRef.current = true;
        setSelectedTrack(trackIndex);
        if (!lockToActive) {
          setSelectedBar(bar);
        }
        setLoopDrag(null);
        setTimelineBarAction({
          trackIndex: pending.trackIndex,
          bar: pending.bar,
          clientX: pending.startX,
          clientY: pending.startY,
        });
        timelineBarLongPressRef.current = null;
        timelineBarLongPressTimerRef.current = null;
      }, TIMELINE_BAR_LONG_PRESS_MS);
    }

    if ((event.pointerType === "mouse" && event.button !== 0) || !loopRange) {
      return;
    }
    if (bar < loopRange.start || bar > loopRange.end) {
      return;
    }
    const mode: LoopDragState["mode"] =
      loopRange.start === loopRange.end
        ? "anchor"
        : bar === loopRange.start
          ? "extendStart"
          : bar === loopRange.end
            ? "extendEnd"
            : "anchor";
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setLoopDrag({
      anchor: bar,
      moved: false,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      trackIndex,
      mode,
      fixedStart: loopRange.start,
      fixedEnd: loopRange.end,
    });
  };

  const extendLoopRangeToBar = useCallback((bar: number) => {
    setLoopDrag((prev) => {
      if (!prev) {
        return prev;
      }
      let nextStart = prev.fixedStart;
      let nextEnd = prev.fixedEnd;
      if (prev.mode === "extendStart") {
        nextStart = Math.max(0, Math.min(bar, prev.fixedEnd));
      } else if (prev.mode === "extendEnd") {
        nextEnd = Math.min(song.bars - 1, Math.max(bar, prev.fixedStart));
      } else {
        nextStart = Math.min(prev.anchor, bar);
        nextEnd = Math.max(prev.anchor, bar);
      }
      setLoopRange({ start: nextStart, end: nextEnd });
      return {
        ...prev,
        moved: prev.moved || bar !== prev.anchor,
      };
    });
  }, [song.bars]);

  const getBarIndexFromClientX = useCallback(
    (clientX: number, trackIndex: number) => {
      const rowEl = timelineRowRefs.current[trackIndex];
      if (!rowEl) {
        return null;
      }
      const remPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const cellStridePx = (TIMELINE_BAR_WIDTH_REM + TIMELINE_BAR_GAP_REM) * remPx;
      const innerPadPx = TIMELINE_BAR_INNER_PAD_REM * remPx;
      const rect = rowEl.getBoundingClientRect();
      const localX = clientX - rect.left + rowEl.scrollLeft - innerPadPx;
      if (!Number.isFinite(localX)) {
        return null;
      }
      const raw = Math.floor(localX / cellStridePx);
      return Math.max(0, Math.min(song.bars - 1, raw));
    },
    [song.bars]
  );

  const onTimelineBarPointerEnter = (bar: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!loopDrag || event.pointerId !== loopDrag.pointerId) {
      return;
    }
    if (event.pointerType === "mouse" && (event.buttons & 1) !== 1) {
      return;
    }
    extendLoopRangeToBar(bar);
  };

  useEffect(() => {
    if (!loopDrag) {
      return;
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== loopDrag.pointerId) {
        return;
      }
      if (loopDrag.pointerType === "mouse" && (event.buttons & 1) !== 1) {
        return;
      }
      if (loopDrag.pointerType !== "mouse") {
        event.preventDefault();
      }
      const bar = getBarIndexFromClientX(event.clientX, loopDrag.trackIndex);
      if (bar === null) {
        return;
      }
      extendLoopRangeToBar(bar);
    };

    const finishDrag = () => {
      if (loopDrag.moved) {
        suppressBarClickRef.current = true;
      }
      setLoopDrag(null);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [extendLoopRangeToBar, getBarIndexFromClientX, loopDrag]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const pending = timelineBarLongPressRef.current;
      if (!pending || pending.pointerId !== event.pointerId) {
        return;
      }
      const moved =
        Math.abs(event.clientX - pending.startX) > TIMELINE_BAR_LONG_PRESS_MOVE_PX ||
        Math.abs(event.clientY - pending.startY) > TIMELINE_BAR_LONG_PRESS_MOVE_PX;
      if (moved) {
        cancelTimelineBarLongPress();
      }
    };
    const onPointerDone = (event: PointerEvent) => {
      const pending = timelineBarLongPressRef.current;
      if (!pending || pending.pointerId !== event.pointerId) {
        return;
      }
      cancelTimelineBarLongPress();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerDone);
    window.addEventListener("pointercancel", onPointerDone);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerDone);
      window.removeEventListener("pointercancel", onPointerDone);
    };
  }, [cancelTimelineBarLongPress]);

  useEffect(() => () => clearTimelineBarLongPressTimer(), [clearTimelineBarLongPressTimer]);

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

  const applyOctaveBaseImmediate = useCallback(
    (target: number) => {
      if (!track || track.type !== "synth") {
        return;
      }
      const clamped = Math.max(MIN_OCTAVE_BASE, Math.min(MAX_OCTAVE_BASE, target));
      if (octaveTransitionTimerRef.current !== null) {
        window.clearTimeout(octaveTransitionTimerRef.current);
        octaveTransitionTimerRef.current = null;
      }
      setOctaveTransition(null);
      setOctaveBase(clamped);
      setTrackOctaves((prev) => ({ ...prev, [track.id]: clamped }));
    },
    [track]
  );

  const getOctaveBaseFromPointer = useCallback((clientY: number, el: HTMLDivElement): number => {
    const rect = el.getBoundingClientRect();
    const range = MAX_OCTAVE_BASE - MIN_OCTAVE_BASE;
    if (rect.height <= 0 || range <= 0) {
      return octaveBase;
    }
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const ratio = y / rect.height;
    const mapped = MAX_OCTAVE_BASE - ratio * range;
    return Math.round(mapped);
  }, [octaveBase]);

  const onOctaveScrubPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!track || track.type !== "synth") {
      return;
    }
    event.preventDefault();
    const visibleBase = octaveTransition?.to ?? octaveBase;
    const desktopDirect = !isMobileTimelineLayout && event.pointerType === "mouse";
    octaveScrubRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startBase: visibleBase,
      lastStepDelta: 0,
      desktopDirect,
    };
    if (desktopDirect) {
      applyOctaveBaseImmediate(getOctaveBaseFromPointer(event.clientY, event.currentTarget));
    }
    setOctaveScrubOffsetPx(0);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onOctaveScrubPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = octaveScrubRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag.desktopDirect) {
      applyOctaveBaseImmediate(getOctaveBaseFromPointer(event.clientY, event.currentTarget));
      setOctaveScrubOffsetPx(0);
      return;
    }
    const directionMultiplier = isMobileTimelineLayout ? 1 : -1;
    const adjustedDeltaY = (event.clientY - drag.startY) * directionMultiplier;
    const stepDelta = Math.trunc(adjustedDeltaY / OCTAVE_SCRUB_STEP_PX);
    if (stepDelta === drag.lastStepDelta) {
      const remainder = adjustedDeltaY - stepDelta * OCTAVE_SCRUB_STEP_PX;
      setOctaveScrubOffsetPx(remainder);
      return;
    }
    drag.lastStepDelta = stepDelta;
    const remainder = adjustedDeltaY - stepDelta * OCTAVE_SCRUB_STEP_PX;
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
        <button
          type="button"
          className="row-label piano-key"
          data-piano-pitch={inRange ? pitch : undefined}
          onPointerDown={(event) => onPianoKeyPointerDown(event, pitch)}
          aria-label={inRange ? `Play ${toNoteWithOctave(pitch)}` : undefined}
          disabled={!inRange}
        >
          {inRange ? toNoteName(pitch) : ""}
        </button>
        {Array.from({ length: 16 }, (_, step) => {
          if (!inRange) {
            return <span key={`${pitch}-${step}`} className="step-cell synth-cell hidden-cell" aria-hidden="true" />;
          }
          const dragPreviewActive = Boolean(synthDrag?.moved);
          const previewEnd = dragPreviewActive && synthDrag ? Math.max(synthDrag.startStep, synthDrag.endStep) : -1;
          const isDragPreviewOn =
            dragPreviewActive &&
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
    <div
      className={["app-shell", isLoopTouchDragActive ? "loop-touch-drag-active" : ""].join(" ")}
      onPointerDownCapture={() => {
        void getOrCreateEngine().ensureContext();
      }}
    >
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
          <button
            type="button"
            className="save-song-button icon-only"
            onClick={onSaveSongToFile}
            aria-label="Save song to file"
            title="Save song"
          >
            <span className="save-song-icon" aria-hidden="true">
              💾
            </span>
          </button>
          <button
            type="button"
            className="save-song-button icon-only"
            onClick={onImportSongClick}
            aria-label="Import song from file"
            title="Import song"
          >
            <span className="save-song-icon" aria-hidden="true">
              📂
            </span>
          </button>
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
          <input
            ref={importFileInputRef}
            type="file"
            accept=".frog,.json,application/json"
            onChange={onImportSongFile}
            style={{ display: "none" }}
          />
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
            <input
              className="tempo-value-input"
              type="number"
              min={70}
              max={180}
              step={1}
              inputMode="numeric"
              pattern="[0-9]*"
              value={tempoDraft}
              onFocus={() => setIsTempoFieldFocused(true)}
              onChange={(e) => setTempoDraft(e.target.value)}
              onBlur={() => {
                setIsTempoFieldFocused(false);
                commitTempoDraft();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setTempoDraft(String(song.tempo));
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              aria-label="Tempo BPM"
            />
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
                        <button
                          type="button"
                          className="row-label drum-lane-key"
                          data-drum-lane={lane}
                          onPointerDown={(event) => onDrumLanePointerDown(event, lane)}
                          aria-label={`Preview ${lane}`}
                        >
                          {lane}
                        </button>
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

      <section
        className={["timeline-dock", timelineBarAction ? "bar-action-mode" : ""].join(" ")}
        aria-label="Timeline"
      >
        <div className="timeline-content">
          {track && (
            <>
              {isMobileTimelineLayout && (
                <div className="timeline-mobile-strip">
                  <span>
                    Bar <strong>{selectedBar + 1}</strong> • Pattern <strong>{patternSelectValue}</strong>
                  </span>
                  <button
                    type="button"
                    className="timeline-toggle-button"
                    onClick={() => setMobileTimelineControlsOpen((prev) => !prev)}
                    aria-expanded={mobileTimelineControlsOpen}
                  >
                    {mobileTimelineControlsOpen ? "Hide Controls" : "Show Controls"}
                  </button>
                </div>
              )}
              {(!isMobileTimelineLayout || mobileTimelineControlsOpen) && (
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
            </>
          )}

          <div className="timeline-radial-shell">
            <div
              ref={timelineScrubberRef}
              className="timeline-radial-scrubber"
              onPointerDown={onTimelineScrubberPointerDown}
              onPointerMove={onTimelineScrubberPointerMove}
              onPointerUp={onTimelineScrubberPointerEnd}
              onPointerCancel={onTimelineScrubberPointerEnd}
              role="slider"
              aria-label="Timeline scroll"
              aria-valuemin={0}
              aria-valuemax={Math.round(timelineScrollMetrics.max)}
              aria-valuenow={Math.round(timelineScrollLeft)}
            >
              <div
                className="timeline-radial-window"
                style={
                  {
                    "--timeline-window-left": `${timelineWindowLeftPercent}%`,
                    "--timeline-window-width": `${timelineWindowWidthPercent}%`,
                  } as CSSProperties
                }
              />
            </div>
          </div>

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
                    if (trackIndex === 0) {
                      updateTimelineScrollMetrics(el);
                    }
                  }}
                  onScroll={(event) => {
                    updateTimelineScrollMetrics(event.currentTarget);
                    syncTimelineScroll(trackIndex, event.currentTarget.scrollLeft);
                  }}
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
                        toggleSingleBarLoop(trackIndex, bar);
                      }}
                      onPointerDown={(event) => onTimelineBarPointerDown(trackIndex, bar, event)}
                      onPointerEnter={(event) => onTimelineBarPointerEnter(bar, event)}
                      data-bar-index={bar}
                    >
                      {t.lane[bar]}
                    </button>
                  ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {timelineBarAction && (
          <>
            <button
              type="button"
              className="timeline-bar-action-backdrop"
              onClick={() => setTimelineBarAction(null)}
              aria-label="Dismiss timeline actions"
            />
            <div
              className="timeline-bar-action-bubbles"
              style={
                {
                  "--timeline-action-x": `${timelineBarAction.clientX}px`,
                  "--timeline-action-y": `${timelineBarAction.clientY}px`,
                } as CSSProperties
              }
              role="dialog"
              aria-label="Pattern controls"
            >
              <button
                type="button"
                disabled={
                  (() => {
                    const actionTrack = song.tracks[timelineBarAction.trackIndex];
                    if (!actionTrack) {
                      return true;
                    }
                    const actionPatternId = actionTrack.lane[timelineBarAction.bar] ?? "0";
                    return actionPatternId === "0" || !actionTrack.patterns[actionPatternId];
                  })()
                }
                onClick={() => setTimelineBarAction(null)}
              >
                Dupe
              </button>
              <button
                type="button"
                onClick={() => {
                  createBlankPatternAtBar(timelineBarAction.trackIndex, timelineBarAction.bar);
                  setTimelineBarAction(null);
                }}
              >
                New
              </button>
              <button
                type="button"
                onClick={() => {
                  clearPatternAtBar(timelineBarAction.trackIndex, timelineBarAction.bar);
                  setTimelineBarAction(null);
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  toggleSingleBarLoop(timelineBarAction.trackIndex, timelineBarAction.bar);
                  setTimelineBarAction(null);
                }}
              >
                Loop
              </button>
              <button type="button" className="cancel" onClick={() => setTimelineBarAction(null)}>
                Cancel
              </button>
            </div>
          </>
        )}
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
