# Skills panel

Adds a **Skills** tab to the OpenCode desktop status popover (next to Servers,
MCP, LSP, Plugins). Every installed skill has a switch: enable/disable it for
the model context.

## How it works

- `skills-scan.mjs` scans the same global/external skill roots opencode uses:
  `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`.
- Disabling renames `SKILL.md` to `SKILL.md.disabled` (and back). Nothing is
  deleted; the skill directory stays in place.
- The installer patches the real SolidJS popover chunk
  (`out/renderer/assets/status-popover-body-*.js`) so the tab is a native
  Kobalte tab: instant, same style, same selection behaviour, no stacked
  panels. The pristine chunk is kept in the asar as `*.js.orig` for `remove`.
- The opencode server loads skills once at startup, so a toggle applies after a
  restart. The panel shows a **Riavvia** button that relaunches the app.

Version 1.1 replaces the first DOM-injection version. Running `install` also
strips the old `skills-panel.js` injection and deletes the old file.

## Install

Close OpenCode first (the patch writes `resources/app.asar`).

    cd "Skills panel plugin"
    node apply.js install

or double-click `installa.bat`.

OpenCode updates replace `app.asar`: re-run `install` after every update (and
re-run the installers of the other addons).

## Commands

    node apply.js remove       # remove only this addon (restores the chunk)
    node apply.js restore-all  # restore the pristine app.asar (all addons)
    node apply.js verify       # check the patched app.asar
    node apply.js status       # show install state

## Notes

- Project-local skills (`.opencode/skills`) are not listed: the desktop main
  process does not know the workspace directory.
- Custom `skills.paths` / `skills.urls` from `opencode.json` are not listed.
- If the same skill name exists in two roots, both rows are shown. The server
  keeps the last one it loads, so toggling the other copy may not change the
  model context.
- Toggling a skill mid-session does not affect the current context. Restart.
- If an OpenCode update changes the popover chunk internals, `install` fails
  with a clear "marker non trovato" error instead of writing a broken bundle.

## Files

- `apply.js` - installer (install / remove / restore-all / status / verify).
- `skills-scan.mjs` - discovery and toggle logic, testable standalone.
- `skills-main.js` - main-process IPC (`skills-list`, `skills-toggle`).
- `test_selfcheck.mjs` - runnable check: `node test_selfcheck.mjs`.
- `VERSION` - addon version.
