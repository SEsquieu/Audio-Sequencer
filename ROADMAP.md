# Roadmap / Source of Truth

This file is the project planning source of truth for major phases, current focus, and planned features.

Use this alongside:

- `KNOWN_BUGS.md` for triaged defects and polish issues
- Git commit history for implementation breadcrumbs

Last updated: 2026-02-26

## Product Direction

Build a browser-based sequencer with:

- strong deterministic audio/editing behavior
- musical sound design and FX workflow
- reversible patch-based editing
- local-first AI-assisted editing that can optionally route to external providers

## Current Phase (As of 2026-02-26)

`Phase F planning / alignment (Provider UX + stability hardening)`

Current emphasis:

- lock Phase F scope and success criteria before implementation
- preserve Phase E gains while shifting focus from capability expansion to reliability/polish
- prioritize provider UX trust (status, timeouts, fallback clarity) over new command vocabulary

## Execution Discipline (Cross-Workstation Safety)

To reduce ambiguity during fast iteration (especially across multiple workstations):

- Commit in smaller increments (feature slice + checkpoint)
- Prefer one concern per commit (parser, provider, UI, docs, etc.)
- Update `ROADMAP.md` when phase focus changes
- Add newly found defects/polish items to `KNOWN_BUGS.md`
- Use commit messages as breadcrumbs for "what changed / why now"

### Current Working Rules

- Do not treat parser alias additions as substitutes for missing typed actions
- Keep Phase F work focused on provider UX/stability hardening (not major capability expansion)
- Keep deterministic parser and provider command vocabulary aligned
- Preserve local validation/patch compilation as the only state mutation path

### Phase F Goals (Planned / Alignment)

1. Make provider readiness/status updates reliable and understandable
2. Make timeout/fallback behavior explicit in Smart Patch UI (no silent confusion)
3. Improve provider request lifecycle (probe timing, cancelation, stale response handling)
4. Reduce surprise permission/network prompts via smarter probe strategy
5. Preserve local-first fallback and diff safety invariants during all provider failures

## Completed Milestones

### Core Sequencer + Editing Foundation

- Canonical `SongState` editing model
- Undo/redo via reversible JSON patch operations
- Pattern-based arrangement + synth/drum editors
- Transport/playback scheduling + timeline/loop controls

### Audio / FX Phases

- Phase 2 audio engine modularization + timing/determinism work
- Phase 3 musical FX controls + send bus tuning
- Phase 4 chorus + DJ filter insert FX
- Phase 5 eco mode + clickless mute ramps
- Shared FX bus presets and preset-aware routing behavior

### AI Patch Pipeline Foundation

- Diff engine patch pipeline
- Rule parser local tier
- Smart patch heuristic tier
- AI provider routing (local-first)
- Provider-key/model scaffolding (OpenAI / Anthropic / Ollama)
- Provider diagnostics + Smart Patch debug trace panel
- Typed action expansion for track/bar and FX-related operations
- Provider sequence-candidate grouping for multi-step pattern edits
- Phase E typed action expansion for note/pattern/arrangement edits (broad coverage checkpoint)
- Drum groove parser macros + typed batched drum-step provider path (`set_drum_steps` -> `set_drum_step_batch`)

## Active Focus (Near-Term)

### 1. Phase F Definition + UX Reliability Prep

Priority: `High`

- Finalize Phase F scope, success criteria, and out-of-scope list before implementation
- Keep current Phase E command coverage stable while shifting effort to provider UX reliability
- Tie known provider UX issues (for example `KB-001`) to concrete Phase F tasks

### 2. Provider UX Reliability / Feedback

Priority: `Medium`

- Reduce stale `Checking…` provider status states
- Probe on relevant settings saves (model/API key/provider selection)
- Improve readiness/error messaging clarity
- Revisit provider probe strategy to avoid surprise permission/network prompts (lazy + selected-provider-first checks)
- Clarify timeout vs parse-failure vs fallback messaging in Smart Patch diagnostics/UI

### 3. Documentation / Context Resilience

Priority: `Medium`

- Keep `README.md`, `ROADMAP.md`, and `KNOWN_BUGS.md` current
- Preserve phase breadcrumbs in commit messages
- Record “why now / next” decisions during phase transitions

## Planned Next Phases (Tentative)

### Phase E (Completed): AI Command + Intent Expansion

- Expanded typed action coverage across sound, FX, routing, pattern, and arrangement edits
- Added typed note-level pattern edits and polyphonic targeting flows
- Added batched drum-step typed action path for compact groove edits
- Significantly expanded parser phrasing and groove macros for deterministic local edits
- Improved provider prompt parity, examples, and provider-to-parser translation resilience

### Phase F: Provider UX / Stability Hardening

- Scope
- Provider readiness lifecycle hardening (`Checking…` stale state, save-triggered reprobes, selected-provider-first probes)
- Timeout/cancel/error/fallback messaging clarity in Smart Patch drawer + diagnostics row/trace
- Request lifecycle correctness (cancelation, stale response handling, status reset behavior)
- Preserve local fallback behavior and clear user trust signals while provider requests fail/timeout

- Success Criteria
- Provider status updates reflect current state without requiring drawer reopen in common flows
- Users can distinguish timeout vs invalid output vs fallback in the UI/diagnostics
- Provider probes do not run eagerly on page load and are scoped to relevant provider interactions
- No regressions to local rule-parser/smartPatch generation paths

- Out of Scope (Phase F)
- Major new parser/typed action capability expansion
- New hosted provider backend implementation
- Broad Smart Patch layout redesign

### Phase G: Advanced AI Editing Controls (Later)

- Power-user procedural pattern/programming prompt backend (Strudel-inspired) that compiles constrained generative instructions into safe patch actions
- Examples: ranges, probabilistic placement, downbeat/every-other-beat rules, octave bounds, seeded randomness

- Deeper insert FX parameter control workflows (broader than current basic support)
- More arrangement-level edits
- Optional speech-to-prompt input (push-to-talk mic -> transcript -> existing prompt pipeline)
- Possibly provider streaming or richer hosted-provider integration (if/when needed)

## Prioritized Planned Features / Work Items

## P1 (Near-term, meaningful impact)

- Add parser/compiler coverage tests (or lightweight fixtures) for canonical commands and typed actions
- Tighten provider status refresh after settings changes
- Implement selected-provider-first probe strategy and save-triggered reprobes
- Clarify timeout/fallback diagnostics messaging and UI labels

## P2 (Important, but can follow current phase)

- Hide/disable scaffold-only provider options until implemented (for example `developer-hosted`)
- Improve README/provider setup troubleshooting guidance
- Add a small internal changelog/decision log section to roadmap updates

## P3 (Polish / later)

- Extended power-user provider settings UX polish
- Deeper AI trace tooling improvements
- Broader docs/examples for advanced local model setups
- Voice prompt UX exploration (browser-native STT first, explicit user-triggered mic permissions)
- Power-user procedural prompting UX (range/constraint syntax + pseudorandom note placement controls)

## How To Maintain This File

- Update `Current Phase` when focus shifts
- Add completed work to `Completed Milestones` after commits land
- Keep `Planned Next Phases` short and directional (not exhaustive)
- Link bug-specific items to `KNOWN_BUGS.md` when they are defects rather than features


