import { readdirSync, readFileSync, renameSync, existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export const DISABLED_SUFFIX = ".disabled";

// Same roots the opencode server scans for global and external skills.
// Project skills are intentionally not listed: the desktop main process cwd is
// the app directory, not the workspace, so process.cwd() would be wrong.
export function defaultRoots(home = homedir()) {
  const roots = [
    join(home, ".config", "opencode", "skills"),
    join(home, ".config", "opencode", "skill"),
    join(home, ".claude", "skills"),
    join(home, ".agents", "skills"),
  ];
  const seen = new Set();
  return roots.filter((path) => {
    const key = resolve(path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  });
}

// Mirrors the server glob {*.md, **/SKILL.md}: SKILL.md at any depth, any .md
// directly inside a source root. `*.md.disabled` is the paused counterpart.
function eligible(file, root) {
  const name = basename(file).replace(/\.disabled$/i, "");
  if (name === "SKILL.md") return true;
  return dirname(file) === root && /\.md$/i.test(name);
}

function walk(root, dir, out, depth) {
  if (depth > 6) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const stat = statSync(full);
        isDirectory = stat.isDirectory();
        isFile = stat.isFile();
      } catch {
        continue;
      }
    }
    if (isDirectory) walk(root, full, out, depth + 1);
    else if (isFile && /\.md(\.disabled)?$/i.test(entry.name) && eligible(full, root)) out.push(full);
  }
}

function field(frontmatter, key) {
  const match = new RegExp("^" + key + ":\\s*(.*)$", "m").exec(frontmatter);
  if (!match) return undefined;
  const value = match[1].trim();
  if (value === "" || value === "|" || value === ">") {
    const start = frontmatter.indexOf(match[0]) + match[0].length;
    const lines = frontmatter.slice(start).split(/\r?\n/);
    const collected = [];
    for (const line of lines) {
      if (/^\s+\S/.test(line)) collected.push(line.trim());
      else if (line.trim() === "") collected.push("");
      else break;
    }
    return collected.join(" ").trim();
  }
  return value.replace(/^["']|["']$/g, "").trim();
}

export function parseSkillFile(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const name = field(match[1], "name");
  if (!name) return null;
  return { name, description: field(match[1], "description") || "" };
}

// One entry per file, like the server's source scan. Duplicate names across
// roots are kept separate so a toggle always targets the file it shows.
export function scanSkills(roots) {
  const files = [];
  for (const root of roots) walk(root, root, files, 0);

  return files
    .map((file) => {
      const meta = parseSkillFile(file);
      if (!meta) return null;
      return {
        name: meta.name,
        description: meta.description,
        path: file,
        dir: dirname(file),
        source: roots.find((root) => file.startsWith(root)) || dirname(file),
        enabled: /\.md$/i.test(file),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

export function setLink(current, mcp, linked) {
  const names = new Set((current || []).filter((name) => typeof name === "string"));
  if (linked) names.add(mcp);
  else names.delete(mcp);
  return [...names].sort();
}

export function withLinks(skills, links) {
  return skills.map((skill) => ({
    ...skill,
    mcp: Array.isArray(links && links[skill.name]) ? links[skill.name] : [],
  }));
}

export function toggleSkill(skills, path) {
  const item = skills.find((skill) => skill.path === path);
  if (!item) throw new Error("skill non trovata: " + path);
  const next = item.enabled ? item.path + DISABLED_SUFFIX : item.path.slice(0, -DISABLED_SUFFIX.length);
  if (existsSync(next)) throw new Error("file gia' esistente: " + basename(next));
  renameSync(item.path, next);
  return skills.map((skill) =>
    skill.path === path ? { ...skill, path: next, enabled: !skill.enabled } : skill
  );
}
