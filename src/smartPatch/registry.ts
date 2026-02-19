import { JsonPatchOp, SongState } from "../types/song";
import { SmartPatchHandler, SmartPatchIntent, SmartPatchProposal } from "./types";
import { clamp, nextPatternIdFromRecord, normalizeSynthCell, snapToWhiteKey } from "./utils";

const makeProposal = (
  id: string,
  label: string,
  explanation: string,
  ops: JsonPatchOp[],
  intent: SmartPatchIntent,
  knobs: SmartPatchProposal["knobs"],
  auditionBars?: number[]
): SmartPatchProposal => ({
  id,
  label,
  explanation,
  ops,
  auditionBars,
  action: intent.action,
  scope: intent.scope,
  knobs,
});

const resolveTrack = (song: SongState, trackIndex?: number) => {
  if (typeof trackIndex !== "number") {
    return null;
  }
  if (trackIndex < 0 || trackIndex >= song.tracks.length) {
    return null;
  }
  return { track: song.tracks[trackIndex], trackIndex };
};

const punchierDrumsHandler: SmartPatchHandler = (intent, ctx) => {
  const resolved = resolveTrack(ctx.song, intent.scope.trackIndex);
  if (!resolved || resolved.track.type !== "drums") {
    return null;
  }

  const nextGain = clamp(
    Number((resolved.track.instrument.gain + 0.12 + intent.intensity * 0.15).toFixed(3)),
    0,
    1.2
  );
  const nextDecay = clamp(
    Number((resolved.track.instrument.decay + 0.03 + intent.intensity * 0.05).toFixed(3)),
    0,
    0.6
  );

  return makeProposal(
    "ai-punch",
    "Punchier Drums",
    "Boosts drum gain and decay for more impact.",
    [
      { op: "replace", path: `/tracks/${resolved.trackIndex}/instrument/gain`, value: nextGain },
      { op: "replace", path: `/tracks/${resolved.trackIndex}/instrument/decay`, value: nextDecay },
    ],
    intent,
    ["drums.gain", "drums.decay"]
  );
};

const lofiToneHandler: SmartPatchHandler = (intent, ctx) => {
  const resolved = resolveTrack(ctx.song, intent.scope.trackIndex);
  if (!resolved || resolved.track.type !== "synth") {
    return null;
  }

  const nextCutoff = clamp(Math.round(resolved.track.instrument.cutoff * (0.65 - intent.intensity * 0.1)), 300, 12000);
  const nextLofi = clamp(
    Number((resolved.track.instrument.lofiAmount + 0.2 + intent.intensity * 0.25).toFixed(2)),
    0,
    1
  );

  return makeProposal(
    "ai-lofi",
    "Lo-fi Tone",
    "Lowers synth cutoff and increases lo-fi texture amount.",
    [
      { op: "replace", path: `/tracks/${resolved.trackIndex}/instrument/cutoff`, value: nextCutoff },
      { op: "replace", path: `/tracks/${resolved.trackIndex}/instrument/lofiAmount`, value: nextLofi },
    ],
    intent,
    ["synth.cutoff", "synth.lofiAmount"]
  );
};

const addSwingHandler: SmartPatchHandler = (intent, ctx) => {
  const nextSwing = clamp(Number((ctx.song.swing + 0.08 + intent.intensity * 0.12).toFixed(2)), 0, 0.45);
  return makeProposal(
    "ai-swing",
    "Add Swing",
    "Pushes off-beat steps later for a groovier feel.",
    [{ op: "replace", path: "/swing", value: nextSwing }],
    intent,
    ["song.swing"]
  );
};

const addVariationHandler: SmartPatchHandler = (intent, ctx) => {
  const resolved = resolveTrack(ctx.song, intent.scope.trackIndex);
  const targetBar = intent.scope.bar ?? ctx.selectedBar ?? ctx.song.bars - 1;
  if (!resolved || resolved.track.type !== "synth") {
    return null;
  }
  if (targetBar < 0 || targetBar >= ctx.song.bars) {
    return null;
  }

  const sourcePatternId = resolved.track.lane[Math.max(0, targetBar - 1)] ?? "1";
  const sourcePattern = resolved.track.patterns[sourcePatternId];
  if (!sourcePattern || sourcePattern.type !== "synth") {
    return null;
  }

  const newPatternId = nextPatternIdFromRecord(resolved.track.patterns);
  const steps = sourcePattern.steps.map((step, idx) => {
    const notes = normalizeSynthCell(step);
    if (notes.length === 0) {
      return [];
    }
    if (idx === 6) {
      return notes.map((note) => ({ ...note, pitch: snapToWhiteKey(note.pitch + 2) }));
    }
    if (idx === 14) {
      return notes.map((note) => ({ ...note, pitch: snapToWhiteKey(note.pitch - 3) }));
    }
    return notes;
  });

  return makeProposal(
    "ai-variation",
    "Add Variation",
    `Creates a slight melodic variation on bar ${targetBar + 1}.`,
    [
      {
        op: "add",
        path: `/tracks/${resolved.trackIndex}/patterns/${newPatternId}`,
        value: {
          type: "synth",
          steps,
        },
      },
      { op: "replace", path: `/tracks/${resolved.trackIndex}/lane/${targetBar}`, value: newPatternId },
    ],
    intent,
    ["variation.pitchShiftA", "variation.pitchShiftB"],
    [targetBar]
  );
};

const gentleLiftHandler: SmartPatchHandler = (intent, ctx) => {
  const resolved = resolveTrack(ctx.song, intent.scope.trackIndex);
  if (!resolved) {
    return null;
  }

  const nextGain = clamp(Number((resolved.track.instrument.gain + 0.08).toFixed(3)), 0, 1.2);
  return makeProposal(
    "ai-generic",
    "Gentle Lift",
    "Slightly increases gain on the selected track as a neutral enhancement.",
    [{ op: "replace", path: `/tracks/${resolved.trackIndex}/instrument/gain`, value: nextGain }],
    intent,
    ["track.gain"]
  );
};

export const SMART_PATCH_REGISTRY: Record<SmartPatchIntent["action"], SmartPatchHandler> = {
  punchier_drums: punchierDrumsHandler,
  lofi_tone: lofiToneHandler,
  add_swing: addSwingHandler,
  add_variation: addVariationHandler,
  gentle_lift: gentleLiftHandler,
};
