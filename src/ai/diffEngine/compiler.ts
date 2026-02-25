import { createFxInstance } from "../../audio/fx/types";
import { PatchMeta, SongState, SynthPattern } from "../../types/song";
import { CompiledDiffCandidate, DiffPlanCandidate } from "./types";
import { collectAffectedPaths, summarizePatchOps } from "./summarize";

const normalizeOps = (ops: PatchMeta["ops"]): PatchMeta["ops"] => {
  // Keep behavior deterministic but low-risk: collapse identical adjacent operations only.
  const next: PatchMeta["ops"] = [];
  for (const op of ops) {
    const prev = next[next.length - 1];
    if (prev && prev.op === op.op && prev.path === op.path && JSON.stringify(prev.value) === JSON.stringify(op.value)) {
      continue;
    }
    next.push(op);
  }
  return next;
};

export const compileDiffPlanCandidate = (plan: DiffPlanCandidate, song: SongState): CompiledDiffCandidate | null => {
  const warnings: string[] = [];
  const findTrackIndex = (trackId: string) => song.tracks.findIndex((track) => track.id === trackId);

  const compiledOps: PatchMeta["ops"] = [];
  let firstAuditionBars: number[] | undefined;
  let actionLabel: string | undefined;
  let actionExplanation: string | undefined;

  for (let i = 0; i < plan.actions.length; i += 1) {
    const action = plan.actions[i];
    if (!actionLabel && "label" in action) {
      actionLabel = action.label;
    }
    if (!actionExplanation && "explanation" in action) {
      actionExplanation = action.explanation;
    }
    if (action.type === "json_patch") {
      compiledOps.push(...action.ops);
      if (!firstAuditionBars && action.auditionBars) {
        firstAuditionBars = action.auditionBars;
      }
      continue;
    }
    if (action.type === "set_track_param") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for set_track_param (${action.trackId})`);
        continue;
      }
      compiledOps.push({
        op: "replace",
        path: `/tracks/${trackIndex}/instrument/${action.param}`,
        value: action.value,
      });
      continue;
    }
    if (action.type === "set_track_send") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for set_track_send (${action.trackId})`);
        continue;
      }
      compiledOps.push({
        op: "replace",
        path: `/tracks/${trackIndex}/send/${action.send}`,
        value: action.value,
      });
      continue;
    }
    if (action.type === "route_track_send_bus") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for route_track_send_bus (${action.trackId})`);
        continue;
      }
      const key = action.bus === "delay" ? "delayBus" : "reverbBus";
      compiledOps.push({
        op: "replace",
        path: `/tracks/${trackIndex}/send/${key}`,
        value: action.value,
      });
      continue;
    }
    if (action.type === "add_track_insert_fx") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for add_track_insert_fx (${action.trackId})`);
        continue;
      }
      compiledOps.push({
        op: "add",
        path: `/tracks/${trackIndex}/insertFx/-`,
        value: createFxInstance(action.fxType, `${plan.id}-fx-${i}`),
      });
      continue;
    }
    if (action.type === "set_track_insert_fx_param") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for set_track_insert_fx_param (${action.trackId})`);
        continue;
      }
      const fxList = song.tracks[trackIndex]?.insertFx ?? [];
      const fxIndex =
        (action.fxId ? fxList.findIndex((fx) => fx.id === action.fxId) : -1) >= 0
          ? fxList.findIndex((fx) => fx.id === action.fxId)
          : action.fxType
            ? fxList.findIndex((fx) => fx.type === action.fxType)
            : -1;
      if (fxIndex < 0) {
        warnings.push(
          `Insert FX not found for set_track_insert_fx_param (${action.trackId}, ${action.fxId ?? action.fxType ?? "?"})`
        );
        continue;
      }
      const fx = fxList[fxIndex];
      if (!(action.param in (fx.params as unknown as Record<string, unknown>))) {
        warnings.push(`FX param not found (${fx.type}.${action.param})`);
        continue;
      }
      compiledOps.push({
        op: "replace",
        path: `/tracks/${trackIndex}/insertFx/${fxIndex}/params/${action.param}`,
        value: action.value,
      });
      continue;
    }
    if (action.type === "set_drum_step") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for set_drum_step (${action.trackId})`);
        continue;
      }
      const track = song.tracks[trackIndex];
      if (track.type !== "drums") {
        warnings.push(`Track is not drums for set_drum_step (${track.id})`);
        continue;
      }
      if (action.barIndex < 0 || action.barIndex >= track.lane.length) {
        warnings.push(`Bar index out of range for set_drum_step (${action.barIndex})`);
        continue;
      }
      const patternId = track.lane[action.barIndex];
      if (!patternId || patternId === "0") {
        warnings.push(`No assigned pattern at bar ${action.barIndex + 1} for set_drum_step`);
        continue;
      }
      const pattern = track.patterns[patternId];
      if (!pattern || pattern.type !== "drums") {
        warnings.push(`Drum pattern not found (${patternId})`);
        continue;
      }
      if (action.stepIndex < 0 || action.stepIndex >= pattern.steps.length) {
        warnings.push(`Step index out of range for set_drum_step (${action.stepIndex})`);
        continue;
      }
      if (!["kick", "snare", "hat"].includes(action.lane)) {
        warnings.push(`Invalid drum lane for set_drum_step (${String(action.lane)})`);
        continue;
      }
      compiledOps.push({
        op: "replace",
        path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${action.stepIndex}/${action.lane}`,
        value: Math.max(0, Math.min(1, Number.isFinite(action.value) ? action.value : 0)),
      });
      continue;
    }
    if (action.type === "transpose_track_bar_notes") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for transpose_track_bar_notes (${action.trackId})`);
        continue;
      }
      const track = song.tracks[trackIndex];
      if (track.type !== "synth") {
        warnings.push(`Track is not synth for transpose_track_bar_notes (${track.id})`);
        continue;
      }
      if (action.barIndex < 0 || action.barIndex >= track.lane.length) {
        warnings.push(`Bar index out of range for transpose_track_bar_notes (${action.barIndex})`);
        continue;
      }
      const patternId = track.lane[action.barIndex];
      if (!patternId || patternId === "0") {
        warnings.push(`No assigned pattern at bar ${action.barIndex + 1} for transpose_track_bar_notes`);
        continue;
      }
      const pattern = track.patterns[patternId];
      if (!pattern || pattern.type !== "synth") {
        warnings.push(`Synth pattern not found (${patternId})`);
        continue;
      }
      const synthPattern = pattern as SynthPattern;
      const clampMin = Number.isFinite(action.clampMin) ? action.clampMin! : 0;
      const clampMax = Number.isFinite(action.clampMax) ? action.clampMax! : 127;
      let noteCount = 0;
      for (let stepIndex = 0; stepIndex < synthPattern.steps.length; stepIndex += 1) {
        const cell = synthPattern.steps[stepIndex];
        for (let noteIndex = 0; noteIndex < cell.length; noteIndex += 1) {
          const note = cell[noteIndex];
          const nextPitch = Math.max(clampMin, Math.min(clampMax, Math.round(note.pitch + action.semitones)));
          if (nextPitch === note.pitch) {
            continue;
          }
          compiledOps.push({
            op: "replace",
            path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${stepIndex}/${noteIndex}/pitch`,
            value: nextPitch,
          });
          noteCount += 1;
        }
      }
      if (noteCount === 0) {
        warnings.push(`No synth notes changed for transpose_track_bar_notes (${patternId})`);
      }
      continue;
    }
    if (action.type === "copy_track_bar_assignment") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for copy_track_bar_assignment (${action.trackId})`);
        continue;
      }
      const track = song.tracks[trackIndex];
      if (
        action.fromBarIndex < 0 ||
        action.fromBarIndex >= track.lane.length ||
        action.toBarIndex < 0 ||
        action.toBarIndex >= track.lane.length
      ) {
        warnings.push(
          `Bar index out of range for copy_track_bar_assignment (${action.fromBarIndex} -> ${action.toBarIndex})`
        );
        continue;
      }
      compiledOps.push({
        op: "replace",
        path: `/tracks/${trackIndex}/lane/${action.toBarIndex}`,
        value: track.lane[action.fromBarIndex],
      });
      continue;
    }
    if (action.type === "rotate_track_bar_assignments") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for rotate_track_bar_assignments (${action.trackId})`);
        continue;
      }
      const track = song.tracks[trackIndex];
      const start = Math.min(action.fromBarIndex, action.toBarIndex);
      const end = Math.max(action.fromBarIndex, action.toBarIndex);
      if (start < 0 || end >= track.lane.length) {
        warnings.push(`Bar index out of range for rotate_track_bar_assignments (${start}-${end})`);
        continue;
      }
      const segment = track.lane.slice(start, end + 1);
      if (segment.length <= 1) {
        warnings.push("Rotate range too small for rotate_track_bar_assignments");
        continue;
      }
      const rotation = ((Math.round(action.steps) % segment.length) + segment.length) % segment.length;
      if (rotation === 0) {
        warnings.push("No-op rotation for rotate_track_bar_assignments");
        continue;
      }
      const rotated = segment.slice(segment.length - rotation).concat(segment.slice(0, segment.length - rotation));
      for (let offset = 0; offset < rotated.length; offset += 1) {
        if (rotated[offset] === track.lane[start + offset]) {
          continue;
        }
        compiledOps.push({
          op: "replace",
          path: `/tracks/${trackIndex}/lane/${start + offset}`,
          value: rotated[offset],
        });
      }
      continue;
    }
    if (action.type === "set_synth_step_notes_field") {
      const trackIndex = findTrackIndex(action.trackId);
      if (trackIndex < 0) {
        warnings.push(`Track not found for set_synth_step_notes_field (${action.trackId})`);
        continue;
      }
      const track = song.tracks[trackIndex];
      if (track.type !== "synth") {
        warnings.push(`Track is not synth for set_synth_step_notes_field (${track.id})`);
        continue;
      }
      if (action.barIndex < 0 || action.barIndex >= track.lane.length) {
        warnings.push(`Bar index out of range for set_synth_step_notes_field (${action.barIndex})`);
        continue;
      }
      const patternId = track.lane[action.barIndex];
      if (!patternId || patternId === "0") {
        warnings.push(`No assigned pattern at bar ${action.barIndex + 1} for set_synth_step_notes_field`);
        continue;
      }
      const pattern = track.patterns[patternId];
      if (!pattern || pattern.type !== "synth") {
        warnings.push(`Synth pattern not found (${patternId})`);
        continue;
      }
      if (action.stepIndex < 0 || action.stepIndex >= pattern.steps.length) {
        warnings.push(`Step index out of range for set_synth_step_notes_field (${action.stepIndex})`);
        continue;
      }
      const cell = pattern.steps[action.stepIndex];
      if (!Array.isArray(cell) || cell.length === 0) {
        warnings.push(`No synth notes at step ${action.stepIndex + 1} for set_synth_step_notes_field`);
        continue;
      }
      const nextValue =
        action.field === "velocity"
          ? Math.max(0, Math.min(1, Number.isFinite(action.value) ? action.value : 0))
          : Math.max(1, Math.min(16, Math.round(action.value)));
      for (let noteIndex = 0; noteIndex < cell.length; noteIndex += 1) {
        if (cell[noteIndex][action.field] === nextValue) {
          continue;
        }
        compiledOps.push({
          op: "replace",
          path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${action.stepIndex}/${noteIndex}/${action.field}`,
          value: nextValue,
        });
      }
      continue;
    }
  }

  const ops = normalizeOps(compiledOps);
  if (ops.length === 0) {
    return null;
  }

  const label = actionLabel ?? plan.label ?? "AI Patch";
  const explanation = actionExplanation ?? plan.explanation ?? summarizePatchOps(ops);
  const affectedPaths = collectAffectedPaths(ops);

  return {
    patch: {
      id: plan.id,
      author: "ai",
      label,
      explanation,
      ops,
      auditionBars: firstAuditionBars,
    },
    source: plan.source,
    confidence: plan.confidence ?? 0.5,
    affectedPaths,
    warnings,
    opCount: ops.length,
  };
};
