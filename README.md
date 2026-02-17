# Audio Sequencer

A browser-based sequencer built with Vite + React + TypeScript.

The app is designed around a canonical JSON song state and a deterministic-ish WebAudio engine. It supports pattern-based composition, synth/drum editing, live transport control, undo/redo via JSON patch history, and AI-assisted patch proposals.

## What The App Does

- Edits songs as structured `SongState` data (tracks, patterns, lanes, bars, tempo, swing)
- Plays synth + drum tracks with WebAudio scheduling and lookahead
- Supports loop ranges, per-track mute, and a global timeline sweep
- Provides a piano-roll style synth editor and step drum editor
- Includes instrument controls (oscillator, envelope, filter, mod, gain/lofi)
- Uses reversible patch operations for undo/redo and AI audition/accept flows

## UX Highlights

- Mobile-first layout tuning:
  - compact transport/status controls
  - collapsible timeline controls
  - Sound editor as a mobile bottom sheet
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
- `src/ai/aiProposePatch.ts` - deterministic AI patch proposal stub

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

## Deployment

This repo is intended to deploy from `main` (for example via Vercel). Pushes to `main` can be used as live test checkpoints.

## Notes

- No backend is required.
- AI behavior is local/stubbed unless you replace `src/ai/aiProposePatch.ts`.
- `New Song` resets arrangement/history state.
