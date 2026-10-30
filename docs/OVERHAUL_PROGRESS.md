# Product overhaul checkpoint — 2026-10-30

Branch: `work/sequencer-product-overhaul`; draft PR #2. No merge or production release authorized.

## Implemented

- Persistent transport, project title and autosave feedback; explicit Compose, Arrange, Sound and Mix workspaces. Existing frog, green/black palette and piano-roll identity retained.
- Touch-sized parameter controls, labeled note/drum cells, keyboard note entry, undo/redo shortcuts, step-view bank buttons, visible clip actions and numeric loop bounds.
- Pattern duplication into an independent variation, reverse, shift, octave transpose, per-note velocity/chance/ratchet/gate inspector and drum velocity editing. Shared-pattern usage is explicit.
- Advanced rack: independent oscillator transposition, low/high/band-pass and notch filter modes, filter key tracking, retriggered LFO with free/tempo clock, four waveforms and bounded cutoff/pitch/pan/amplitude routing. Existing oscillator, envelope, XY pads, factory patches and effect racks retained.
- Local user patch library with audition. Dedicated persistent channel level/pan, sends, session solo/mute, measured track/master peaks, master safety and eco controls.
- Project export/import and named downloads; lazy-loaded stereo 16-bit/44.1kHz WAV export through the live DSP path. WAV arrangement limit: two minutes, plus three seconds of tail. WAV exports the committed whole arrangement; session mute/solo and selected loop do not affect bounce.
- Shared runtime validation and legacy mono-note migration; bounded pure history reducer; grouped scalar gestures; undo fixes for array append and object overwrite; canonical indexes and unsafe path rejection; atomic rejection of invalid edits.
- Debounced autosave with page-hide flush, visible failure state, and validated previous-snapshot recovery. Patch history remains session-only.
- Audio: drop missed scheduler events after stalls, time UI ticks to playback, cancel pending starts, stop synth/drum sources on pause, clean up completed sources, stop stolen voices, prune removed-track voice pools, scale short-note ADSR into the note gate, correct swing timing diagnostics. Backgrounding pauses playback; resume explicitly with Play.
- Split SoundRack and workstation controls out of App. App still owns legacy piano-roll, timeline and AI UI handlers; further domain extraction remains worthwhile.
- AI source files and provider/command scope unchanged. Existing local proposals tested for valid reversible application.

## Audit findings and architecture

The starting point had a 4,963-line App and 2,993-line stylesheet, no regression harness, shallow import checks, synchronous persistence on every edit, fixed 16-step timing, and a main-thread lookahead scheduler. Existing DSP already included dual oscillators, sub/noise, ADSR, vibrato, filter envelope, voice pooling, 4 insert effects, delay/reverb routing, and soft master saturation. This overhaul extends that graph rather than replacing its established sound model.

Confirmed baseline defects were appended-array undo failure, object-add inversion data loss, acceptance of noncanonical array indexes, stale-clock catch-up bursts, early UI ticks, incomplete source cancellation, pooled voices surviving removed tracks, and short-note envelope ordering. The new suite covers these boundaries. Mixer graph synchronization now avoids repeated full-song application when the document identity is unchanged.

The audio graph remains WebAudio nodes on the browser's audio thread, with event scheduling and graph changes on the main thread. This is not a sample-accurate AudioWorklet transport. Native impulse responses remain randomly generated. Master safety is coloration, not a true-peak limiter. Patterns remain 16 sixteenth notes in 4/4; no incompatible timing migration was attempted. The frozen AI adapters still use their established browser-side API-key behavior.

## Reproducible verification

Node 24.19.0, npm 11.9.0, lockfile install. Baseline production build passed before edits. Desktop 1440×900 and mobile 393×851 baseline rendered without page errors or document overflow.

Commands:

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:browser -- --workers=2
# An installed system browser can be selected with CHROMIUM_PATH=/usr/bin/chromium.
```

Latest completed checkpoint:

- **35 unit/regression tests passed**, including six existing local AI command flows, all factory presets, project migration/validation, history, scheduler ordering, swing, chance and ratchets.
- **14 Chromium browser tests passed** across desktop and Pixel 7 touch emulation. Covers note/drum entry, pattern duplication and append undo, expression, advanced synthesis, user patches, mix, playback, persistence, file export, invalid import, four workspace screenshots, no document overflow/runtime errors, native offline DSP and real-time stall recovery.
- Offline DSP validates finite output, audible filter modes, octave spectral movement, modulation, dense voice stealing and silent tails. WAV tests exercise synth/drums/inserts/pan/sends and check file header, stereo rate, energy and sample peaks.
- Real-time test blocks the main thread for 450 ms and confirms missed steps are dropped; pause/restart/stop remain operational.
- Production TypeScript/Vite build passed after these implementations. Browser traces/screenshots and DSP metrics are generated under ignored `test-results/`.

## Remaining release gates / continuation

1. Physical Android Chrome: touch accuracy, horizontal bank access, drag lengths, scrolling, headphones/speaker and Bluetooth latency, audio unlock after interruption, app background/foreground, keyboard/rotation and downloads.
2. Firefox and Safari/iOS coverage; screen-reader and contrast audit. Current automation is Chromium only. XY pads have numerical alternatives, but the legacy timeline/piano roll still needs a full keyboard-grid navigation pass.
3. Sustained 30–60 minute CPU/memory/battery profiling on mid-range Android; heavy FX and multiple dense tracks; independent listening/click detection. Current dense-voice and short stall tests do not certify long-session performance.
4. Continue decomposing App and SoundRack; consolidate the inherited CSS cascade with workstation overrides. Preserve the frozen AI scope and audition/accept boundary.
5. Consider IndexedDB/recovery management for larger projects and user-patch export/deletion. Current storage is origin-local; changing preview origins creates a separate library/autosave.
6. Expand modulation to a multi-slot matrix, independently editable filter envelope and richer oscillator modes only after profiling. Current implementation has one additional routed LFO plus existing vibrato/filter envelope, not an arbitrary modular synth.
7. Add richer arrangement copy/move workflows, pattern naming, explicit first-use guide, deterministic reverb rendering and configurable WAV tails. WAV clips values beyond ±1 when encoding; meters and sensible gain staging remain necessary.
8. CI workflow wiring and provider integration tests with mocked external boundaries remain to be added. External paid/local-model providers were not exercised; their implementation is unchanged.

Resume by reading PRODUCT_OVERHAUL.md and this file, checking branch/PR head, installing from lockfile, running the above checks, then addressing the release gates. Keep PR #2 draft until release gates are met; do not merge or deploy production without authorization.
