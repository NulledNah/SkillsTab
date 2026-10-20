/*
 * Skills panel - main process module for the OpenCode desktop addon.
 *
 * Loaded by the shared out/main/oc-addons.js entry (see apply.js). Registers:
 *
 *   skills-list   -> { ok, skills: [{ name, description, path, source, enabled }] }
 *   skills-toggle -> { ok, skills }   renames SKILL.md <-> SKILL.md.disabled
 *
 * The opencode server loads skills once at startup (they are cached and the
 * config is not hot-reloaded), so a toggle applies after a restart. The panel
 * offers a restart button that uses the existing window.api.relaunch bridge.
 */
import { ipcMain } from "electron";
import "./index.js";
import { defaultRoots, scanSkills, toggleSkill } from "./skills-scan.mjs";

function message(error) {
  return error && error.message ? error.message : String(error);
}

ipcMain.removeHandler("skills-list");
ipcMain.removeHandler("skills-toggle");

ipcMain.handle("skills-list", () => {
  try {
    return { ok: true, skills: scanSkills(defaultRoots()) };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
});

ipcMain.handle("skills-toggle", (_event, path) => {
  try {
    const skills = scanSkills(defaultRoots());
    return { ok: true, skills: toggleSkill(skills, String(path)) };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
});
