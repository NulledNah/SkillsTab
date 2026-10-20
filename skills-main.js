/*
 * Skills panel - main process module for the OpenCode desktop addon.
 *
 * Loaded by the shared out/main/oc-addons.js entry (see apply.js). Registers:
 *
 *   skills-list   -> { ok, skills: [{ name, description, path, source, mcp, enabled }] }
 *   skills-toggle -> { ok, skills }   renames SKILL.md <-> SKILL.md.disabled
 *
 * links.json maps a skill name to the MCP servers it works with. The renderer
 * uses it to connect/disconnect the server with the skill and to show a badge
 * when the linked MCP is off.
 *
 * The opencode server loads skills once at startup (they are cached and the
 * config is not hot-reloaded), so a skill toggle applies after a restart.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ipcMain } from "electron";
import "./index.js";
import { defaultRoots, scanSkills, toggleSkill, withLinks } from "./skills-scan.mjs";

function message(error) {
  return error && error.message ? error.message : String(error);
}

let links = {};
try {
  links = JSON.parse(readFileSync(fileURLToPath(new URL("./links.json", import.meta.url)), "utf8"));
} catch {
  links = {};
}

function list() {
  return withLinks(scanSkills(defaultRoots()), links);
}

ipcMain.removeHandler("skills-list");
ipcMain.removeHandler("skills-toggle");

ipcMain.handle("skills-list", () => {
  try {
    return { ok: true, skills: list() };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
});

ipcMain.handle("skills-toggle", (_event, path) => {
  try {
    return { ok: true, skills: toggleSkill(list(), String(path)) };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
});
