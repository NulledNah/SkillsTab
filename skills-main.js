/*
 * SkillsTab - main process module for the OpenCode desktop addon.
 *
 * Loaded by the shared out/main/oc-addons.js entry (see apply.js). Registers:
 *
 *   skills-list   -> { ok, skills: [{ name, description, path, source, mcp, enabled }] }
 *   skills-toggle -> { ok, skills }   renames SKILL.md <-> SKILL.md.disabled
 *   skills-link   -> { ok, skills }   links/unlinks a skill to an MCP server
 *
 * Links are the bundled links.json defaults merged with the user overrides in
 * <userData>/skills-links.json (written by the Skills tab UI).
 *
 * The opencode server loads skills once at startup (they are cached and the
 * config is not hot-reloaded), so a skill toggle applies after a restart.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, ipcMain } from "electron";
import "./index.js";
import { defaultRoots, scanSkills, setLink, toggleSkill, withLinks } from "./skills-scan.mjs";

function message(error) {
  return error && error.message ? error.message : String(error);
}

let defaults = {};
try {
  defaults = JSON.parse(readFileSync(fileURLToPath(new URL("./links.json", import.meta.url)), "utf8"));
} catch {
  defaults = {};
}

const userLinksPath = () => join(app.getPath("userData"), "skills-links.json");

function userLinks() {
  try {
    const parsed = JSON.parse(readFileSync(userLinksPath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function effectiveLinks() {
  return { ...defaults, ...userLinks() };
}

function list() {
  return withLinks(scanSkills(defaultRoots()), effectiveLinks());
}

const MCP_NAME = /^[A-Za-z0-9._-]{1,64}$/;

ipcMain.removeHandler("skills-list");
ipcMain.removeHandler("skills-toggle");
ipcMain.removeHandler("skills-link");

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

ipcMain.handle("skills-link", (_event, payload) => {
  try {
    const skill = String(payload && payload.skill ? payload.skill : "");
    const mcp = String(payload && payload.mcp ? payload.mcp : "");
    const linked = !!(payload && payload.linked);
    if (!MCP_NAME.test(mcp)) throw new Error("nome MCP non valido");
    const skills = scanSkills(defaultRoots());
    if (!skills.some((item) => item.name === skill)) throw new Error("skill non trovata: " + skill);

    const overrides = userLinks();
    overrides[skill] = setLink(effectiveLinks()[skill], mcp, linked);
    writeFileSync(userLinksPath(), JSON.stringify(overrides, null, 2) + "\n", "utf8");

    return { ok: true, skills: withLinks(skills, effectiveLinks()) };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
});
