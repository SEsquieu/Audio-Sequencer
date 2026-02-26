import { clamp01, createFxInstance, FxType } from "../../audio/fx/types";
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

const parseFxParamValue = (fxType: FxType, param: string, raw: string): number | string | null => {
  if (fxType === "chorus") {
    if (param === "rate") {
      const v = Number(raw.replace("%", ""));
      return Number.isFinite(v) ? clamp(v, 0.01, 8) : null;
    }
    if (param === "depth" || param === "mix") {
      const v = parsePercentOrUnit(raw);
      return Number.isFinite(v) ? clamp01(v) : null;
    }
  }
  if (fxType === "djFilter") {
    if (param === "mode") {
      if (/^hp|high ?pass$/.test(raw)) return "hp";
      if (/^lp|low ?pass$/.test(raw)) return "lp";
      return null;
    }
    if (param === "cutoff" || param === "q") {
      const v = parsePercentOrUnit(raw);
      return Number.isFinite(v) ? clamp01(v) : null;
    }
  }
  if (fxType === "saturator") {
    if (param === "drive" || param === "mix") {
      const v = parsePercentOrUnit(raw);
      return Number.isFinite(v) ? clamp01(v) : null;
    }
    if (param === "output") {
      const v = parsePercentOrUnit(raw);
      return Number.isFinite(v) ? clamp(v, 0, 2) : null;
    }
  }
  if (fxType === "eq3") {
    if (param === "low" || param === "mid" || param === "high") {
      const v = Number(raw.replace("db", "").replace("%", "").trim());
      if (!Number.isFinite(v)) return null;
      return raw.includes("%") ? clamp((v / 100) * 24, -24, 24) : clamp(v, -24, 24);
    }
  }
  return null;
};

const findTrackFxIndex = (song: SongState, trackIndex: number, fxType: FxType): number =>
  song.tracks[trackIndex]?.insertFx.findIndex((fx) => fx.type === fxType) ?? -1;

const parseStepValue = (raw: string): number | null => {
  const t = raw.trim();
  if (/^(on|full|max)$/.test(t)) return 1;
  if (/^(off|mute|none)$/.test(t)) return 0;
  const n = parsePercentOrUnit(t);
  return Number.isFinite(n) ? clamp(n, 0, 1) : null;
};

const parseBarIndex1 = (raw: string, max: number): number => clamp(Math.round(Number(raw)) - 1, 0, Math.max(0, max));

const NOTE_TO_SEMITONE: Record<string, number> = {
  c: 0,
  "c#": 1,
  db: 1,
  d: 2,
  "d#": 3,
  eb: 3,
  e: 4,
  f: 5,
  "f#": 6,
  gb: 6,
  g: 7,
  "g#": 8,
  ab: 8,
  a: 9,
  "a#": 10,
  bb: 10,
  b: 11,
};

