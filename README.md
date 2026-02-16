# Beepbox x Strudel x AI Patch (MVP)

A mobile-friendly Vite + React + TypeScript prototype where the song is a JSON `SongState`, and all edits are reversible JSON Patch operations.

## Features

- Song model with tracks, patterns, lanes, tempo, and swing
- JSON Patch core (`applyPatch`, `invertPatch`) with undo/redo history
- WebAudio playback (synth + drum voices) with lookahead scheduler
- Four-tab mobile UI: Timeline, Edit, Sound, AI
- AI patch stub with deterministic keyword-driven candidates
- Audition flow: temporary apply, accept, reject, revert
- Local storage persistence for song + history

## Run

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in terminal.

## Notes

- No backend is required.
- AI is stubbed at `src/ai/aiProposePatch.ts`.
- "New Song" resets song and history.
