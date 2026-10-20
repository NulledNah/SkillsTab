# SkillsTab

A **Skills** tab for the OpenCode desktop status popover (Servers / MCP / LSP /
Plugins). Turn each skill on or off and link it to the MCP servers it needs.

## Before / after

<p align="center">
  <img src="img/before-after.png" width="640" alt="Pannello prima e dopo: tab Skills con gli switch per ogni skill">
</p>

## Install

Close OpenCode, then from this folder:

    node apply.js install

or double-click `installa.bat`. Reopen OpenCode.

OpenCode updates replace `app.asar`: run `install` again after every update.

## Usage

- The switch on the right enables/disables the skill. It applies after a
  restart, because the server loads skills at startup.
- Click a skill row (or the `▾`) to expand **Linked MCP:** and link one or more
  MCP servers. Links are saved immediately.
- Toggling a skill connects/disconnects its linked MCPs immediately. If an MCP
  is turned off from the MCP tab, the skill shows `MCP <name> off`: click it to
  reconnect.
- Links are per user, stored in
  `%APPDATA%\ai.opencode.desktop\skills-links.json` and created on first use.
  The bundled `links.json` is empty.
- The footer shows the installed version, prefixed with `v`.
- UI language: system, then app language, English fallback (it/en).

## Commands

    node apply.js remove       # remove only this addon
    node apply.js restore-all  # restore the pristine app.asar (all addons)
    node apply.js verify       # check the patched app.asar
    node apply.js status       # show install state

## Notes

- Project-local skills (`.opencode/skills`) and custom `skills.paths` are not
  listed.
- Duplicate skill names are shown separately; the server keeps the last loader.
- Links to MCP servers that are not configured are ignored.
- If an OpenCode update changes the popover chunk, `install` fails with a clear
  error instead of writing a broken bundle.

## Files

- `apply.js` - installer (install / remove / restore-all / status / verify)
- `skills-scan.mjs` - discovery and toggle logic
- `skills-main.js` - main-process IPC
- `links.json` - bundled defaults (empty)
- `test_selfcheck.mjs` - `node test_selfcheck.mjs`
- `VERSION`
