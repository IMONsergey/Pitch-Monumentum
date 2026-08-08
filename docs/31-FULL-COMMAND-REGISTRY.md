# Full Command Registry — unified `Cmd/Ctrl+K`

The Full product stack has accumulated editor, system, AI, review and delivery surfaces. A user should not have to remember which side panel owns which capability.

`apps/workspace/public/full-command-registry-ui.js` defines an additive command layer for the Full Workspace.

## Global API

The module exposes:

```js
window.__pitchCommandRegistry = {
  register(command),
  unregister(id),
  list(),
  execute(id),
  open(),
  close(),
}
```

A command has:

- stable `id`;
- `title`;
- `description`;
- `group`;
- searchable `keywords`;
- optional shortcut label;
- deterministic `order`;
- `run()` callback.

The registry emits:

- `pitch:command-registry-ready`;
- `pitch:command-registry-change`.

Future additive modules can register commands without importing the Pro Editor command-palette implementation.

## Full built-ins

The top-level Full palette includes:

- Pro Editor core commands;
- Assets;
- Motion;
- Components;
- Presenter;
- Design System;
- Slide Masters / Layouts;
- Creative Director;
- Versions;
- Comments & Review;
- Delivery Center;
- System Health.

## Core compatibility

The existing Pro Editor object-command palette remains the source for low-level object/slide commands during the stacked integration period.

The Full registry has a controlled `Editor commands` entry that opens the legacy palette. This avoids re-implementing insert/arrange/group/alignment/undo command payloads in a second surface before the core palette itself is migrated onto the registry.

Full `Cmd/Ctrl+K` intercepts the keyboard shortcut at capture phase. Clicking the existing `Commands` topbar button is also redirected to Full Command Registry in the Full shell. A temporary bypass is used only when the user explicitly selects `Editor commands`.

## Integration rule

The Full registry must be appended **after** all additive UI modules in the assembled Full editor bundle, so every target surface already exists when a command is executed.

Required Full bundle ordering:

```text
editor-spike
→ Design
→ Slide Masters
→ Creative Director
→ Creative Preview
→ Creative Runs
→ Versions
→ Review
→ Review Governance
→ Delivery
→ System Health
→ Full Command Registry
```

## Migration direction

After the stacked milestones are merged and green, the core `command-palette-ui.ts` should itself consume the same registry. At that point the temporary `Editor commands` delegation can disappear and one palette will own every command directly.

Do not duplicate canonical editor mutation payloads merely to eliminate this temporary compatibility step.

## Release contract

The Full packager/source preflight should require `full-command-registry-ui.js`, and the post-build Full runtime smoke should verify the assembled `editor-spike.js` contains the Full command registry marker.

Until those existing aggregation files are atomically updated and CI executes, the registry source is implemented but should not be described as release-wired.
