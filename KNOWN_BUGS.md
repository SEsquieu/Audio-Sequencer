# Known Bugs / Triage Backlog

Track UI/behavior issues here as they are discovered so they do not get lost during feature work or workstation/context switches.

## Priority Levels

- `P0` Critical: data loss, crashes, broken core playback/editing, or impossible recovery
- `P1` High: major feature blocked or misleading behavior with common workflows
- `P2` Medium: noticeable bug/workflow friction, limited scope, workaround exists
- `P3` Low: polish issue, edge case, or power-user-only friction

## Status Values

- `Open`
- `Planned`
- `In Progress`
- `Blocked`
- `Fixed`
- `Deferred`

## Bugs

### KB-001 Smart Patch provider status can remain "Checking…" until drawer reopen

- `Priority:` `P3`
- `Status:` `Fixed`
- `Area:` AI / Smart Patch UI / Provider Settings
- `Discovered:` 2026-02-26
- `Fixed:` 2026-02-26

#### Summary

When using Ollama with a custom `Model Override` (for example a locally hosted non-default model), the provider status label in the Smart Patch drawer can continue showing `Checking…` after saving settings. Closing and reopening the Smart Patch drawer refreshes the health probe and updates the status correctly.

#### Impact

- Primarily affects power users overriding Ollama models
- Misleading readiness state in UI
- No known impact on actual generation once provider is configured correctly

#### Repro (current)

1. Open Smart Patch drawer.
2. Select `Ollama (Local)` and open `AI Provider Settings`.
3. Enter a valid custom `Model Override` and save.
4. Observe provider status may remain `Checking…`.
5. Close and reopen the Smart Patch drawer.
6. Status updates correctly after drawer reopen.

#### Suspected Cause

- Provider health probe does not always rerun immediately after provider settings/model override save.
- Drawer open/close cycle retriggers the probe.

#### Implemented Fix

- Trigger provider-specific health probe after `Model Override` save and API key save.
- Use selected-provider-first probe ordering with stale-response protection in the Smart Patch drawer.
- Clear only the targeted provider status to `Checking…` during reprobe and replace on completion.

#### Verification Notes

- Manually validated: provider status updates correctly after save without requiring drawer close/reopen.
- No regression observed in local generation flow while testing the fix.
