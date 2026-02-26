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

`AI patch pipeline expansion (Phase E in-progress)`

Current emphasis:

- broaden parser/provider command coverage (especially track/bar controls)
- improve provider prompt grounding and canonical-command alignment
- continue UX polish for Smart Patch/provider settings and diagnostics

## Execution Discipline (Cross-Workstation Safety)

To reduce ambiguity during fast iteration (especially across multiple workstations):

- Commit in smaller increments (feature slice + checkpoint)
- Prefer one concern per commit (parser, provider, UI, docs, etc.)
- Update `ROADMAP.md` when phase focus changes
- Add newly found defects/polish items to `KNOWN_BUGS.md`
- Use commit messages as breadcrumbs for "what changed / why now"

### Current Working Rules

- Do not treat parser alias additions as substitutes for missing typed actions
- Keep Phase E work focused on capability expansion (new action families + compiler support)
- Keep deterministic parser and provider command vocabulary aligned
- Preserve local validation/patch compilation as the only state mutation path

### Current Phase E Goals (Active)

1. Expand typed action coverage for pattern and arrangement edits
2. Expand deterministic parser phrasing for already-supported actions
3. Improve provider grounding/context (track/bar/pattern summaries) without large token growth
4. Reduce ambiguous prompt outcomes with clearer action semantics and candidate labels
5. Commit checkpoints frequently during feature expansion to preserve context continuity

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

## Active Focus (Near-Term)

### 1. Parser / Command Coverage Expansion

Priority: `High`

- Expand canonical commands for track/bar manipulation
- Keep rule parser, provider prompts, and typed intent compiler aligned
- Add prompt examples that bias providers toward supported track/bar operations

### 2. Provider UX Reliability / Feedback

Priority: `Medium`

- Reduce stale `Checking…` provider status states
- Probe on relevant settings saves (model/API key/provider selection)
- Improve readiness/error messaging clarity
- Revisit provider probe strategy to avoid surprise permission/network prompts (lazy + selected-provider-first checks)

### 3. Documentation / Context Resilience

Priority: `Medium`

- Keep `README.md`, `ROADMAP.md`, and `KNOWN_BUGS.md` current
- Preserve phase breadcrumbs in commit messages
- Record “why now / next” decisions during phase transitions

## Planned Next Phases (Tentative)

### Phase E (Continue): AI Command + Intent Expansion

- Broaden supported commands across:
  - track/bar operations
  - pattern edits
  - selective note-step edits (including add/remove/retune note flows)
- Improve typed intent compilation coverage and confidence gating
- Increase provider prompt parity (Ollama / OpenAI / Anthropic)

### Phase F: Provider UX / Stability Hardening

- Better health probe lifecycle and status refresh behavior
- Timeout/error handling polish in Smart Patch UI
- Safer fallback messaging and diagnostics surfacing

### Phase G: Advanced AI Editing Controls (Later)

- Deeper insert FX parameter control workflows (broader than current basic support)
- More arrangement-level edits
- Possibly provider streaming or richer hosted-provider integration (if/when needed)

## Prioritized Planned Features / Work Items

## P1 (Near-term, meaningful impact)

- Expand provider prompt examples for track/bar commands across all providers
- Add parser/compiler coverage tests (or lightweight fixtures) for canonical commands
- Tighten provider status refresh after settings changes
- Continue pattern/note command coverage expansion before deeper insert-control work

## P2 (Important, but can follow current phase)

- Hide/disable scaffold-only provider options until implemented (for example `developer-hosted`)
- Improve README/provider setup troubleshooting guidance
- Add a small internal changelog/decision log section to roadmap updates

## P3 (Polish / later)

- Extended power-user provider settings UX polish
- Deeper AI trace tooling improvements
- Broader docs/examples for advanced local model setups

## How To Maintain This File

- Update `Current Phase` when focus shifts
- Add completed work to `Completed Milestones` after commits land
- Keep `Planned Next Phases` short and directional (not exhaustive)
- Link bug-specific items to `KNOWN_BUGS.md` when they are defects rather than features
