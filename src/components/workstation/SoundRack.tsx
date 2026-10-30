import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine } from '../../audio/engine';
import { FxType, FxInstance, createFxInstance } from '../../audio/fx/types';
import { JsonPatchOp, Track, WaveformType, DelayDivision, DelayBusTargetId, ReverbBusTargetId } from '../../types/song';
import { useSong } from '../../state/songContext';
import { DEFAULT_PRESET_SEND, getMatchingPresetId, getPresetsForType } from '../../state/instrumentPresets';
import { AdsrEnvelopeEditor } from '../AdsrEnvelopeEditor';
import { FilterEqPad } from '../FilterEqPad';
import { SynthModPads } from '../SynthModPads';
import { AdvancedSynth } from './AdvancedSynth';
import { PresetLibrary } from './PresetLibrary';
import { ParameterControl } from './ParameterControl';
const uid = () => crypto.randomUUID();
const deepClone = <T,>(value:T):T => structuredClone(value);
const AVAILABLE_FX_TYPES: FxType[] = ["saturator", "eq3", "chorus", "djFilter"];
const FX_TYPE_LABEL: Record<FxType, string> = {
  saturator: "Saturator",
  eq3: "EQ3",
  chorus: "Chorus",
  djFilter: "DJ Filter",
};
const DELAY_DIVISIONS: DelayDivision[] = ["1/4", "1/8", "1/8d", "1/16"];
const DELAY_BUS_OPTIONS: Array<{ id: DelayBusTargetId; label: string }> = [
  { id: "custom", label: "Custom" },
  { id: "echoA", label: "Echo A" },
  { id: "echoB", label: "Echo B" },
];
const REVERB_BUS_OPTIONS: Array<{ id: ReverbBusTargetId; label: string }> = [
  { id: "custom", label: "Custom" },
  { id: "roomA", label: "Room A" },
  { id: "hallB", label: "Hall B" },
];
type NumericInstrumentKey = Exclude<keyof Track["instrument"], "oscWaveformA" | "oscWaveformB" | "advanced">;
export function SoundRack({trackIndex,getOrCreateEngine}:{trackIndex:number;getOrCreateEngine:()=>AudioEngine}) {
 const {song,commitPatch,applySingleReplace} = useSong();
 const safeTrackIndex = trackIndex;
 const track = song.tracks[trackIndex];
 const availablePresets = useMemo(()=>getPresetsForType(track.type),[track.type]);
 const selectedPresetId = useMemo(()=>getMatchingPresetId(track.type,track.instrument,track.send),[track]);
 const createAndCommit = (label:string,ops:JsonPatchOp[]) => commitPatch({id:uid(),author:'user',label,explanation:label,ops});
  const [adsrOpen, setAdsrOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [modOpen, setModOpen] = useState(false);
  const [oscOpen, setOscOpen] = useState(false);
  const [fxRackOpen, setFxRackOpen] = useState(false);
  const [masterFxRackOpen, setMasterFxRackOpen] = useState(false);
  const [isTrackNameEditing, setIsTrackNameEditing] = useState(false);
  const [trackNameDraft, setTrackNameDraft] = useState("");
  const trackNameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (track) {
      setTrackNameDraft(track.name);
    }
    setIsTrackNameEditing(false);
  }, [track?.id, track?.name]);

  useEffect(() => {
    if (isTrackNameEditing) {
      trackNameInputRef.current?.focus();
      trackNameInputRef.current?.select();
    }
  }, [isTrackNameEditing]);

  const commitTrackNameDraft = () => {
    if (!track) {
      return;
    }
    const trimmed = trackNameDraft.trim();
    const nextName = trimmed.length > 0 ? trimmed : track.name;
    setIsTrackNameEditing(false);
    setTrackNameDraft(nextName);
    if (nextName !== track.name) {
      applySingleReplace(`/tracks/${safeTrackIndex}/name`, nextName, `Rename ${track.name} Track`);
    }
  };

  const cancelTrackNameEdit = () => {
    if (!track) {
      setIsTrackNameEditing(false);
      return;
    }
    setTrackNameDraft(track.name);
    setIsTrackNameEditing(false);
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
      {
        op: "replace",
        path: `/tracks/${safeTrackIndex}/send`,
        value: {
          ...DEFAULT_PRESET_SEND,
          ...preset.send,
        },
      },
    ]);
  };

  const addTrackFx = (trackIndex: number, type: FxType) => {
    createAndCommit(`Add ${FX_TYPE_LABEL[type]} FX`, [
      {
        op: "add",
        path: `/tracks/${trackIndex}/insertFx/-`,
        value: createFxInstance(type, uid()),
      },
    ]);
  };

  const addMasterFx = (type: FxType) => {
    createAndCommit(`Add Master ${FX_TYPE_LABEL[type]} FX`, [
      {
        op: "add",
        path: "/masterFx/-",
        value: createFxInstance(type, uid()),
      },
    ]);
  };

  const toggleFxEnabled = (path: string, enabled: boolean) => {
    applySingleReplace(path, !enabled, enabled ? "Disable FX" : "Enable FX");
  };

  const removeFx = (path: string) => {
    createAndCommit("Remove FX", [{ op: "remove", path }]);
  };

  const moveFxItem = (path: string, index: number, direction: -1 | 1, list: unknown[]) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) {
      return;
    }
    const currentValue = deepClone(list[index]);
    const targetValue = deepClone(list[targetIndex]);
    createAndCommit(direction < 0 ? "Move FX Up" : "Move FX Down", [
      { op: "replace", path: `${path}/${index}`, value: targetValue },
      { op: "replace", path: `${path}/${targetIndex}`, value: currentValue },
    ]);
  };

  const updateFxParams = (path: string, fx: FxInstance, partial: Record<string, number>, label: string) => {
    applySingleReplace(path, { ...fx.params, ...partial }, label);
  };

  const renderFxParamEditor = (fx: FxInstance, paramsPath: string) => {
    if (fx.type === "saturator") {
      const params = fx.params as FxInstance<"saturator">["params"];
      return (
        <div className="osc-controls" style={{ marginTop: "0.3rem" }}>
          <label>
            <span>Drive</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.drive}
              onChange={(e) =>
                updateFxParams(paramsPath, fx, { drive: Number(e.target.value) }, "Adjust Saturator Drive")
              }
            />
            <span>{params.drive.toFixed(2)}</span>
          </label>
          <label>
            <span>Mix</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.mix}
              onChange={(e) => updateFxParams(paramsPath, fx, { mix: Number(e.target.value) }, "Adjust Saturator Mix")}
            />
            <span>{params.mix.toFixed(2)}</span>
          </label>
          <label>
            <span>Output</span>
            <input
              type="range"
              min={0}
              max={1.4}
              step={0.01}
              value={params.output}
              onChange={(e) =>
                updateFxParams(paramsPath, fx, { output: Number(e.target.value) }, "Adjust Saturator Output")
              }
            />
            <span>{params.output.toFixed(2)}</span>
          </label>
        </div>
      );
    }

    if (fx.type === "chorus") {
      const params = fx.params as FxInstance<"chorus">["params"];
      return (
        <div className="osc-controls" style={{ marginTop: "0.3rem" }}>
          <label>
            <span>Rate</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.rate}
              onChange={(e) => updateFxParams(paramsPath, fx, { rate: Number(e.target.value) }, "Adjust Chorus Rate")}
            />
            <span>{params.rate.toFixed(2)}</span>
          </label>
          <label>
            <span>Depth</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.depth}
              onChange={(e) =>
                updateFxParams(paramsPath, fx, { depth: Number(e.target.value) }, "Adjust Chorus Depth")
              }
            />
            <span>{params.depth.toFixed(2)}</span>
          </label>
          <label>
            <span>Mix</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.mix}
              onChange={(e) => updateFxParams(paramsPath, fx, { mix: Number(e.target.value) }, "Adjust Chorus Mix")}
            />
            <span>{params.mix.toFixed(2)}</span>
          </label>
        </div>
      );
    }

    if (fx.type === "djFilter") {
      const params = fx.params as FxInstance<"djFilter">["params"];
      return (
        <div className="osc-controls" style={{ marginTop: "0.3rem" }}>
          <label className="waveform-row">
            <span>Mode</span>
            <select
              value={params.mode}
              onChange={(e) =>
                applySingleReplace(
                  paramsPath,
                  { ...params, mode: e.target.value === "hp" ? "hp" : "lp" },
                  "Adjust DJ Filter Mode"
                )
              }
            >
              <option value="lp">Low-pass</option>
              <option value="hp">High-pass</option>
            </select>
          </label>
          <label>
            <span>Cutoff</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.cutoff}
              onChange={(e) =>
                updateFxParams(paramsPath, fx, { cutoff: Number(e.target.value) }, "Adjust DJ Filter Cutoff")
              }
            />
            <span>{params.cutoff.toFixed(2)}</span>
          </label>
          <label>
            <span>Q</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={params.q}
              onChange={(e) => updateFxParams(paramsPath, fx, { q: Number(e.target.value) }, "Adjust DJ Filter Q")}
            />
            <span>{params.q.toFixed(2)}</span>
          </label>
        </div>
      );
    }

    const params = fx.params as FxInstance<"eq3">["params"];
    return (
      <div className="osc-controls" style={{ marginTop: "0.3rem" }}>
        {(
          [
            ["low", -18, 18, 0.5, "Low"],
            ["mid", -18, 18, 0.5, "Mid"],
            ["high", -18, 18, 0.5, "High"],
          ] as const
        ).map(([key, min, max, step, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={params[key]}
              onChange={(e) => updateFxParams(paramsPath, fx, { [key]: Number(e.target.value) }, `Adjust EQ3 ${label}`)}
            />
            <span>{params[key].toFixed(1)} dB</span>
          </label>
        ))}
      </div>
    );
  };


 return (
            <aside
              className="sound-column open"
              aria-label="Sound Controls"
            >
              <div className="sound-sheet-header">
                <div className="sound-sheet-title-block">
                  <div className="sound-track-name-row">
                    {isTrackNameEditing ? (
                      <input
                        ref={trackNameInputRef}
                        type="text"
                        className="sound-track-name-input"
                        value={trackNameDraft}
                        onChange={(e) => setTrackNameDraft(e.target.value)}
                        onBlur={commitTrackNameDraft}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitTrackNameDraft();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelTrackNameEdit();
                          }
                        }}
                        aria-label="Edit track name"
                        maxLength={32}
                      />
                    ) : (
                      <>
                        <h2 className="sound-track-title">{track.name}</h2>
                        <button
                          type="button"
                          className="sound-track-rename-button"
                          onClick={() => setIsTrackNameEditing(true)}
                          aria-label={`Rename track ${track.name}`}
                          title={`Rename track ${track.name}`}
                        >
                          <span aria-hidden="true">✎</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="sound-sheet-close"
                  onClick={() => {}}
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
              <PresetLibrary track={track} onAudition={() => { const engine = getOrCreateEngine(); if(track.type === "synth") void engine.previewSynthNote(track, track.name.toLowerCase().includes("bass") ? 36 : 60, .8, 4, song.tempo); else void engine.previewDrumHit(track,"kick",.8); }} onLoad={(instrument,send)=>createAndCommit("Load saved patch",[{op:"replace",path:`/tracks/${safeTrackIndex}/instrument`,value:instrument},{op:"replace",path:`/tracks/${safeTrackIndex}/send`,value:send}])}/>
              <details className="rack-module" open><summary>Performance controls</summary><div className="parameter-grid">
                <ParameterControl label="Brightness" value={track.instrument.cutoff} min={20} max={16000} step={10} unit=" Hz" onChange={v=>onParamChange("cutoff",v)}/>
                <ParameterControl label="Resonance" value={track.instrument.resonance} min={.1} max={12} onChange={v=>onParamChange("resonance",v)}/>
                <ParameterControl label="Attack" value={track.instrument.attack} min={0} max={2} unit=" s" onChange={v=>onParamChange("attack",v)}/>
                <ParameterControl label="Decay" value={track.instrument.decay} min={.01} max={3} unit=" s" onChange={v=>onParamChange("decay",v)}/>
                <ParameterControl label="Sustain" value={track.instrument.sustain} min={0} max={1} onChange={v=>onParamChange("sustain",v)}/>
                <ParameterControl label="Release" value={track.instrument.release} min={.01} max={4} unit=" s" onChange={v=>onParamChange("release",v)}/>
              </div></details>
              {track.type === "synth" && <AdvancedSynth instrument={track.instrument} onChange={value=>createAndCommit("Edit advanced synthesis",[{op:"add",path:`/tracks/${safeTrackIndex}/instrument/advanced`,value}])}/>}
              <div className="sound-card-section">
                <button
                  type="button"
                  className={fxRackOpen ? "section-toggle open" : "section-toggle"}
                  onClick={() => setFxRackOpen((prev) => !prev)}
                  aria-expanded={fxRackOpen}
                >
                  FX Rack
                </button>
                {fxRackOpen && (
                  <>
                    <div className="osc-controls">
                      <label>
                        <span>Delay Send</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.send.delay}
                          onChange={(e) =>
                            applySingleReplace(
                              `/tracks/${safeTrackIndex}/send/delay`,
                              Number(e.target.value),
                              `Adjust ${track.name} Delay Send`
                            )
                          }
                        />
                        <span>{track.send.delay.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Reverb Send</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.send.reverb}
                          onChange={(e) =>
                            applySingleReplace(
                              `/tracks/${safeTrackIndex}/send/reverb`,
                              Number(e.target.value),
                              `Adjust ${track.name} Reverb Send`
                            )
                          }
                        />
                        <span>{track.send.reverb.toFixed(2)}</span>
                      </label>
                      <label className="waveform-row">
                        <span>Delay Bus</span>
                        <select
                          value={track.send.delayBus}
                          onChange={(e) =>
                            applySingleReplace(
                              `/tracks/${safeTrackIndex}/send/delayBus`,
                              e.target.value as DelayBusTargetId,
                              `Route ${track.name} Delay Bus`
                            )
                          }
                        >
                          {DELAY_BUS_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="waveform-row">
                        <span>Reverb Bus</span>
                        <select
                          value={track.send.reverbBus}
                          onChange={(e) =>
                            applySingleReplace(
                              `/tracks/${safeTrackIndex}/send/reverbBus`,
                              e.target.value as ReverbBusTargetId,
                              `Route ${track.name} Reverb Bus`
                            )
                          }
                        >
                          {REVERB_BUS_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Delay Tone</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.send.delayTone}
                          onChange={(e) =>
                            applySingleReplace(
                              `/tracks/${safeTrackIndex}/send/delayTone`,
                              Number(e.target.value),
                              `Adjust ${track.name} Delay Tone`
                            )
                          }
                        />
                        <span>{track.send.delayTone.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Reverb Tone</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.send.reverbTone}
                          onChange={(e) =>
                            applySingleReplace(
                              `/tracks/${safeTrackIndex}/send/reverbTone`,
                              Number(e.target.value),
                              `Adjust ${track.name} Reverb Tone`
                            )
                          }
                        />
                        <span>{track.send.reverbTone.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Reverb LowCut</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.send.reverbLowCut}
                          onChange={(e) =>
                            applySingleReplace(
                              `/tracks/${safeTrackIndex}/send/reverbLowCut`,
                              Number(e.target.value),
                              `Adjust ${track.name} Reverb Low Cut`
                            )
                          }
                        />
                        <span>{track.send.reverbLowCut.toFixed(2)}</span>
                      </label>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.35rem" }}>
                      {AVAILABLE_FX_TYPES.map((fxType) => (
                        <button
                          key={`track-add-${fxType}`}
                          type="button"
                          onClick={() => addTrackFx(safeTrackIndex, fxType)}
                        >
                          + {FX_TYPE_LABEL[fxType]}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.45rem" }}>
                      {track.insertFx.length === 0 && <span style={{ opacity: 0.7 }}>No track insert FX</span>}
                      {track.insertFx.map((fx, index) => (
                        <div key={fx.id} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "0.5rem", padding: "0.35rem" }}>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr auto auto auto auto",
                              alignItems: "center",
                              gap: "0.35rem",
                            }}
                          >
                            <span>
                              {index + 1}. {FX_TYPE_LABEL[fx.type]} {fx.enabled ? "" : "(bypassed)"}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                toggleFxEnabled(`/tracks/${safeTrackIndex}/insertFx/${index}/enabled`, fx.enabled)
                              }
                            >
                              {fx.enabled ? "Disable" : "Enable"}
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFxItem(`/tracks/${safeTrackIndex}/insertFx`, index, -1, track.insertFx)}
                              disabled={index === 0}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFxItem(`/tracks/${safeTrackIndex}/insertFx`, index, 1, track.insertFx)}
                              disabled={index === track.insertFx.length - 1}
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFx(`/tracks/${safeTrackIndex}/insertFx/${index}`)}
                            >
                              Remove
                            </button>
                          </div>
                          {renderFxParamEditor(fx, `/tracks/${safeTrackIndex}/insertFx/${index}/params`)}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="sound-card-section">
                <button
                  type="button"
                  className={masterFxRackOpen ? "section-toggle open" : "section-toggle"}
                  onClick={() => setMasterFxRackOpen((prev) => !prev)}
                  aria-expanded={masterFxRackOpen}
                >
                  Master FX Rack
                </button>
                {masterFxRackOpen && (
                  <>
                    <div className="osc-controls" style={{ marginTop: "0.2rem" }}>
                      <label className="waveform-row">
                        <span>Delay Time</span>
                        <select
                          value={song.sendFx.delay.division}
                          onChange={(e) =>
                            applySingleReplace(
                              "/sendFx/delay/division",
                              e.target.value as DelayDivision,
                              "Adjust Delay Division"
                            )
                          }
                        >
                          {DELAY_DIVISIONS.map((division) => (
                            <option key={division} value={division}>
                              {division}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Delay Feedback</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={song.sendFx.delay.feedback}
                          onChange={(e) =>
                            applySingleReplace("/sendFx/delay/feedback", Number(e.target.value), "Adjust Delay Feedback")
                          }
                        />
                        <span>{song.sendFx.delay.feedback.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Delay Tone</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={song.sendFx.delay.tone}
                          onChange={(e) =>
                            applySingleReplace("/sendFx/delay/tone", Number(e.target.value), "Adjust Delay Tone")
                          }
                        />
                        <span>{song.sendFx.delay.tone.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Delay Wet</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={song.sendFx.delay.wet}
                          onChange={(e) =>
                            applySingleReplace("/sendFx/delay/wet", Number(e.target.value), "Adjust Delay Wet")
                          }
                        />
                        <span>{song.sendFx.delay.wet.toFixed(2)}</span>
                      </label>
                    </div>
                    <div className="osc-controls" style={{ marginTop: "0.4rem" }}>
                      <label>
                        <span>Reverb Pre</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={song.sendFx.reverb.preDelay}
                          onChange={(e) =>
                            applySingleReplace(
                              "/sendFx/reverb/preDelay",
                              Number(e.target.value),
                              "Adjust Reverb PreDelay"
                            )
                          }
                        />
                        <span>{song.sendFx.reverb.preDelay.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Reverb Decay</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={song.sendFx.reverb.decay}
                          onChange={(e) =>
                            applySingleReplace("/sendFx/reverb/decay", Number(e.target.value), "Adjust Reverb Decay")
                          }
                        />
                        <span>{song.sendFx.reverb.decay.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Reverb Tone</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={song.sendFx.reverb.tone}
                          onChange={(e) =>
                            applySingleReplace("/sendFx/reverb/tone", Number(e.target.value), "Adjust Reverb Tone")
                          }
                        />
                        <span>{song.sendFx.reverb.tone.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Reverb Wet</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={song.sendFx.reverb.wet}
                          onChange={(e) =>
                            applySingleReplace("/sendFx/reverb/wet", Number(e.target.value), "Adjust Reverb Wet")
                          }
                        />
                        <span>{song.sendFx.reverb.wet.toFixed(2)}</span>
                      </label>
                      <label className="waveform-row">
                        <span>Reverb Eco</span>
                        <input
                          type="checkbox"
                          checked={song.sendFx.reverb.eco}
                          onChange={(e) =>
                            applySingleReplace("/sendFx/reverb/eco", e.target.checked, "Toggle Reverb Eco")
                          }
                        />
                      </label>
                    </div>
                    <div className="osc-controls" style={{ marginTop: "0.4rem" }}>
                      <label className="waveform-row">
                        <span>Eco Mode</span>
                        <input
                          type="checkbox"
                          checked={song.performance.ecoMode}
                          onChange={(e) =>
                            applySingleReplace("/performance/ecoMode", e.target.checked, "Toggle Eco Mode")
                          }
                        />
                      </label>
                      <label className="waveform-row">
                        <span>Master Safety</span>
                        <input
                          type="checkbox"
                          checked={song.masterSafety.enabled}
                          onChange={(e) =>
                            applySingleReplace("/masterSafety/enabled", e.target.checked, "Toggle Master Safety")
                          }
                        />
                      </label>
                      <label>
                        <span>Safety Amt</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={song.masterSafety.amount}
                          onChange={(e) =>
                            applySingleReplace("/masterSafety/amount", Number(e.target.value), "Adjust Master Safety")
                          }
                        />
                        <span>{song.masterSafety.amount.toFixed(2)}</span>
                      </label>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.35rem" }}>
                      {AVAILABLE_FX_TYPES.map((fxType) => (
                        <button key={`master-add-${fxType}`} type="button" onClick={() => addMasterFx(fxType)}>
                          + {FX_TYPE_LABEL[fxType]}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.45rem" }}>
                      {song.masterFx.length === 0 && <span style={{ opacity: 0.7 }}>No master insert FX</span>}
                      {song.masterFx.map((fx, index) => (
                        <div key={fx.id} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "0.5rem", padding: "0.35rem" }}>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr auto auto auto auto",
                              alignItems: "center",
                              gap: "0.35rem",
                            }}
                          >
                            <span>
                              {index + 1}. {FX_TYPE_LABEL[fx.type]} {fx.enabled ? "" : "(bypassed)"}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleFxEnabled(`/masterFx/${index}/enabled`, fx.enabled)}
                            >
                              {fx.enabled ? "Disable" : "Enable"}
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFxItem("/masterFx", index, -1, song.masterFx)}
                              disabled={index === 0}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFxItem("/masterFx", index, 1, song.masterFx)}
                              disabled={index === song.masterFx.length - 1}
                            >
                              Down
                            </button>
                            <button type="button" onClick={() => removeFx(`/masterFx/${index}`)}>
                              Remove
                            </button>
                          </div>
                          {renderFxParamEditor(fx, `/masterFx/${index}/params`)}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
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
                      <label>
                        <span>Sub Mix</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.instrument.subOscMix}
                          onChange={(e) => onParamChange("subOscMix", Number(e.target.value))}
                        />
                        <span>{track.instrument.subOscMix.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Noise</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.instrument.noiseMix}
                          onChange={(e) => onParamChange("noiseMix", Number(e.target.value))}
                        />
                        <span>{track.instrument.noiseMix.toFixed(2)}</span>
                      </label>
                      <label>
                        <span>Width</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.instrument.stereoWidth}
                          onChange={(e) => onParamChange("stereoWidth", Number(e.target.value))}
                        />
                        <span>{track.instrument.stereoWidth.toFixed(2)}</span>
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
                  <>
                    <FilterEqPad
                      cutoff={track.instrument.cutoff}
                      resonance={track.instrument.resonance}
                      onChange={onParamChange}
                    />
                    {track.type === "synth" && (
                      <div className="osc-controls">
                        <label>
                          <span>Env Amt</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={track.instrument.filterEnvAmount}
                            onChange={(e) => onParamChange("filterEnvAmount", Number(e.target.value))}
                          />
                          <span>{track.instrument.filterEnvAmount.toFixed(2)}</span>
                        </label>
                      </div>
                    )}
                  </>
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
 );
}
