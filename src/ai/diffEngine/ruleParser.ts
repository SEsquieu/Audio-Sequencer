import { createFxInstance, FxType } from "../../audio/fx/types";
import { DelayBusTargetId, JsonPatchOp, ReverbBusTargetId, SongState } from "../../types/song";
import { DiffEngineRequest, DiffPlanCandidate } from "./types";

const uid = () => `rule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const norm = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bpercent\b/g, "%")
    .replace(/\bvolume\b/g, "gain")
    .replace(/\blevel\b/g, "gain")
    .replace(/\becho\b/g, "delay")
    .replace(/\bverb\b/g, "reverb");

const parsePercentOrUnit = (raw: string): number => {
  const value = Number(raw.replace("%", "").trim());
  if (!Number.isFinite(value)) {
    return NaN;
  }
  return raw.includes("%") || value > 1 ? value / 100 : value;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const findTrackIndex = (song: SongState, text: string, selectedTrackId?: string): number => {
  const hay = norm(text);
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < song.tracks.length; i += 1) {
    const t = song.tracks[i];
    const name = t.name.toLowerCase();
    if (hay.includes(name) && name.length > bestScore) {
      bestIdx = i;
      bestScore = name.length;
    }
    if (hay.includes(t.id.toLowerCase()) && t.id.length > bestScore) {
      bestIdx = i;
      bestScore = t.id.length;
    }
    if (t.type === "drums" && hay.includes("drum") && bestScore < 4) {
      bestIdx = i;
      bestScore = 4;
    }
    if (t.type === "synth" && hay.includes("synth") && bestScore < 5) {
      bestIdx = i;
      bestScore = 5;
    }
  }
  if (bestIdx >= 0) {
    return bestIdx;
  }
  if (selectedTrackId) {
    const selectedIdx = song.tracks.findIndex((t) => t.id === selectedTrackId);
    if (selectedIdx >= 0) {
      return selectedIdx;
    }
  }
  return 0;
};

const wrapPatchCandidate = (
  label: string,
  explanation: string,
  ops: JsonPatchOp[],
  confidence = 0.98
): DiffPlanCandidate => ({
  id: uid(),
  source: "ruleParser",
  confidence,
  label,
  explanation,
  actions: [
    {
      type: "json_patch",
      ops,
      label,
      explanation,
    },
  ],
});

const parseDelayBus = (text: string): DelayBusTargetId | null => {
  if (/\bcustom\b/.test(text)) {
    return "custom";
  }
  if (/\becho ?a\b/.test(text)) {
    return "echoA";
  }
  if (/\becho ?b\b/.test(text)) {
    return "echoB";
  }
  return null;
};

const parseReverbBus = (text: string): ReverbBusTargetId | null => {
  if (/\bcustom\b/.test(text)) {
    return "custom";
  }
  if (/\broom ?a\b/.test(text)) {
    return "roomA";
  }
  if (/\bhall ?b\b/.test(text)) {
    return "hallB";
  }
  return null;
};

const parseFxType = (text: string): FxType | null => {
  if (text.includes("dj filter") || text.includes("djfilter")) {
    return "djFilter";
  }
  if (text.includes("chorus")) {
    return "chorus";
  }
  if (text.includes("saturator") || text.includes("saturation")) {
    return "saturator";
  }
  if (/\beq3\b/.test(text) || /\beq\b/.test(text)) {
    return "eq3";
  }
  return null;
};

export const parseRuleBasedDiffCandidates = (request: DiffEngineRequest): DiffPlanCandidate[] => {
  const text = norm(request.prompt);
  const song = request.song;
  const trackIndex = findTrackIndex(song, text, request.scope.selectedTrackId);
  const track = song.tracks[trackIndex];
  const candidates: DiffPlanCandidate[] = [];

  let match = text.match(/^(?:set )?tempo(?: to)? (\d{2,3})(?: ?bpm)?$/);
  if (match) {
    const tempo = clamp(Math.round(Number(match[1])), 40, 240);
    candidates.push(
      wrapPatchCandidate("Set Tempo", `Set tempo to ${tempo} BPM`, [{ op: "replace", path: "/tempo", value: tempo }], 0.99)
    );
    return candidates;
  }

  match = text.match(/^(?:set )?swing(?: to)? ([\d.]+%?)$/);
  if (match) {
    const swing = clamp(parsePercentOrUnit(match[1]), 0, 0.95);
    if (Number.isFinite(swing)) {
      candidates.push(
        wrapPatchCandidate("Set Swing", `Set swing to ${Math.round(swing * 100)}%`, [
          { op: "replace", path: "/swing", value: swing },
        ])
      );
      return candidates;
    }
  }

  match = text.match(/^(?:set )?eco mode(?: to)? (on|off)$/);
  if (match) {
    const enabled = match[1] === "on";
    candidates.push(
      wrapPatchCandidate(enabled ? "Enable Eco Mode" : "Disable Eco Mode", `Turn eco mode ${enabled ? "on" : "off"}`, [
        { op: "replace", path: "/performance/ecoMode", value: enabled },
      ])
    );
    return candidates;
  }

  match = text.match(/^(?:set )?master safety(?: to)? (on|off)$/);
  if (match) {
    const enabled = match[1] === "on";
    candidates.push(
      wrapPatchCandidate(
        enabled ? "Enable Master Safety" : "Disable Master Safety",
        `Turn master safety ${enabled ? "on" : "off"}`,
        [{ op: "replace", path: "/masterSafety/enabled", value: enabled }]
      )
    );
    return candidates;
  }

  match = text.match(/^(?:set )?master safety(?: amount)?(?: to)? ([\d.]+%?)$/);
  if (match) {
    const amount = clamp(parsePercentOrUnit(match[1]), 0, 1);
    if (Number.isFinite(amount)) {
      candidates.push(
        wrapPatchCandidate("Set Master Safety Amount", `Set master safety amount to ${Math.round(amount * 100)}%`, [
          { op: "replace", path: "/masterSafety/amount", value: amount },
        ])
      );
      return candidates;
    }
  }

  if (track) {
    match = text.match(/^(?:set )?.*?\bgain(?: to)? ([\d.]+%?)$/);
    if (match) {
      const value = clamp(parsePercentOrUnit(match[1]), 0, 1.2);
      if (Number.isFinite(value)) {
        candidates.push(
          wrapPatchCandidate(
            `Set ${track.name} Gain`,
            `Set ${track.name} gain to ${Math.round(value * 100)}%`,
            [{ op: "replace", path: `/tracks/${trackIndex}/instrument/gain`, value }]
          )
        );
        return candidates;
      }
    }

    match = text.match(/^(lower|reduce|decrease|raise|increase|boost|turn up|turn down)\b.*?\bgain(?: by)?(?: to)? ?([\d.]+%?)?$/);
    if (match) {
      const verb = match[1];
      const direction =
        verb === "lower" || verb === "reduce" || verb === "decrease" || verb === "turn down" ? -1 : 1;
      const explicitAmount = match[2] ? parsePercentOrUnit(match[2]) : NaN;
      const delta = Number.isFinite(explicitAmount) ? clamp(explicitAmount, 0.01, 1.2) : 0.1;
      const nextGain = clamp((track.instrument?.gain ?? 0.5) + direction * delta, 0, 1.2);
      candidates.push(
        wrapPatchCandidate(
          `${direction < 0 ? "Lower" : "Raise"} ${track.name} Gain`,
          `${direction < 0 ? "Lower" : "Raise"} ${track.name} gain to ${Math.round(nextGain * 100)}%`,
          [{ op: "replace", path: `/tracks/${trackIndex}/instrument/gain`, value: nextGain }],
          0.97
        )
      );
      return candidates;
    }

    match = text.match(/(?:set )?.*?(delay|reverb)(?: send)?(?: to)? ([\d.]+%?)$/);
    if (match) {
      const kind = match[1] as "delay" | "reverb";
      const value = clamp(parsePercentOrUnit(match[2]), 0, 1);
      if (Number.isFinite(value)) {
        candidates.push(
          wrapPatchCandidate(
            `Set ${track.name} ${kind === "delay" ? "Delay" : "Reverb"} Send`,
            `Set ${track.name} ${kind} send to ${Math.round(value * 100)}%`,
            [{ op: "replace", path: `/tracks/${trackIndex}/send/${kind}`, value }]
          )
        );
        return candidates;
      }
    }

    if (text.includes("delay bus")) {
      const delayBus = parseDelayBus(text);
      if (delayBus) {
        candidates.push(
          wrapPatchCandidate(
            `Route ${track.name} Delay Bus`,
            `Route ${track.name} delay to ${delayBus}`,
            [{ op: "replace", path: `/tracks/${trackIndex}/send/delayBus`, value: delayBus }]
          )
        );
        return candidates;
      }
    }

    if (text.includes("reverb bus")) {
      const reverbBus = parseReverbBus(text);
      if (reverbBus) {
        candidates.push(
          wrapPatchCandidate(
            `Route ${track.name} Reverb Bus`,
            `Route ${track.name} reverb to ${reverbBus}`,
            [{ op: "replace", path: `/tracks/${trackIndex}/send/reverbBus`, value: reverbBus }]
          )
        );
        return candidates;
      }
    }

    if (/^(?:add|insert) /.test(text) && (text.includes(" to ") || text.includes(" on "))) {
      const fxType = parseFxType(text);
      if (fxType) {
        candidates.push(
          wrapPatchCandidate(
            `Add ${fxType} FX`,
            `Add ${fxType} insert FX to ${track.name}`,
            [{ op: "add", path: `/tracks/${trackIndex}/insertFx/-`, value: createFxInstance(fxType, uid()) }],
            0.96
          )
        );
        return candidates;
      }
    }
  }

  return candidates;
};
