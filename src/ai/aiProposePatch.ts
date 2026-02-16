import { JsonPatchOp, PatchMeta, SongState, SynthStep } from "../types/song";

const makePatch = (
  id: string,
  label: string,
  explanation: string,
  ops: JsonPatchOp[],
  auditionBars?: number[]
): PatchMeta => ({
  id,
  author: "ai",
  label,
  explanation,
  ops,
  auditionBars,
});

export interface AiScope {
  selectedTrackId?: string;
  selectedBar?: number;
}

const whiteKeyClasses = new Set([0, 2, 4, 5, 7, 9, 11]);
const isWhiteKey = (pitch: number) => whiteKeyClasses.has(((pitch % 12) + 12) % 12);

const snapToWhiteKey = (pitch: number): number => {
  if (isWhiteKey(pitch)) {
    return pitch;
  }

  let down = pitch - 1;
  let up = pitch + 1;
  while (down >= 0 || up <= 127) {
    if (down >= 0 && isWhiteKey(down)) {
      return down;
    }
    if (up <= 127 && isWhiteKey(up)) {
      return up;
    }
    down -= 1;
    up += 1;
  }
  return pitch;
};

const nextPatternIdFromRecord = (patterns: Record<string, unknown>): string => {
  const maxId = Object.keys(patterns).reduce((max, id) => {
    const n = Number(id);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return String(maxId + 1);
};

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

export const aiProposePatch = (
  prompt: string,
  song: SongState,
  scope: AiScope,
  intensity = 0.5,
  locks?: { [key: string]: boolean }
): PatchMeta[] => {
  const text = prompt.toLowerCase();
  const candidates: PatchMeta[] = [];

  const drumsIndex = song.tracks.findIndex((t) => t.type === "drums");
  const synthIndex = song.tracks.findIndex((t) => t.type === "synth");

  if (text.includes("punch") && drumsIndex >= 0 && !locks?.drums) {
    const drums = song.tracks[drumsIndex];
    const newGain = Math.min(1.2, Number((drums.instrument.gain + 0.12 + intensity * 0.15).toFixed(3)));
    const newDecay = Math.min(0.6, Number((drums.instrument.decay + 0.03 + intensity * 0.05).toFixed(3)));

    candidates.push(
      makePatch("ai-punch", "Punchier Drums", "Boosts drum gain and decay for more impact.", [
        { op: "replace", path: `/tracks/${drumsIndex}/instrument/gain`, value: newGain },
        { op: "replace", path: `/tracks/${drumsIndex}/instrument/decay`, value: newDecay },
      ])
    );
  }

  if (text.includes("lofi") && synthIndex >= 0 && !locks?.tone) {
    const synth = song.tracks[synthIndex];
    const newCutoff = Math.max(300, Math.round(synth.instrument.cutoff * (0.65 - intensity * 0.1)));
    const newLofi = Math.min(1, Number((synth.instrument.lofiAmount + 0.2 + intensity * 0.25).toFixed(2)));

    candidates.push(
      makePatch("ai-lofi", "Lo-fi Tone", "Lowers synth cutoff and increases lo-fi texture amount.", [
        { op: "replace", path: `/tracks/${synthIndex}/instrument/cutoff`, value: newCutoff },
        { op: "replace", path: `/tracks/${synthIndex}/instrument/lofiAmount`, value: newLofi },
      ])
    );
  }

  if (text.includes("swing") && !locks?.timing) {
    const nextSwing = Math.min(0.45, Number((song.swing + 0.08 + intensity * 0.12).toFixed(2)));
    candidates.push(
      makePatch("ai-swing", "Add Swing", "Pushes off-beat steps later for a groovier feel.", [
        { op: "replace", path: "/swing", value: nextSwing },
      ])
    );
  }

  if (text.includes("variation") && synthIndex >= 0 && !locks?.arrangement) {
    const targetBar = Math.min(song.bars - 1, Math.max(8, scope.selectedBar ?? song.bars - 1));
    const synth = song.tracks[synthIndex];
    const sourcePatternId = synth.lane[Math.max(0, targetBar - 1)] ?? "1";
    const sourcePattern = synth.patterns[sourcePatternId];

    if (sourcePattern && sourcePattern.type === "synth") {
      const newPatternId = nextPatternIdFromRecord(synth.patterns);
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

      candidates.push(
        makePatch(
          "ai-variation",
          "Add Variation",
          `Creates a slight melodic variation on bar ${targetBar + 1}.`,
          [
            {
              op: "add",
              path: `/tracks/${synthIndex}/patterns/${newPatternId}`,
              value: {
                type: "synth",
                steps,
              },
            },
            { op: "replace", path: `/tracks/${synthIndex}/lane/${targetBar}`, value: newPatternId },
          ],
          [targetBar]
        )
      );
    }
  }

  if (candidates.length === 0) {
    const selectedTrackIndex = song.tracks.findIndex((t) => t.id === scope.selectedTrackId);
    const target = selectedTrackIndex >= 0 ? selectedTrackIndex : 0;
    const nextGain = Math.min(1.2, Number((song.tracks[target].instrument.gain + 0.08).toFixed(3)));

    candidates.push(
      makePatch(
        "ai-generic",
        "Gentle Lift",
        "Slightly increases gain on the selected track as a neutral enhancement.",
        [{ op: "replace", path: `/tracks/${target}/instrument/gain`, value: nextGain }]
      )
    );
  }

  return candidates.slice(0, 3);
};