const parsePitchToken = (raw: string): number | null => {
  const token = raw.trim().toLowerCase();
  if (/^\d{1,3}$/.test(token)) {
    const n = Math.round(Number(token));
    return Number.isFinite(n) ? clamp(n, 0, 127) : null;
  }
  const match = token.match(/^([a-g])([#b]?)(-?\d)$/);
  if (!match) {
    return null;
  }
  const noteName = `${match[1]}${match[2] || ""}`;
  const semitone = NOTE_TO_SEMITONE[noteName];
  const octave = Number(match[3]);
  if (!Number.isFinite(semitone) || !Number.isFinite(octave)) {
    return null;
  }
  return clamp((octave + 1) * 12 + semitone, 0, 127);
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

  match = text.match(/^(?:(?:set )?eco mode(?: to)? (on|off)|(?:enable|disable) eco mode)$/);
  if (match) {
    const enabled = (match[1] ?? "").toLowerCase() === "on" || text.startsWith("enable eco mode");
    candidates.push(
      wrapPatchCandidate(enabled ? "Enable Eco Mode" : "Disable Eco Mode", `Turn eco mode ${enabled ? "on" : "off"}`, [
        { op: "replace", path: "/performance/ecoMode", value: enabled },
      ])
    );
    return candidates;
  }

  match = text.match(/^(?:(?:set )?master safety(?: to)? (on|off)|(?:enable|disable) master safety)$/);
  if (match) {
    const enabled = (match[1] ?? "").toLowerCase() === "on" || text.startsWith("enable master safety");
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
    match = text.match(/^(copy|duplicate)\s+.+?\s+bar\s+(\d{1,3})\s+(?:to|into)\s+bar\s+(\d{1,3})$/);
    if (!match) {
      match = text.match(/^(copy|duplicate)\s+bar\s+(\d{1,3})\s+(?:to|into)\s+bar\s+(\d{1,3})\s+(?:on\s+)?(.+)$/);
    }
    if (match) {
      const fromBarIndex = parseBarIndex1(match[2], track.lane.length - 1);
      const toBarIndex = parseBarIndex1(match[3], track.lane.length - 1);
      candidates.push(
        wrapPatchCandidate(
          `Copy ${track.name} Bar`,
          `Copy ${track.name} bar ${fromBarIndex + 1} to bar ${toBarIndex + 1}`,
          [{ op: "replace", path: `/tracks/${trackIndex}/lane/${toBarIndex}`, value: track.lane[fromBarIndex] }],
          0.98
        )
      );
      return candidates;
    }

    match = text.match(/^(rotate|shift)\s+.+?\s+bars\s+(\d{1,3})\s*-\s*(\d{1,3})\s+by\s+(-?\d{1,3})$/);
    if (!match) {
      match = text.match(/^(rotate|shift)\s+bars\s+(\d{1,3})\s*-\s*(\d{1,3})\s+by\s+(-?\d{1,3})\s+(?:on\s+)?(.+)$/);
    }
    if (match) {
      const start = parseBarIndex1(match[2], track.lane.length - 1);
      const end = parseBarIndex1(match[3], track.lane.length - 1);
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      const segment = track.lane.slice(lo, hi + 1);
      if (segment.length > 1) {
        const steps = Math.round(Number(match[4]));
        const rot = ((steps % segment.length) + segment.length) % segment.length;
        if (rot > 0) {
          const rotated = segment.slice(segment.length - rot).concat(segment.slice(0, segment.length - rot));
          const ops: JsonPatchOp[] = [];
          rotated.forEach((value, idx) => {
            if (value !== track.lane[lo + idx]) {
              ops.push({ op: "replace", path: `/tracks/${trackIndex}/lane/${lo + idx}`, value });
            }
          });
          if (ops.length > 0) {
            candidates.push(
              wrapPatchCandidate(
                `Rotate ${track.name} Bars (Arrangement)`,
                `Rotate ${track.name} bar assignments ${lo + 1}-${hi + 1} by ${steps}`,
                ops,
                0.97
              )
            );
            return candidates;
          }
        }
      }
    }

    match = text.match(
      /^(?:(add|remove|delete|turn on|turn off)\s+)?(kick|snare|hat)\s+(?:at\s+)?step\s+(\d{1,2})(?:\s+(on|off|[\d.]+%?))?(?:\s+(?:in|on)\s+bar\s+(\d{1,3}))?$/
    );
    if (!match) {
      match = text.match(
        /^(?:turn\s+)?(kick|snare|hat)\s+(on|off)\s+(?:at\s+)?(?:step\s+)?(\d{1,2})(?:\s+(?:in|on)\s+bar\s+(\d{1,3}))?$/
      );
      if (match) {
        match = [match[0], `turn ${match[2]}`, match[1], match[3], match[2], match[4]] as RegExpMatchArray;
      }
    }
    if (match && track.type === "drums") {
      const verb = match[1] ?? null;
      const lane = match[2] as "kick" | "snare" | "hat";
      const stepIndex = clamp(Math.round(Number(match[3])) - 1, 0, 15);
      const rawValue =
        match[4] ??
        (verb === "add" || verb === "turn on"
          ? "on"
          : verb === "remove" || verb === "delete" || verb === "turn off"
            ? "off"
            : "");
      const stepValue = rawValue ? parseStepValue(rawValue) : null;
      const barIndex = clamp(
        (match[5] ? Math.round(Number(match[5])) - 1 : request.scope.selectedBar ?? 0),
        0,
        Math.max(0, track.lane.length - 1)
      );
      const patternId = track.lane[barIndex];
      if (stepValue !== null && patternId && patternId !== "0") {
        candidates.push(
          wrapPatchCandidate(
            `Set ${track.name} ${lane} Step`,
            `Set ${lane} step ${stepIndex + 1} in bar ${barIndex + 1}`,
            [
              {
                op: "replace",
                path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${stepIndex}/${lane}`,
                value: stepValue,
              },
            ],
            0.98
          )
        );
        return candidates;
      }
    }

    match = text.match(
      /^(?:rotate|shift)\s+(?:drum\s+)?(?:pattern\s+)?steps\s+by\s+(-?\d{1,2})(?:\s+(?:in|on)\s+bar\s+(\d{1,3}))?$/
    );
    if (!match) {
      match = text.match(
        /^(?:rotate|shift)\s+(?:drums?|drum\s+pattern)\s+(?:in\s+bar|bar)\s+(\d{1,3})\s+by\s+(-?\d{1,2})$/
      );
      if (match) {
        match = [match[0], match[2], match[1]] as RegExpMatchArray;
      }
    }
    if (match && track.type === "drums") {
      const steps = Math.round(Number(match[1]));
      const barIndex = clamp(
        (match[2] ? Math.round(Number(match[2])) - 1 : request.scope.selectedBar ?? 0),
        0,
        Math.max(0, track.lane.length - 1)
      );
      const patternId = track.lane[barIndex];
      const pattern = patternId && patternId !== "0" ? track.patterns[patternId] : null;
      if (pattern && pattern.type === "drums" && pattern.steps.length > 1) {
        const rotation = ((steps % pattern.steps.length) + pattern.steps.length) % pattern.steps.length;
        if (rotation > 0) {
          const rotated = pattern.steps
            .slice(pattern.steps.length - rotation)
            .concat(pattern.steps.slice(0, pattern.steps.length - rotation));
          const ops: JsonPatchOp[] = [];
          rotated.forEach((step, idx) => {
            const curr = pattern.steps[idx];
            if (
              curr.kick !== step.kick ||
              curr.snare !== step.snare ||
              curr.hat !== step.hat
            ) {
              ops.push({
                op: "replace",
                path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${idx}`,
                value: step,
              });
            }
          });
          if (ops.length > 0) {
            candidates.push(
              wrapPatchCandidate(
                `Rotate ${track.name} Pattern Steps`,
                `Rotate ${track.name} drum steps in bar ${barIndex + 1} by ${steps}`,
                ops,
                0.97
              )
            );
            return candidates;
          }
        }
      }
    }

    match = text.match(/^(?:transpose\s+)?(.+?)\s+(up|down)\s+(\d{1,2})(?:\s+(?:in|on)\s+bar\s+(\d{1,3}))?$/);
    if (match && track.type === "synth") {
      const dir = match[2] === "down" ? -1 : 1;
      const semitones = clamp(Math.round(Number(match[3])) * dir, -24, 24);
      const barIndex = clamp(
        (match[4] ? Math.round(Number(match[4])) - 1 : request.scope.selectedBar ?? 0),
        0,
        Math.max(0, track.lane.length - 1)
      );
      const patternId = track.lane[barIndex];
      const pattern = patternId && patternId !== "0" ? track.patterns[patternId] : null;
      if (pattern && pattern.type === "synth") {
        const ops: JsonPatchOp[] = [];
        pattern.steps.forEach((cell, stepIdx) => {
          cell.forEach((note, noteIdx) => {
            const nextPitch = clamp(Math.round(note.pitch + semitones), 0, 127);
            if (nextPitch !== note.pitch) {
              ops.push({
                op: "replace",
                path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${stepIdx}/${noteIdx}/pitch`,
                value: nextPitch,
              });
            }
          });
        });
        if (ops.length > 0) {
          candidates.push(
            wrapPatchCandidate(
              `Transpose ${track.name} Bar`,
              `Transpose ${track.name} bar ${barIndex + 1} by ${semitones} semitones`,
              ops,
              0.97
            )
          );
          return candidates;
        }
      }
    }

    match = text.match(/^(velocity|length)\s+step\s+(\d{1,2})\s+([\d.]+%?)\s+(?:on|to)\s+.+?(?:\s+(?:in|on)\s+bar\s+(\d{1,3}))?$/);
    if (match && track.type === "synth") {
      const field = match[1] as "velocity" | "length";
      const stepIndex = clamp(Math.round(Number(match[2])) - 1, 0, 15);
      const barIndex = clamp(
        (match[4] ? Math.round(Number(match[4])) - 1 : request.scope.selectedBar ?? 0),
        0,
        Math.max(0, track.lane.length - 1)
      );
      const patternId = track.lane[barIndex];
      const pattern = patternId && patternId !== "0" ? track.patterns[patternId] : null;
      if (pattern && pattern.type === "synth") {
        const nextValue =
          field === "velocity"
            ? (() => {
                const n = parsePercentOrUnit(match![3]);
                return Number.isFinite(n) ? clamp(n, 0, 1) : null;
              })()
            : (() => {
                const n = Number(match![3].replace("%", ""));
                return Number.isFinite(n) ? clamp(Math.round(n), 1, 16) : null;
              })();
        if (nextValue !== null) {
          const cell = pattern.steps[stepIndex];
          const ops: JsonPatchOp[] = [];
          cell.forEach((note, noteIdx) => {
            if (note[field] !== nextValue) {
              ops.push({
                op: "replace",
                path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${stepIndex}/${noteIdx}/${field}`,
                value: nextValue,
              });
            }
          });
          if (ops.length > 0) {
            candidates.push(
              wrapPatchCandidate(
                `Set ${track.name} ${field}`,
                `Set ${field} on ${track.name} step ${stepIndex + 1} in bar ${barIndex + 1}`,
                ops,
                0.97
              )
            );
            return candidates;
          }
        }
      }
    }

    match = text.match(
      /^(?:set|move)\s+note\s+([a-g][#b]?-?\d|\d{1,3})\s+to\s+([a-g][#b]?-?\d|\d{1,3})\s+(?:at\s+)?step\s+(\d{1,2})(?:\s+(?:on|to)\s+.+?)?(?:\s+(?:in|on)\s+bar\s+(\d{1,3}))?$/
    );
    if (match && track.type === "synth") {
      const fromPitch = parsePitchToken(match[1]);
      const toPitch = parsePitchToken(match[2]);
      const stepIndex = clamp(Math.round(Number(match[3])) - 1, 0, 15);
      const barIndex = clamp(
        (match[4] ? Math.round(Number(match[4])) - 1 : request.scope.selectedBar ?? 0),
        0,
        Math.max(0, track.lane.length - 1)
      );
      const patternId = track.lane[barIndex];
      const pattern = patternId && patternId !== "0" ? track.patterns[patternId] : null;
      if (pattern && pattern.type === "synth" && fromPitch !== null && toPitch !== null) {
        const cell = pattern.steps[stepIndex] ?? [];
        const noteIndex = cell.findIndex((note) => Math.round(note.pitch) === fromPitch);
        if (noteIndex >= 0 && !cell.some((note, idx) => idx !== noteIndex && Math.round(note.pitch) === toPitch)) {
          candidates.push(
            wrapPatchCandidate(
              `Retune ${track.name} Note`,
              `Move note ${fromPitch} to ${toPitch} on ${track.name} step ${stepIndex + 1} in bar ${barIndex + 1}`,
              [
                {
                  op: "replace",
                  path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${stepIndex}/${noteIndex}/pitch`,
                  value: toPitch,
                },
              ],
              0.97
            )
          );
          return candidates;
        }
      }
    }

    match = text.match(
      /^(add|remove|delete)\s+note\s+([a-g][#b]?-?\d|\d{1,3})\s+(?:at\s+)?step\s+(\d{1,2})(?:\s+(?:on|to)\s+.+?)?(?:\s+(?:in|on)\s+bar\s+(\d{1,3}))?(?:\s+len(?:gth)?\s+(\d{1,2}))?(?:\s+vel(?:ocity)?\s+([\d.]+%?))?$/
    );
    if (match && track.type === "synth") {
      const mode = match[1];
      const pitch = parsePitchToken(match[2]);
      const stepIndex = clamp(Math.round(Number(match[3])) - 1, 0, 15);
      const barIndex = clamp(
        (match[4] ? Math.round(Number(match[4])) - 1 : request.scope.selectedBar ?? 0),
        0,
        Math.max(0, track.lane.length - 1)
      );
      const patternId = track.lane[barIndex];
      const pattern = patternId && patternId !== "0" ? track.patterns[patternId] : null;
      if (pattern && pattern.type === "synth" && pitch !== null) {
        const cell = pattern.steps[stepIndex] ?? [];
        if (mode === "add") {
          const length = match[5] ? clamp(Math.round(Number(match[5])), 1, 16) : 1;
          const velocity = match[6] ? clamp(parsePercentOrUnit(match[6]), 0, 1) : 1;
          if (Number.isFinite(velocity)) {
            const duplicate = cell.some((note) => note.pitch === pitch && note.length === length && note.velocity === velocity);
            if (!duplicate) {
              candidates.push(
                wrapPatchCandidate(
                  `Add ${track.name} Note`,
                  `Add note ${pitch} to ${track.name} step ${stepIndex + 1} in bar ${barIndex + 1}`,
                  [{ op: "add", path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${stepIndex}/-`, value: { pitch, length, velocity } }],
                  0.97
                )
              );
              return candidates;
            }
          }
        } else {
          const noteIndex = cell.findIndex((note) => Math.round(note.pitch) === pitch);
          if (noteIndex >= 0) {
            candidates.push(
              wrapPatchCandidate(
                `Remove ${track.name} Note`,
                `Remove note ${pitch} from ${track.name} step ${stepIndex + 1} in bar ${barIndex + 1}`,
                [{ op: "remove", path: `/tracks/${trackIndex}/patterns/${patternId}/steps/${stepIndex}/${noteIndex}` }],
                0.97
              )
            );
            return candidates;
          }
        }
      }
    }

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

    match = text.match(/^(?:set )?(chorus|dj ?filter|djfilter|saturator|eq3|eq)\s+(mix|rate|depth|cutoff|q|mode|drive|output|low|mid|high)\s+([a-z0-9.% -]+?)(?:\s+(?:on|to)\s+.+)?$/);
    if (match) {
      const fxType = parseFxType(match[1]);
      const rawParam = match[2];
      const param =
        fxType === "djFilter" && rawParam === "q"
          ? "q"
          : rawParam;
      if (fxType) {
        const fxIndex = findTrackFxIndex(song, trackIndex, fxType);
        if (fxIndex >= 0) {
          const parsedValue = parseFxParamValue(fxType, param, match[3].trim());
          if (parsedValue !== null) {
            candidates.push(
              wrapPatchCandidate(
                `Set ${track.name} ${fxType} ${param}`,
                `Set ${track.name} ${fxType} ${param}`,
                [
                  {
                    op: "replace",
                    path: `/tracks/${trackIndex}/insertFx/${fxIndex}/params/${param}`,
                    value: parsedValue,
                  },
                ],
                0.97
              )
            );
            return candidates;
          }
        }
      }
    }
  }

  return candidates;
};
