import { SongState, SynthStep } from "../types/song";

export const normalizeSynthCell = (cell: unknown): SynthStep[] => {
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

const patternHasContent = (pattern: SongState["tracks"][number]["patterns"][string]): boolean => {
  if (pattern.type === "synth") {
    return pattern.steps.some((cell) => normalizeSynthCell(cell).length > 0);
  }
  return pattern.steps.some((step) => step.kick > 0 || step.snare > 0 || step.hat > 0);
};

export const getEffectiveLoopBars = (song: SongState): number => {
  let lastActiveBar = -1;

  for (let bar = 0; bar < song.bars; bar += 1) {
    for (const track of song.tracks) {
      const patternId = track.lane[bar] ?? track.lane[0];
      const pattern = track.patterns[patternId];
      if (pattern && patternHasContent(pattern)) {
        lastActiveBar = Math.max(lastActiveBar, bar);
      }
    }
  }

  if (lastActiveBar >= 0) {
    return Math.max(1, lastActiveBar + 1);
  }
  return Math.max(1, song.bars);
};
