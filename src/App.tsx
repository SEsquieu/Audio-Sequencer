import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { aiProposePatch } from "./ai/aiProposePatch";
import { AudioEngine } from "./audio/engine";
import { useSong } from "./state/songContext";
import { JsonPatchOp, PatchMeta, SongState, Track } from "./types/song";

const pitchRows = [72, 69, 67, 64, 60];

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
  const [prompt, setPrompt] = useState("");
  const [candidates, setCandidates] = useState<PatchMeta[]>([]);

  const engineRef = useRef<AudioEngine | null>(null);
  const songRef = useRef<SongState>(song);

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

  const safeTrackIndex = Math.min(selectedTrack, Math.max(0, song.tracks.length - 1));
  const track = song.tracks[safeTrackIndex] ?? song.tracks[0];
  const patternId = track?.lane[selectedBar] ?? track?.lane[0];
  const pattern = patternId ? track?.patterns[patternId] : undefined;

  const barOptions = useMemo(() => Array.from({ length: song.bars }, (_, i) => i), [song.bars]);

  const togglePlayback = async () => {
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
  };

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
    if (!track || track.type !== "synth" || !pattern || pattern.type !== "synth" || !patternId) {
      return;
    }

    const current = pattern.steps[stepIndex];
    const isSame = current?.pitch === pitch;
    const nextValue = isSame ? null : { pitch, velocity: 0.9, length: 1 };
    createAndCommit("Edit Synth Step", [
      {
        op: "replace",
        path: `/tracks/${safeTrackIndex}/patterns/${patternId}/steps/${stepIndex}`,
        value: nextValue,
      },
    ]);
  };

  const onToggleDrumCell = (stepIndex: number, lane: "kick" | "snare" | "hat") => {
    if (!track || track.type !== "drums" || !pattern || pattern.type !== "drums" || !patternId) {
      return;
    }

    const row = pattern.steps[stepIndex];
    const next = row[lane] > 0 ? 0 : lane === "hat" ? 0.6 : 1;

    createAndCommit("Edit Drum Step", [
      {
        op: "replace",
        path: `/tracks/${safeTrackIndex}/patterns/${patternId}/steps/${stepIndex}/${lane}`,
        value: next,
      },
    ]);
  };

  const onParamChange = (key: keyof Track["instrument"], value: number) => {
    applySingleReplace(`/tracks/${safeTrackIndex}/instrument/${key}`, value, `Adjust ${key}`);
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
  };

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
            {track && pattern && (
              <section>
                <h2>Edit - {track.name}</h2>
                <p>
                  Bar {selectedBar + 1} Pattern {patternId}
                </p>

                {track.type === "synth" && pattern.type === "synth" && (
                  <div className="step-grid">
                    {pitchRows.map((pitch) => (
                      <div key={pitch} className="grid-row">
                        <span className="row-label">{pitch}</span>
                        {Array.from({ length: 16 }, (_, step) => {
                          const isOn = pattern.steps[step]?.pitch === pitch;
                          return (
                            <button
                              key={`${pitch}-${step}`}
                              className={["step-cell", isOn ? "on" : "", playhead.step === step ? "playing" : ""].join(
                                " "
                              )}
                              onClick={() => onToggleSynthCell(step, pitch)}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}

                {track.type === "drums" && pattern.type === "drums" && (
                  <div className="step-grid">
                    {(["kick", "snare", "hat"] as const).map((lane) => (
                      <div key={lane} className="grid-row">
                        <span className="row-label">{lane}</span>
                        {Array.from({ length: 16 }, (_, step) => {
                          const velocity = pattern.steps[step][lane];
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
        {song.tracks.map((t, trackIndex) => (
          <div key={t.id} className="timeline-row">
            <button
              className={safeTrackIndex === trackIndex ? "chip active" : "chip"}
              onClick={() => setSelectedTrack(trackIndex)}
            >
              {t.name}
            </button>
            <div className="bar-grid">
              {barOptions.map((bar) => (
                <button
                  key={`${t.id}-${bar}`}
                  className={[
                    "bar-cell",
                    selectedBar === bar && safeTrackIndex === trackIndex ? "active" : "",
                    playhead.bar === bar ? "playing" : "",
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
