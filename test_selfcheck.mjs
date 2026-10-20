import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSkills, toggleSkill, parseSkillFile, withLinks } from "./skills-scan.mjs";

function skillFile(dir, name, body) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), body, "utf8");
}

function run() {
  const base = mkdtempSync(join(tmpdir(), "skills-addon-"));
  try {
    const a = join(base, "a");
    const b = join(base, "b");
    mkdirSync(a);
    mkdirSync(b);

    skillFile(a, "alpha", "---\nname: alpha\ndescription: Prints alpha.\n---\n# Alpha\n");
    skillFile(a, "dupe", "---\nname: dupe\ndescription: From A.\n---\n");
    skillFile(b, "dupe", "---\nname: dupe\ndescription: From B.\n---\n");
    writeFileSync(join(a, "root.md"), "---\nname: root\ndescription: Root level.\n---\n", "utf8");

    mkdirSync(join(a, "beta"));
    writeFileSync(
      join(a, "beta", "SKILL.md.disabled"),
      "---\nname: beta\ndescription: |\n  Multi line\n  description.\n---\n",
      "utf8"
    );

    // Not skills: nested markdown other than SKILL.md, and markdown without frontmatter.
    mkdirSync(join(a, "alpha", "notes"), { recursive: true });
    writeFileSync(join(a, "alpha", "notes", "guide.md"), "---\nname: ghost\ndescription: nope\n---\n", "utf8");
    writeFileSync(join(a, "plain.md"), "no frontmatter", "utf8");

    const skills = scanSkills([a, b]);
    const names = skills.map((s) => s.name);
    assert.deepEqual(names, ["alpha", "beta", "dupe", "dupe", "root"]);
    assert.equal(skills.find((s) => s.name === "alpha").enabled, true);
    assert.equal(skills.find((s) => s.name === "beta").enabled, false);
    assert.equal(skills.find((s) => s.name === "beta").description, "Multi line description.");
    assert.equal(skills.filter((s) => s.name === "dupe").length, 2);
    assert.ok(!names.includes("ghost"), "nested non-SKILL.md must be ignored");

    const linked = withLinks(skills, { alpha: ["rea"], dupe: ["playwright"] });
    assert.deepEqual(linked.find((s) => s.name === "alpha").mcp, ["rea"]);
    assert.deepEqual(linked.find((s) => s.name === "beta").mcp, []);
    assert.deepEqual(withLinks(skills, undefined).find((s) => s.name === "alpha").mcp, []);

    const alpha = skills.find((s) => s.name === "alpha");
    const paused = toggleSkill(skills, alpha.path);
    assert.equal(paused.find((s) => s.path === alpha.path + ".disabled").enabled, false);
    assert.ok(existsSync(alpha.path + ".disabled"));
    assert.ok(!existsSync(alpha.path));

    const beta = paused.find((s) => s.name === "beta");
    const resumed = toggleSkill(paused, beta.path);
    assert.equal(resumed.find((s) => s.name === "beta").enabled, true);
    assert.ok(existsSync(join(a, "beta", "SKILL.md")));

    assert.equal(parseSkillFile(join(a, "root.md")).description, "Root level.");
    assert.throws(() => toggleSkill(resumed, join(base, "nope", "SKILL.md")), /non trovata/);

    console.log("selfcheck ok: scan, disabled discovery, duplicates, toggle round-trip");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

run();
