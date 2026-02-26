import { SongState } from "../../types/song";
import { AiPromptContext } from "../providers/types";

const SUPPORTED_CANONICAL_COMMANDS = [
  "tempo <bpm>",
  "swing <percent>%",
  "eco mode on|off",
  "master safety on|off",
  "master safety amount <percent>%",
  "<track> gain <percent>%",
  "lower <track> gain",
  "raise <track> gain",
  "lower <track> gain by <percent>%",
  "raise <track> gain by <percent>%",
  "<track> delay <percent>%",
  "<track> reverb <percent>%",
  "<track> delay bus custom|echo a|echo b",
  "<track> reverb bus custom|room a|hall b",
  "add chorus to <track>",
  "add dj filter to <track>",
  "add saturator to <track>",
  "add eq3 to <track>",
  "copy <track> bar <from> to bar <to>",
  "rotate <track> bars <from>-<to> by <steps>",
  "rotate drum steps by <steps> [in bar <n>]",
  "kick|snare|hat step <n> on|off|<percent>",
  "transpose <track> up|down <semitones> [in bar <n>]",
  "velocity step <n> <percent>% on <track> [in bar <n>]",
  "length step <n> <steps> on <track> [in bar <n>]",
];

const summarizeFxParams = (fx: SongState["tracks"][number]["insertFx"][number]["params"]) => {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(fx)) {
    if (typeof value === "number") {
      out[key] = Math.round(value * 1000) / 1000;
    } else if (typeof value === "string" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
};

const emptySynthSummary = () => ({ activeSteps: [] as number[], noteCount: 0 });
const emptyDrumSummary = () => ({ kickSteps: [] as number[], snareSteps: [] as number[], hatSteps: [] as number[] });

const summarizeSynthPattern = (pattern: Extract<SongState["tracks"][number]["patterns"][string], { type: "synth" }>) => {
  const activeSteps: number[] = [];
  let noteCount = 0;
  let pitchMin = Infinity;
  let pitchMax = -Infinity;
  pattern.steps.forEach((notes, stepIndex) => {
    if (!notes?.length) {
      return;
    }
    activeSteps.push(stepIndex + 1);
    noteCount += notes.length;
    for (const note of notes) {
      pitchMin = Math.min(pitchMin, note.pitch);
      pitchMax = Math.max(pitchMax, note.pitch);
    }
  });
  return {
    activeSteps,
    noteCount,
    ...(Number.isFinite(pitchMin) ? { pitchMin } : {}),
    ...(Number.isFinite(pitchMax) ? { pitchMax } : {}),
  };
};

const summarizeDrumPattern = (pattern: Extract<SongState["tracks"][number]["patterns"][string], { type: "drums" }>) => {
  const kickSteps: number[] = [];
  const snareSteps: number[] = [];
  const hatSteps: number[] = [];
  pattern.steps.forEach((step, stepIndex) => {
    if (step.kick > 0) kickSteps.push(stepIndex + 1);
    if (step.snare > 0) snareSteps.push(stepIndex + 1);
    if (step.hat > 0) hatSteps.push(stepIndex + 1);
  });
  return { kickSteps, snareSteps, hatSteps };
};

const summarizeTrackCurrentBarPattern = (
  song: SongState,
  track: SongState["tracks"][number],
  selectedBar: number
): AiPromptContext["tracks"][number]["currentBarPattern"] => {
  const barIndex = Math.max(0, Math.min(selectedBar, Math.max(0, song.bars - 1)));
  const patternId = track.lane[barIndex] ?? "0";
  if (!patternId || patternId === "0") {
    return {
      barIndex,
      patternId: null,
      type: track.type,
      summary: track.type === "drums" ? emptyDrumSummary() : emptySynthSummary(),
    };
  }
  const pattern = track.patterns[patternId];
  if (!pattern || pattern.type !== track.type) {
    return {
      barIndex,
      patternId,
      type: track.type,
      summary: track.type === "drums" ? emptyDrumSummary() : emptySynthSummary(),
    };
  }
  return {
    barIndex,
    patternId,
    type: track.type,
    summary: pattern.type === "drums" ? summarizeDrumPattern(pattern) : summarizeSynthPattern(pattern),
  };
};

export const buildAiPromptContext = (song: SongState, scope: { selectedTrackId?: string; selectedBar?: number }): AiPromptContext => {
  const selectedTrack = scope.selectedTrackId ? song.tracks.find((track) => track.id === scope.selectedTrackId) : undefined;
  const selectedBar = Math.max(0, Math.min(scope.selectedBar ?? 0, Math.max(0, song.bars - 1)));
  return {
    selectedTrackId: selectedTrack?.id,
    selectedTrackName: selectedTrack?.name,
    selectedTrackType: selectedTrack?.type,
    selectedBar,
    trackNames: song.tracks.map((track) => track.name),
    tracks: song.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      type: track.type,
      currentBarPattern: summarizeTrackCurrentBarPattern(song, track, selectedBar),
      insertFx: track.insertFx.map((fx) => ({
        id: fx.id,
        type: fx.type,
        enabled: fx.enabled,
        params: summarizeFxParams(fx.params),
      })),
    })),
    selectedTrackInsertFx: selectedTrack?.insertFx.map((fx) => ({
      id: fx.id,
      type: fx.type,
      enabled: fx.enabled,
      params: summarizeFxParams(fx.params),
    })),
    selectedTrackCurrentBarPattern: selectedTrack ? summarizeTrackCurrentBarPattern(song, selectedTrack, selectedBar) : undefined,
    supportedCanonicalCommands: SUPPORTED_CANONICAL_COMMANDS,
  };
};
