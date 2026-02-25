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
];

export const buildAiPromptContext = (song: SongState, scope: { selectedTrackId?: string; selectedBar?: number }): AiPromptContext => {
  const selectedTrack = scope.selectedTrackId ? song.tracks.find((track) => track.id === scope.selectedTrackId) : undefined;
  return {
    selectedTrackId: selectedTrack?.id,
    selectedTrackName: selectedTrack?.name,
    selectedTrackType: selectedTrack?.type,
    selectedBar: scope.selectedBar,
    trackNames: song.tracks.map((track) => track.name),
    tracks: song.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      type: track.type,
    })),
    supportedCanonicalCommands: SUPPORTED_CANONICAL_COMMANDS,
  };
};

