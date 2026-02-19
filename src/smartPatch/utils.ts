import { SynthStep } from "../types/song";

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const nextPatternIdFromRecord = (patterns: Record<string, unknown>): string => {
  const maxId = Object.keys(patterns).reduce((max, id) => {
    const n = Number(id);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
  return String(maxId + 1);
};

const whiteKeyClasses = new Set([0, 2, 4, 5, 7, 9, 11]);
const isWhiteKey = (pitch: number) => whiteKeyClasses.has(((pitch % 12) + 12) % 12);

export const snapToWhiteKey = (pitch: number): number => {
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

