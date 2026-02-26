# AI / Smart Patch Command Cheat Sheet

Practical prompt forms that:

- reliably hit the deterministic parser (`ruleParser`)
- and are also good targets for local-model translation (Ollama, etc.)

Use this as a quick reference while prompting. Keep prompts short and concrete.

## Quick Rules (High Success)

- Best practice: use an explicit track prefix to override scope:
  - `drums: ...`
  - `lead: ...`
  - `bass: ...`
- If you do not use a prefix or explicit track name, select the target track first.
- Prefer concrete verbs + values: `add`, `remove`, `set`, `lower`, `raise`.
- For note edits, use this order for best results:
  - `... on <track> in bar <n>`
- Use explicit units when possible:
  - `%`, `bar`, `step`

## Track Scope Override Prefix (Recommended)

Use `<track>:` at the start of the prompt to directly target a track regardless of current focus.

- `drums: kick step 2 on`
- `lead: add chorus`
- `bass: lower gain 10%`
- `lead: add note c4 step 3 in bar 3`

This is the most reliable form for both the parser and local-model translation.

## Global / Master

- `tempo 128`
- `swing 20%`
- `eco mode on`
- `eco mode off`
- `master safety on`
- `master safety off`
- `master safety amount 10%`

## Track Gain / Volume

- `lower bass gain`
- `raise lead gain by 5%`
- `set bass gain 40%`
- `lower drum gain by 10%`

## Sends / Bus Routing

- `lead delay 40%`
- `lead reverb 25%`
- `lead delay bus echo b`
- `lead reverb bus hall b`
- `set drum delay to 100%`

## Insert FX (Add / Toggle / Params)

- `add chorus to lead`
- `add dj filter to bass`
- `add saturator to lead`
- `chorus mix 30 on lead`
- `chorus depth 50 on lead`
- `chorus rate 0.8 on lead`
- `dj filter cutoff 20 on bass`
- `dj filter q 40 on bass`
- `dj filter mode hp on bass`
- `saturator drive 35 on lead`
- `eq3 high -6 on drums`

## Drum Step Edits (Single Step)

- `kick step 1 on`
- `snare step 13 off`
- `hat step 7 40%`
- `add kick step 1`
- `remove kick step 1`
- `delete snare step 5`
- `turn kick off at 3`
- `turn snare on step 5`

Notes:

- These are effectively track-scoped. Prefer `drums: ...` when you're not focused on the drum track.
- While playing, `Live-Safe While Playing` can hide some pattern/arrangement proposals.

## Drum Step Edits (Multi-Step / Multi-Lane)

- `kick on step 1 and 9`
- `kick on step 1, 5, 9, 13`
- `kick snare hat step 5 on drums`
- `kick and snare step 5 on`
- `kick snare on step 5 and 13`
- `kick and hat on step 1, 9`
- `kick snare hat off step 5 in bar 2`

These should produce one auditionable patch (single proposal) for the combined edits.

## Groove Macros (Deterministic)

- `4 on the floor kick`
- `four on the floor kick`
- `4otf`
- `4otf kick`
- `backbeat snare`
- `eighth hats`
- `8th hats`
- `offbeat hats`
- `16th hats`

Optional bar targeting:

- `4otf in bar 3`
- `backbeat snare in bar 2`
- `eighth hats in bar 4`

## Arrangement (Bar Assignments)

- `copy drums bar 1 to bar 5`
- `copy bar 1 into bar 5 on drums`
- `duplicate drums bar 1 into bar 5`
- `rotate drums bars 1-4 by 1`
- `rotate bars 1-4 by 1 on drums`

Important:

- `rotate bars ...` rotates bar assignments (which pattern each bar points to), not steps inside a pattern.

## Drum Pattern Rotation (Within a Bar Pattern)

- `rotate drum steps by 1`
- `rotate drum pattern steps by -2 in bar 3`
- `rotate drums in bar 2 by 1`

## Synth Pattern Transforms

- `transpose lead up 2`
- `transpose bass down 12 in bar 2`
- `velocity step 1 80% on lead`
- `length step 5 4 on lead`

## Note Editing (Synth) - Reliable Forms

### Add / Remove Notes

- `add note 60 step 1 on lead`
- `add note c4 step 1 on lead`
- `add note g4 step 5 on lead len 2 vel 70%`
- `add note c4 to step 3 in bar 3 on lead`
- `remove note 60 step 1 on lead`
- `remove note c4 step 1 on lead`

### Retune Notes

- `set note c4 to d4 step 1 on lead`
- `move note 60 to 62 step 5 on lead in bar 2`

### Polyphonic Step Targeting

- `set second note c4 to d4 step 1 on lead`
- `remove second note e4 step 1 on lead`
- `set note 2 at step 1 to d4 on lead`
- `remove note 2 at step 1 on lead`

## Local-Model Friendly Prompting Tips

Good (likely to succeed):

- `drums: kick step 2 on`
- `lead: add note c4 step 3 in bar 3`
- `put a chorus on the lead`
- `give bass 20 percent reverb`
- `send lead delay to echo b`
- `lower bass gain`
- `add note c4 to step 3 in bar 3 on lead`

Avoid (likely to drift/fallback):

- grammar/meta syntax like `kick|snare|hat step 5 on`
- placeholder syntax like `<track>` / `<step>`
- vague taste-only prompts if you want deterministic results:
  - `make it warmer`
  - `more emotional`

## Troubleshooting

- No proposal while playing:
  - turn off `Live-Safe While Playing` for pattern/arrangement edits
- Proposal hidden:
  - check `Selected Track Only`
- Model keeps missing:
  - use one of the exact forms above to hit the parser directly
- Note edit in bar N fails:
  - confirm the target track has a pattern assigned in that bar
