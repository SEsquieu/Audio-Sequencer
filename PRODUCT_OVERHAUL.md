# Sequencer product overhaul — working brief

Status: In progress. This branch is not production-ready. AI features are frozen: preserve existing behavior, avoid expanding provider/command scope.

## Product goal
Turn the existing sequencer into a polished, mobile-first rack synthesizer and composition workstation. Retain the established dark visual identity and direct manipulation, while improving information hierarchy, navigation, musical flow, and sound-design depth.

## Non-negotiable acceptance criteria
- No regressions in existing songs, pattern editing, playback, patch history, or Smart Patch.
- Core workflows (create beat, melody, sound, arrange, mix, export/save) are discoverable and efficient on touch and desktop.
- Audio scheduling remains stable while editing, changing presets, switching panels, and backgrounding/resuming.
- Existing songs load, edit, save and reload without structural loss; invalid imports/patches fail safely.
- Accessibility: labeled controls, visible focus, keyboard paths, touch targets, usable contrast.
- Benchmarks cover polyphony, dense patterns, heavy FX, long sessions, and mid-playback edits.
- Validate with automated tests plus manual mobile and desktop runs before declaring complete.

## Design architecture
- Persistent transport and context-aware workspace navigation.
- Clear composition hierarchy: song/arrangement → track/pattern → instrument/FX.
- Progressive disclosure for synth controls; fast macro surface plus advanced modulation/signal-flow pages.
- Preserve rack-synth aesthetic, but avoid forcing every knob and editor onto one screen.
- Break up App.tsx by domain; isolate pointer interaction state from global song state.
- Centralize reusable parameter controls and domain editing commands.
- Define musical timing independently of fixed 16-step UI representation before adding alternate divisions.
- Add versioned project format and robust runtime validation.
- Keep AI proposal → validation → audition → accept boundary intact.

## Feature directions (subject to measured UX and DSP feasibility)
1. Instrument rack: reusable patches, audition, macro controls, oscillator/mixer/filter/envelope pages.
2. Modulation: LFO routing and modulation matrix with explicit bounded destinations.
3. Sequencing: per-note velocity, probability, ratchets, pattern duplication/variation, non-destructive transforms.
4. Arrangement: clear clip identity, copy/move, selection and loop operations.
5. Mix: consistent gain staging, channel strip, send/insert clarity, meters and safe master controls.
6. Project workflow: named songs, explicit export/import, autosave and recovery.
7. Keyboard and touch ergonomics, undo affordances, empty states and first-use guidance.

## Implementation order
A. Baseline characterization and regression tests.
B. State/patch safety and project format.
C. Component architecture and workflow/navigation redesign.
D. Synth and sequencing feature expansion with DSP/performance gates.
E. Cross-device accessibility/performance testing and polish.

## Current branch changes
- Patch application now rejects invalid array indexes, unsupported operations and missing replace/remove targets.

## Verification ledger
- Source inspection: partial.
- Typecheck/build: not yet executed.
- Browser/mobile interactive testing: not yet executed.
- Automated regression tests: not yet implemented.

Do not merge or deploy based on this document alone.
