# Grinning Frog Sequencer

A browser-based sequencer built with Vite + React + TypeScript.

The app is designed around a canonical JSON song state and a deterministic-ish WebAudio engine. It supports pattern-based composition, synth/drum editing, live transport control, undo/redo via JSON patch history, insert/master FX, and AI-assisted patch proposals through a local-first diff engine.

## What The App Does

- Edits songs as structured `SongState` data (tracks, patterns, lanes, bars, tempo, swing)
- Plays synth + drum tracks with WebAudio scheduling and lookahead
- Supports loop ranges, per-track mute, and a global timeline sweep
- Provides a piano-roll style synth editor and step drum editor
- Includes instrument controls (oscillator, envelope, filter, mod, gain/lofi)
- Includes per-track send routing and shared FX buses (delay/reverb)
- Supports insert FX and master FX chains (including chorus, DJ filter, saturator, EQ3)
- Includes eco mode and master safety controls
- Uses reversible patch operations for undo/redo and AI audition/accept flows

## AI Patching (Current Capabilities)

- Local-first AI patch proposal pipeline using a diff engine that compiles validated patch candidates
- Deterministic rule parser for fast commands (tempo, swing, gain, send levels, bus routing, track/bar edits)
- Deterministic note-edit commands for synth patterns (add/remove/retune notes by step/bar)
- Smart patch heuristic fallback for broader local edits
- Provider routing with fallback diagnostics for:
  - Local rule parser
  - Local smart patch
  - Ollama (local model)
  - OpenAI (user API key)
  - Anthropic (user API key)
- Structured intent parsing + compilation into typed actions / JSON patch operations
- Typed note-level pattern actions (add/remove note, targeted note retune) with local validation
- AI candidate audition, accept, and reject flows in the UI
- Provider health checks and a dev-only trace/debug panel for routing + provider output previews

## UX Highlights

- Mobile-first layout tuning:
  - compact transport/status controls
  - collapsible timeline controls
  - Sound editor as a mobile bottom sheet
- AI panel with provider selection, locks, and provider settings
- Timeline and editor sweep indicators for playback tracking
- Octave scrubber for synth note range navigation
- Note-span persistence for faster repeated note placement

## Tech Stack

- React 18
- TypeScript
- Vite
- WebAudio API

## Project Structure

- `src/audio/` - audio engine, scheduler, transport, mixer/instrument modules
- `src/state/` - song context, patch application/inversion, defaults/presets
- `src/types/song.ts` - canonical song and patch types
- `src/components/` - sound design and editor UI components
- `src/ai/` - AI patch proposal entrypoints, diff engine, prompt context, providers
- `src/smartPatch/` - heuristic/local smart patch intents and candidate generation

## Development

Install and run:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## AI Provider Setup (Optional)

- `Ollama`:
  - Run Ollama locally and ensure the API is reachable (default: `http://127.0.0.1:11434`)
  - Select `Ollama (Local)` in the AI panel
  - Optionally set a model override in AI Provider Settings
- `OpenAI` / `Anthropic`:
  - Select the provider in the AI panel
  - Enter your API key in AI Provider Settings
  - Keys are stored locally in browser storage on your machine (no backend in this repo)
  - Optionally set a model override

## Deployment

This repo is intended to deploy from `main` (for example via Vercel). Pushes to `main` can be used as live test checkpoints.

## Notes

- No backend is required.
- AI provider requests (if enabled) are made directly from the browser to the configured provider endpoint.
- Provider API keys/model overrides are stored in local browser storage.
- The app still falls back to local patch generation when provider output is unavailable, invalid, or times out.
- `New Song` resets arrangement/history state.
- See `ROADMAP.md` for the current phase plan and prioritized feature roadmap.
- See `KNOWN_BUGS.md` for triaged UI/behavior issues and polish backlog items.
