import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiProposePatch } from "./ai/aiProposePatch";
import { AudioEngine, getEffectiveLoopBars } from "./audio/engine";
import { useSong } from "./state/songContext";
import { JsonPatchOp, PatchMeta, SongState, SynthStep, Track } from "./types/song";

const MIN_OCTAVE_BASE = 24;
const MAX_OCTAVE_BASE = 96;
const DEFAULT_OCTAVE_BASE = 60;
const OCTAVE_TRANSITION_MS = 260;

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
  const [playhead, setPlayhead] = useState({ bar: 0, step: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [octaveBase, setOctaveBase] = useState(DEFAULT_OCTAVE_BASE);
  const [octaveTransition, setOctaveTransition] = useState<{
    from: number;
    to: number;
    direction: 1 | -1;
    running: boolean;
  } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [candidates, setCandidates] = useState<PatchMeta[]>([]);

  const engineRef = useRef<AudioEngine | null>(null);
  const songRef = useRef<SongState>(song);
  const octaveTransitionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    songRef.current = song;
  }, [song]);

  useEffect(() => {
    if (!engineRef.current) {
      const engine = new AudioEngine();
      engine.onTick((info) => setPlayhead(info));
      engineRef.current = engine;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (octaveTransitionTimerRef.current !== null) {
        window.clearTimeout(octaveTransitionTimerRef.current);
      }
    };
  }, []);

  const safeTrackIndex = Math.min(selectedTrack, Math.max(0, song.tracks.length - 1));
  const track = song.tracks[safeTrackIndex] ?? song.tracks[0];
  const patternId = track?.lane[selectedBar] ?? track?.lane[0];
  const pattern = patternId ? track?.patterns[patternId] : undefined;
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
  const effectiveLoopBars = useMemo(() => getEffectiveLoopBars(song), [song]);
  const buildPitchRows = useCallback((base: number) => {
    const rows: Array<{ pitch: number; ghost: boolean }> = [];
    for (let pitch = base + 13; pitch >= base + 12; pitch -= 1) {
      if (pitch >= 0 && pitch <= 127) {
        rows.push({ pitch, ghost: true });
      }
    }
    for (let pitch = base + 11; pitch >= base; pitch -= 1) {
      if (pitch >= 0 && pitch <= 127) {
        rows.push({ pitch, ghost: false });
      }
    }
    for (let pitch = base - 1; pitch >= base - 2; pitch -= 1) {
      if (pitch >= 0 && pitch <= 127) {
        rows.push({ pitch, ghost: true });
      }
    }
    return rows;
  }, []);
  const pitchRows = useMemo(() => buildPitchRows(octaveBase), [octaveBase, buildPitchRows]);

  const togglePlayback = useCallback(async () => {
    if (!engineRef.current) {
      return;
    }

    if (engineRef.current.playing) {
      engineRef.current.stop();
      setIsPlaying(false);
      return;
    }

    await engineRef.current.start(() => songRef.current);
    setIsPlaying(true);
  }, []);

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
      void togglePlayback();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlayback]);

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
    if (!track || track.type !== "synth" || !patternId) {
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

    ops.push({
      op: "replace",
      path: `/tracks/${safeTrackIndex}/patterns/${targetPatternId}/steps/${stepIndex}`,
      value: nextValue,
    });

    createAndCommit("Edit Synth Step", ops);
  };

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

  const onParamChange = (key: keyof Track["instrument"], value: number) => {
    applySingleReplace(`/tracks/${safeTrackIndex}/instrument/${key}`, value, `Adjust ${key}`);
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

    if (nextPatternId !== "0" && !track.patterns[nextPatternId]) {
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
    setOctaveBase(DEFAULT_OCTAVE_BASE);
    setOctaveTransition(null);
  };

  const startOctaveShift = (direction: 1 | -1) => {
    if (octaveTransition) {
      return;
    }

    const target = Math.max(MIN_OCTAVE_BASE, Math.min(MAX_OCTAVE_BASE, octaveBase + direction * 12));
    if (target === octaveBase) {
      return;
    }

    setOctaveTransition({
      from: octaveBase,
      to: target,
      direction,
      running: false,
    });

    window.requestAnimationFrame(() => {
      setOctaveTransition((prev) => (prev ? { ...prev, running: true } : prev));
    });

    if (octaveTransitionTimerRef.current !== null) {
      window.clearTimeout(octaveTransitionTimerRef.current);
    }
    octaveTransitionTimerRef.current = window.setTimeout(() => {
      setOctaveBase(target);
      setOctaveTransition(null);
      octaveTransitionTimerRef.current = null;
    }, OCTAVE_TRANSITION_MS);
  };

  const renderPitchRows = (rows: Array<{ pitch: number; ghost: boolean }>) =>
    rows.map(({ pitch, ghost }) => (
      <div
        key={pitch}
        className={[
          "grid-row",
          ghost ? "ghost-row" : "",
          getPitchClass(pitch) === 0
            ? "key-c"
            : getPitchClass(pitch) === 7
              ? "key-g"
              : isBlackKey(pitch)
                ? "key-black"
                : "key-white",
        ].join(" ")}
      >
        <span className="row-label">{toNoteName(pitch)}</span>
        {Array.from({ length: 16 }, (_, step) => {
          const isOn = normalizeSynthCell(synthPatternSteps[step]).some((note) => note.pitch === pitch);
          return (
            <button
              key={`${pitch}-${step}`}
              className={["step-cell", isOn ? "on" : "", playhead.step === step ? "playing" : ""].join(" ")}
              onClick={() => onToggleSynthCell(step, pitch)}
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
          <button onClick={togglePlayback}>{isPlaying ? "Stop" : "Play"}</button>
          <button onClick={undo} disabled={!canUndo}>
            Undo
          </button>
          <button onClick={redo} disabled={!canRedo}>
            Redo
          </button>
          <button onClick={newSong}>New Song</button>
          <button
            type="button"
            className="ai-dock-button"
            onClick={() => setIsAiOpen(true)}
            aria-label="Open Smart Patch panel"
          >
            Smart Patch
          </button>
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
                    {(() => {
                      const upBase = Math.min(MAX_OCTAVE_BASE, octaveBase + 12);
                      const downBase = Math.max(MIN_OCTAVE_BASE, octaveBase - 12);
                      return (
                        <>
                    <button
                      type="button"
                      className="octave-shift top"
                      onClick={() => startOctaveShift(1)}
                      disabled={octaveBase >= MAX_OCTAVE_BASE || Boolean(octaveTransition)}
                      aria-label="Octave up"
                    >
                      ▲ Octave Up to {toNoteWithOctave(upBase)} - {toNoteWithOctave(upBase + 11)}
                    </button>

                    <div
                      className={[
                        "octave-grid-viewport",
                        octaveTransition ? "octave-transition" : "",
                        octaveTransition?.direction === 1 ? "dir-up" : "dir-down",
                        octaveTransition?.running ? "running" : "",
                      ].join(" ")}
                    >
                      {!octaveTransition && <div className="step-grid octave-layer">{renderPitchRows(pitchRows)}</div>}
                      {octaveTransition && (
                        <>
                          <div className="step-grid octave-layer old">{renderPitchRows(buildPitchRows(octaveTransition.from))}</div>
                          <div className="step-grid octave-layer new">{renderPitchRows(buildPitchRows(octaveTransition.to))}</div>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      className="octave-shift bottom"
                      onClick={() => startOctaveShift(-1)}
                      disabled={octaveBase <= MIN_OCTAVE_BASE || Boolean(octaveTransition)}
                      aria-label="Octave down"
                    >
                      ▼ Octave Down to {toNoteWithOctave(downBase)} - {toNoteWithOctave(downBase + 11)}
                    </button>
                        </>
                      );
                    })()}
                  </div>
                )}

                {track.type === "drums" && (
                  <div className="step-grid">
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
                                playhead.step === step ? "playing" : "",
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
            <aside className="sound-column" aria-label="Sound Controls">
              <h2>Sound - {track.name}</h2>
              <div className="sliders">
                {(
                  [
                    ["attack", 0, 0.5, 0.005],
                    ["decay", 0.01, 0.8, 0.005],
                    ["sustain", 0, 1, 0.01],
                    ["release", 0.01, 1, 0.01],
                    ["cutoff", 200, 10000, 1],
                    ["resonance", 0.1, 12, 0.1],
                    ["gain", 0, 1.2, 0.01],
                    ["lofiAmount", 0, 1, 0.01],
                  ] as Array<[keyof Track["instrument"], number, number, number]>
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
            <span>
              Bar: <strong>{selectedBar + 1}</strong>
            </span>
            <label>
              Pattern
              <select value={patternId ?? ""} onChange={(e) => assignPatternToBar(e.target.value)}>
                <option value="0">0</option>
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
          </div>
        )}

        {song.tracks.map((t, trackIndex) => (
          <div key={t.id} className="timeline-row">
            <button
              className={safeTrackIndex === trackIndex ? "chip active" : "chip"}
              onClick={() => setSelectedTrack(trackIndex)}
            >
              {t.name}
            </button>
            <div className="bar-grid">
              <div
                className="bar-grid-inner"
                style={{
                  gridTemplateColumns: `repeat(${song.bars}, minmax(0, 1fr))`,
                }}
              >
              <div
                className="timeline-sweep"
                style={{
                  left: `${((playhead.bar * 16 + playhead.step) / (effectiveLoopBars * 16)) * 100}%`,
                }}
                aria-hidden="true"
              />
              {barOptions.map((bar) => (
                <button
                  key={`${t.id}-${bar}`}
                  className={[
                    "bar-cell",
                    selectedBar === bar && safeTrackIndex === trackIndex ? "active" : "",
                  ].join(" ")}
                  onClick={() => {
                    setSelectedTrack(trackIndex);
                    setSelectedBar(bar);
                  }}
                >
                  {t.lane[bar]}
                </button>
              ))}
              </div>
            </div>
          </div>
        ))}
      </section>

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
