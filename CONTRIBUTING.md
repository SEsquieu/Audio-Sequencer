# Contributing

Grinning Frog Sequencer is an actively used personal instrument, and focused fixes or improvements are welcome.

## Before Starting

- Open an issue before a large feature or architectural change.
- Keep the canonical `SongState` model and reversible patch pipeline intact.
- Provider output must remain untrusted input: validate and compile it through the existing typed action and patch paths.
- Avoid adding a backend requirement for core sequencing and editing.

## Local Development

```bash
npm install
npm run dev
```

Before submitting a change:

```bash
npm run build
```

Keep pull requests narrow, explain the user-facing behavior, and include manual verification notes for audio timing or interaction changes that are difficult to cover automatically.
