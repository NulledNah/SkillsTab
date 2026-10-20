#!/usr/bin/env node
/*
 * apply.js - install / remove the Skills tab in the OpenCode desktop app.
 *
 * Unlike the first version (which injected a DOM script), this patches the
 * real SolidJS status popover chunk so the tab is a native Kobalte tab: no
 * manual selection state, no delay, no stacked panels.
 *
 * install:
 *   + out/main/skills-scan.mjs              skill discovery + toggle logic
 *   + out/main/skills-main.js               IPC: skills-list / skills-toggle
 *   + out/renderer/assets/status-popover-body-*.js.orig   pristine backup
 *   ~ out/renderer/assets/status-popover-body-*.js        patched chunk
 *   ~ out/preload/index.js                  expose window.api.skills*
 *   ~ out/main/oc-addons.js                 shared loader (+ skills-main.js)
 *   ~ package.json                          main -> ./out/main/oc-addons.js
 *   ~ out/renderer/index.html               strips the old skills-panel tag
 *   - out/renderer/skills-panel.js          old DOM addon removed if present
 *
 * remove restores the pristine chunk, neutralizes the main module and strips
 * the preload lines. Run while OpenCode is closed.
 *
 *   node apply.js install|remove|restore-all|status|verify [--app <dir>] [--force]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const SHARED_BACKUP_SUFFIX = ".ocaddons-backup";
const BLOCK_SIZE = 4194304;
const CHUNK_RE = /^status-popover-body-.*\.js$/;
const CHUNK_MARKER = "oc-skills-tab";
const ORIG_SUFFIX = ".orig";
const REMOVED_SENTINEL = "/* oc-addon-removed: skills */";
const OLD_PANEL = "skills-panel.js";

const SCAN_PARTS = ["out", "main", "skills-scan.mjs"];
const LINKS_PARTS = ["out", "main", "links.json"];
const MAIN_PARTS = ["out", "main", "skills-main.js"];
const PRELOAD_PARTS = ["out", "preload", "index.js"];
const INDEX_PARTS = ["out", "renderer", "index.html"];
const PKG_PARTS = ["package.json"];
const LOADER_PARTS = ["out", "main", "oc-addons.js"];
const LOADER_MAIN = "./out/main/oc-addons.js";
const BASE_MAIN = "./out/main/index.js";
const SKILLS_IMPORT = "./skills-main.js";

const LOADER_SRC =
  "/* oc-addons loader - shared entry for OpenCode desktop addons.\n" +
  " * Loads the base app, then any present addon main module. Addons are\n" +
  " * append-only; a removed addon is neutralized to a no-op stub. */\n" +
  'import "./index.js";\n' +
  'for (const f of ["./deepseek-main.js", "./freelancer-main.js", "./skills-main.js"]) {\n' +
  "  try { await import(f); } catch (e) { /* addon not installed */ }\n" +
  "}\n";

const LOADER_APPEND =
  "\n/* skills addon */\n" +
  'try { await import("./skills-main.js"); } catch (e) { /* skills addon not installed */ }\n';

const POPOVER_TEMPLATES = `/* oc-skills-tab */
var _tmpl$skills = /* @__PURE__ */ template('<div class="flex flex-col"><button type=button class="flex items-center gap-2 w-full min-h-8 pl-3 pr-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"><div></div><span class="flex flex-col min-w-0 flex-1"><span class="flex items-center gap-2 min-w-0"><span class="text-14-regular truncate"></span><span data-skill-mcp class="text-11-regular text-text-weak truncate"></span><span data-skill-caret class="shrink-0 text-text-weak" style="font-size:10px;line-height:1;transition:transform .15s">▾</span></span></span><div></div></button><div data-skill-links class="flex flex-col gap-1 px-3 pb-2" style="display:none"></div></div>'), _tmpl$mcp = /* @__PURE__ */ template('<div class="flex items-center justify-between gap-2 min-h-7 pl-2 pr-1 rounded-md hover:bg-surface-raised-base-hover cursor-pointer"><span class="text-12-regular text-text-base truncate"></span><div></div></div>'), _tmpl$mcphead = /* @__PURE__ */ template('<div class="text-11-regular text-text-weaker px-2 pt-1"></div>'), _tmpl$version = /* @__PURE__ */ template('<div class="flex justify-center pt-2" style="color:#8a8a8a;font-size:11px;font-variant-numeric:tabular-nums;letter-spacing:.02em">v__SKILLS_VERSION__</div>'), _tmpl$restart = /* @__PURE__ */ template('<div class="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-border-weak-base"><span class="text-12-regular text-text-weak">Riavvia per applicare la skill.</span><button type=button class="text-12-regular text-text-base hover:underline">Riavvia</button></div>');

`;

const POPOVER_COMPONENTS = `var LOCALE = (function () {
  function pick(v) {
    v = String(v || "").toLowerCase();
    if (v.indexOf("it") === 0) return "it";
    if (v.indexOf("en") === 0) return "en";
    return null;
  }
  return pick(navigator.language) || pick(document.documentElement && document.documentElement.getAttribute("lang")) || "en";
})();
var I18N = {
  en: {
    loading: "Loading...",
    no_skills: "No skills found",
    no_mcp: "No MCP server configured.",
    mcp_linked: "Linked MCP:",
    restart_hint: "Restart to apply the skill.",
    restart: "Restart",
    reconnect_hint: "Click to reconnect",
    mcp_off: "MCP {names} off",
    error: "Error: ",
    bridge_missing: "Skills bridge missing.",
    unknown: "unknown"
  },
  it: {
    loading: "Caricamento...",
    no_skills: "Nessuna skill trovata",
    no_mcp: "Nessun server MCP configurato.",
    mcp_linked: "MCP collegati:",
    restart_hint: "Riavvia per applicare la skill.",
    restart: "Riavvia",
    reconnect_hint: "Clicca per riconnettere",
    mcp_off: "MCP {names} spento",
    error: "Errore: ",
    bridge_missing: "Bridge skills mancante.",
    unknown: "sconosciuto"
  }
};
function t(key) {
  var dict = I18N[LOCALE] || I18N.en;
  if (dict[key] != null) return dict[key];
  if (I18N.en[key] != null) return I18N.en[key];
  return key;
}

function SkillRow(props) {
  var _wrap = _tmpl$skills(), _el$ = _wrap.firstChild, _dot = _el$.firstChild, _label = _dot.nextSibling, _line = _label.firstChild, _name = _line.firstChild, _badge = _name.nextSibling, _caret = _badge.nextSibling, _box = _label.nextSibling, _editor = _wrap.lastChild;
  _el$.$$click = () => {
    var open = _editor.style.display === "none";
    _editor.style.display = open ? "" : "none";
    _caret.style.transform = open ? "rotate(180deg)" : "";
  };
  _box.$$click = (event) => event.stopPropagation();
  _badge.$$click = (event) => {
    event.stopPropagation();
    props.onReconnect(props.item);
  };
  insert(_name, () => props.item.name);
  insert(_box, createComponent(Switch, {
    get checked() {
      return props.item.enabled;
    },
    onChange: () => props.onToggle(props.item)
  }));
  var _head = _tmpl$mcphead();
  _head.textContent = t("mcp_linked");
  _editor.appendChild(_head);
  var names = props.mcpNames || [];
  if (!names.length) {
    var _empty = _tmpl$7();
    insert(_empty, () => t("no_mcp"));
    _empty.style.paddingLeft = "8px";
    _editor.appendChild(_empty);
  } else {
    for (const name of names) {
      var _row = _tmpl$mcp(), _name2 = _row.firstChild, _box2 = _row.lastChild;
      insert(_name2, name);
      _box2.$$click = (event) => event.stopPropagation();
      insert(_box2, createComponent(Switch, {
        get checked() {
          return (props.item.mcp || []).indexOf(name) >= 0;
        },
        onChange: () => props.onLink(props.item, name)
      }));
      _row.$$click = () => props.onLink(props.item, name);
      _editor.appendChild(_row);
    }
  }
  createRenderEffect((_p$) => {
    var _v$ = {
      "size-1.5 rounded-full shrink-0": true,
      "bg-icon-success-base": props.item.enabled,
      "bg-border-weak-base": !props.item.enabled
    };
    _p$.t = classList(_dot, _v$, _p$.t);
    _p$.n = classList(_name, {
      "text-text-base": props.item.enabled,
      "text-text-weak": !props.item.enabled
    }, _p$.n);
    var off = (props.item.mcp || []).filter((name) => props.mcp?.[name] && props.mcp[name].status !== "connected");
    var text = props.item.enabled && off.length ? t("mcp_off").replace("{names}", off.join(", ")) : "";
    _badge.textContent = text;
    _badge.title = text ? t("reconnect_hint") : "";
    return _p$;
  }, {
    t: void 0,
    n: void 0
  });
  return _wrap;
}

function SkillsContent(props) {
  return (() => {
    var _el$ = _tmpl$3(), _inner = _el$.firstChild;
    insert(_inner, createComponent(Show, {
      get when() {
        return props.state.loaded;
      },
      get fallback() {
        return (() => {
          var _el$f = _tmpl$7();
          insert(_el$f, () => t("loading"));
          return _el$f;
        })();
      },
      get children() {
        return [createComponent(Show, {
          get when() {
            return !!props.state.error;
          },
          get children() {
            return (() => {
              var _el$e = _tmpl$7();
              insert(_el$e, () => props.state.error);
              return _el$e;
            })();
          }
        }), createComponent(Show, {
          get when() {
            return !props.state.error;
          },
          get children() {
            return [createComponent(Show, {
              get when() {
                return props.state.items.length === 0;
              },
              get children() {
                return (() => {
                  var _el$n = _tmpl$7();
                  insert(_el$n, () => t("no_skills"));
                  return _el$n;
                })();
              }
            }), createComponent(For, {
              get each() {
                return props.state.items;
              },
              children: (item) => createComponent(SkillRow, {
                item,
                get mcp() {
                  return props.mcp;
                },
                get mcpNames() {
                  return props.mcpNames;
                },
                get onToggle() {
                  return props.onToggle;
                },
                get onReconnect() {
                  return props.onReconnect;
                },
                get onLink() {
                  return props.onLink;
                }
              })
            })];
          }
        })];
      }
    }));
    insert(_inner, createComponent(Show, {
      get when() {
        return props.state.needsRestart;
      },
      get children() {
        return (() => {
          var _el$r = _tmpl$restart();
          _el$r.firstChild.textContent = t("restart_hint");
          _el$r.lastChild.textContent = t("restart");
          _el$r.lastChild.$$click = () => {
            if (window.api && typeof window.api.relaunch === "function") window.api.relaunch();
          };
          return _el$r;
        })();
      }
    }));
    insert(_inner, _tmpl$version());
    return _el$;
  })();
}

`;

const POPOVER_STATE = `  const settings = useSettings();
  const [skillsState, setSkillsState] = createStore({
    items: [],
    loaded: false,
    error: "",
    busy: false,
    needsRestart: false
  });
  const loadSkills = () => {
    const bridge = window.api || {};
    if (!bridge.skillsList) {
      setSkillsState({ loaded: true, error: t("bridge_missing") });
      return;
    }
    bridge.skillsList().then((result) => {
      if (result && result.ok) setSkillsState({ items: result.skills || [], loaded: true, error: "" });
      else setSkillsState({ loaded: true, error: t("error") + ((result && result.error) || t("unknown")) });
    }).catch((error) => setSkillsState({ loaded: true, error: t("error") + error }));
  };
  const toggleSkillRow = (item) => {
    const bridge = window.api || {};
    if (skillsState.busy || !bridge.skillsToggle) return;
    setSkillsState("busy", true);
    bridge.skillsToggle(item.path).then((result) => {
      setSkillsState("busy", false);
      if (result && result.ok) {
        const next = (result.skills || []).find((skill) => skill.name === item.name && skill.dir === item.dir) || item;
        setSkillsState({ items: result.skills || skillsState.items, needsRestart: true, error: "" });
        syncLinkedMcp(next, next.enabled);
      } else setSkillsState("error", t("error") + ((result && result.error) || t("unknown")));
    }).catch((error) => setSkillsState({ busy: false, error: "Errore: " + error }));
  };
  const syncLinkedMcp = (item, enabled) => {
    for (const name of item.mcp || []) {
      const status = sync.data.mcp?.[name]?.status;
      if (!status) continue;
      const connected = status === "connected";
      if (connected !== enabled) toggleMcp.mutate(name);
    }
  };
  const reconnectLinked = (item) => {
    for (const name of item.mcp || []) {
      if (!sync.data.mcp?.[name]) continue;
      if (sync.data.mcp[name].status !== "connected") toggleMcp.mutate(name);
    }
  };
  const linkSkill = (item, name) => {
    const bridge = window.api || {};
    if (!bridge.skillsLink) return;
    const linked = (item.mcp || []).indexOf(name) < 0;
    bridge.skillsLink({ skill: item.name, mcp: name, linked }).then((result) => {
      if (!result || !result.ok) {
        setSkillsState("error", t("error") + ((result && result.error) || t("unknown")));
        return;
      }
      const next = (result.skills || []).find((skill) => skill.name === item.name && skill.dir === item.dir);
      if (!next) return;
      const index = skillsState.items.findIndex((skill) => skill.name === item.name && skill.dir === item.dir);
      if (index >= 0) setSkillsState("items", index, "mcp", next.mcp || []);
      setSkillsState("error", "");
    }).catch((error) => setSkillsState("error", t("error") + error));
  };
  createEffect(() => {
    if (props.shown()) loadSkills();
  });`;

const POPOVER_TRIGGER = `
            }), createComponent(Tabs.Trigger, {
              value: "skills",
              "data-slot": "tab",
              "class": "text-12-regular",
              get children() {
                return [memo(() => {
                  const count = skillsState.items.filter((item) => item.enabled).length;
                  return count > 0 ? count + " " : "";
                }), memo(() => "Skills")];
              }
            })];`;

const POPOVER_CONTENT = `
        }), createComponent(Tabs.Content, {
          value: "skills",
          get children() {
            return createComponent(SkillsContent, {
              get state() {
                return skillsState;
              },
              get mcp() {
                return sync.data.mcp;
              },
              get mcpNames() {
                return mcpNames();
              },
              get onToggle() {
                return toggleSkillRow;
              },
              get onReconnect() {
                return reconnectLinked;
              },
              get onLink() {
                return linkSkill;
              }
            });
          }
        })];`;

function parseArgs(argv) {
  const args = { cmd: "install", app: null, force: false };
  const rest = argv.slice(2);
  if (rest[0] && !rest[0].startsWith("-")) args.cmd = rest.shift();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--app") args.app = rest[++i];
    else if (rest[i] === "--force") args.force = true;
  }
  return args;
}

function defaultAppDir() {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
    return path.join(base, "Programs", "@opencode-aidesktop");
  }
  if (process.platform === "darwin") return "/Applications/OpenCode.app";
  return "/opt/OpenCode";
}

function resolveAsar(appDir) {
  let base = appDir;
  if (process.platform === "darwin" && fs.existsSync(path.join(appDir, "Contents", "Resources"))) {
    base = path.join(appDir, "Contents", "Resources");
  }
  return path.join(base, "resources", "app.asar");
}

function appRunning() {
  if (process.platform !== "win32") return false;
  try {
    return /OpenCode\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq OpenCode.exe" /NH', { encoding: "utf8" }));
  } catch (e) {
    return false;
  }
}

function integrityOf(buf) {
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
    blocks.push(crypto.createHash("sha256").update(buf.subarray(i, i + BLOCK_SIZE)).digest("hex"));
  }
  if (blocks.length === 0) blocks.push(hash);
  return { algorithm: "SHA256", hash, blockSize: BLOCK_SIZE, blocks };
}

function readHeader(asar) {
  const fd = fs.openSync(asar, "r");
  try {
    const sb = Buffer.alloc(8);
    fs.readSync(fd, sb, 0, 8, 0);
    const size = sb.readUInt32LE(4);
    if (size <= 0 || size > fs.fstatSync(fd).size - 8) throw new Error("app.asar header non valido");
    const hb = Buffer.alloc(size);
    fs.readSync(fd, hb, 0, size, 8);
    const strLen = hb.readUInt32LE(4);
    return { size, json: JSON.parse(hb.subarray(8, 8 + strLen).toString("utf8")), dataStart: 8 + size };
  } finally {
    fs.closeSync(fd);
  }
}

function nodeAt(json, parts) {
  let n = json;
  for (const p of parts) {
    if (!n || !n.files || !n.files[p]) return null;
    n = n.files[p];
  }
  return n;
}

function setEntry(json, parts, entry) {
  const parent = nodeAt(json, parts.slice(0, -1));
  if (!parent || !parent.files) throw new Error("percorso asar non trovato: " + parts.join("/"));
  parent.files[parts[parts.length - 1]] = entry;
}

function deleteEntry(json, parts) {
  const parent = nodeAt(json, parts.slice(0, -1));
  if (parent && parent.files) delete parent.files[parts[parts.length - 1]];
}

function readEntry(asar, json, dataStart, parts) {
  const node = nodeAt(json, parts);
  if (!node || node.files) return null;
  const fd = fs.openSync(asar, "r");
  try {
    const buf = Buffer.alloc(node.size);
    fs.readSync(fd, buf, 0, node.size, dataStart + parseInt(node.offset));
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

function pickleUInt32(value) {
  const payload = Buffer.alloc(4);
  payload.writeUInt32LE(value, 0);
  const out = Buffer.alloc(8);
  out.writeUInt32LE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}

function pickleString(str) {
  const bytes = Buffer.from(str, "utf8");
  const pad = (4 - (bytes.length % 4)) % 4;
  const payload = Buffer.alloc(4 + bytes.length + pad);
  payload.writeUInt32LE(bytes.length, 0);
  bytes.copy(payload, 4);
  const out = Buffer.alloc(4 + payload.length);
  out.writeUInt32LE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}

function stripIndex(html) {
  return html.replace(/<script[^>]*src=["']\.\/skills-panel\.js["'][^>]*><\/script>/g, "");
}

function patchPreload(src, add) {
  src = src.split("\n").filter((line) => !/skills(List|Toggle|Link)\s*:/.test(line)).join("\n");
  if (!add) return src;
  const needle = 'electron.contextBridge.exposeInMainWorld("api", api)';
  if (!src.includes(needle)) throw new Error("preload: punto di innesto non trovato");
  const inject =
    "Object.assign(api,{skillsList:()=>electron.ipcRenderer.invoke(\"skills-list\")," +
    "skillsToggle:(p)=>electron.ipcRenderer.invoke(\"skills-toggle\",p)," +
    "skillsLink:(p)=>electron.ipcRenderer.invoke(\"skills-link\",p)});\n";
  return src.replace(needle, inject + needle);
}

function panelVersion() {
  try {
    const v = fs.readFileSync(path.join(__dirname, "VERSION"), "utf8").trim();
    if (v) return v;
  } catch {
    /* no VERSION file */
  }
  return "dev";
}

function sharedBackup(asar) {
  return asar + SHARED_BACKUP_SUFFIX;
}

function pkgMainOf(asar) {
  try {
    const header = readHeader(asar);
    const raw = readEntry(asar, header.json, header.dataStart, PKG_PARTS);
    return raw ? JSON.parse(raw.toString("utf8")).main : null;
  } catch (e) {
    return null;
  }
}

function ensureSharedBackup(asar) {
  const shared = sharedBackup(asar);
  if (fs.existsSync(shared)) return shared;
  if (pkgMainOf(asar) === BASE_MAIN) {
    fs.copyFileSync(asar, shared);
    console.log("Backup condiviso creato da app.asar (pristino)");
    return shared;
  }
  const legacy = asar + ".deepseek-backup";
  if (fs.existsSync(legacy) && pkgMainOf(legacy) === BASE_MAIN) {
    fs.copyFileSync(legacy, shared);
    console.log("Backup condiviso creato da " + legacy);
    return shared;
  }
  console.warn("Nessun backup pristino trovato: 'restore-all' non sara' possibile finche' non ne esiste uno.");
  return null;
}

function existingLoader(asar, header) {
  if (!nodeAt(header.json, LOADER_PARTS)) return null;
  return readEntry(asar, header.json, header.dataStart, LOADER_PARTS).toString("utf8");
}

function findPopoverName(json) {
  const assets = nodeAt(json, ["out", "renderer", "assets"]);
  if (!assets || !assets.files) return null;
  return Object.keys(assets.files).find((name) => CHUNK_RE.test(name)) || null;
}

function replaceOnce(haystack, needle, replacement, label) {
  const index = haystack.indexOf(needle);
  if (index < 0) throw new Error("chunk popover: marker non trovato (" + label + ")");
  if (haystack.indexOf(needle, index + 1) >= 0) throw new Error("chunk popover: marker duplicato (" + label + ")");
  return haystack.slice(0, index) + replacement + haystack.slice(index + needle.length);
}

function patchPopover(code) {
  if (code.includes(CHUNK_MARKER)) return code;
  code = replaceOnce(
    code,
    "const pluginEmptyMessage = (value, file) => {",
    POPOVER_TEMPLATES + "const pluginEmptyMessage = (value, file) => {",
    "templates"
  );
  code = replaceOnce(
    code,
    "function StatusPopoverBody(props) {",
    POPOVER_COMPONENTS + "function StatusPopoverBody(props) {",
    "components"
  );
  code = replaceOnce(
    code,
    `  const settings = useSettings();
  createEffect(() => {
    if (!props.shown()) return;
  });`,
    POPOVER_STATE,
    "state"
  );
  code = replaceOnce(
    code,
    `                return [memo(() => memo(() => pluginCount() > 0)() ? \`\${pluginCount()} \` : ""), memo(() => language.t("status.popover.tab.plugins"))];
              }
            })];
`,
    `                return [memo(() => memo(() => pluginCount() > 0)() ? \`\${pluginCount()} \` : ""), memo(() => language.t("status.popover.tab.plugins"))];
              }` + POPOVER_TRIGGER + "\n",
    "trigger"
  );
  code = replaceOnce(
    code,
    `            return _el$11;
          }
        })];
`,
    `            return _el$11;
          }` + POPOVER_CONTENT + "\n",
    "content"
  );
  return code;
}

function install(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  if (!fs.existsSync(asar)) {
    console.error("app.asar non trovato: " + asar);
    process.exit(1);
  }
  if (appRunning() && !args.force) {
    console.error("OpenCode e' in esecuzione. Chiudilo prima di applicare la patch (oppure usa --force).");
    process.exit(1);
  }

  const scanSrc = path.join(__dirname, "skills-scan.mjs");
  const mainSrc = path.join(__dirname, "skills-main.js");
  const linksSrc = path.join(__dirname, "links.json");
  for (const f of [scanSrc, mainSrc, linksSrc]) {
    if (!fs.existsSync(f)) {
      console.error(path.basename(f) + " non trovato accanto ad apply.js");
      process.exit(1);
    }
  }
  ensureSharedBackup(asar);

  const header = readHeader(asar);
  const popoverName = findPopoverName(header.json);
  if (!popoverName) {
    console.error("status-popover-body-*.js non trovato: versione di OpenCode non supportata.");
    process.exit(1);
  }
  const CHUNK_PARTS = ["out", "renderer", "assets", popoverName];
  const ORIG_PARTS = ["out", "renderer", "assets", popoverName + ORIG_SUFFIX];

  const pkgRaw = readEntry(asar, header.json, header.dataStart, PKG_PARTS);
  const preloadRaw = readEntry(asar, header.json, header.dataStart, PRELOAD_PARTS);
  const indexRaw = readEntry(asar, header.json, header.dataStart, INDEX_PARTS);
  const currentChunk = readEntry(asar, header.json, header.dataStart, CHUNK_PARTS);
  if (!pkgRaw || !preloadRaw || !indexRaw || !currentChunk) {
    console.error("file attesi non trovati nell'asar");
    process.exit(1);
  }
  const origRaw = readEntry(asar, header.json, header.dataStart, ORIG_PARTS);
  const baseChunk = origRaw || currentChunk;
  if (baseChunk.toString("utf8").includes(CHUNK_MARKER)) {
    console.error("chunk popover gia' patchato senza backup pristino: impossibile proseguire.");
    process.exit(1);
  }

  const scanBuf = fs.readFileSync(scanSrc);
  const mainBuf = fs.readFileSync(mainSrc);
  const linksBuf = fs.readFileSync(linksSrc);
  const chunkBuf = Buffer.from(
    patchPopover(baseChunk.toString("utf8")).replace(/__SKILLS_VERSION__/g, panelVersion()),
    "utf8"
  );
  const preloadBuf = Buffer.from(patchPreload(preloadRaw.toString("utf8"), true), "utf8");
  const indexBuf = Buffer.from(stripIndex(indexRaw.toString("utf8")), "utf8");
  const pkg = JSON.parse(pkgRaw.toString("utf8"));
  pkg.main = LOADER_MAIN;
  const pkgBuf = Buffer.from(JSON.stringify(pkg, null, 2) + "\n", "utf8");

  const current = existingLoader(asar, header);
  const loaderBuf =
    current === null
      ? Buffer.from(LOADER_SRC, "utf8")
      : current.includes(SKILLS_IMPORT)
        ? null
        : Buffer.from(current + LOADER_APPEND, "utf8");

  const full = fs.readFileSync(asar);
  const dataBuf = full.subarray(header.dataStart);
  let cursor = dataBuf.length;
  const appended = [];
  const add = (parts, buf) => {
    setEntry(header.json, parts, { size: buf.length, offset: String(cursor), integrity: integrityOf(buf) });
    cursor += buf.length;
    appended.push(buf);
  };
  add(SCAN_PARTS, scanBuf);
  add(MAIN_PARTS, mainBuf);
  add(LINKS_PARTS, linksBuf);
  if (!origRaw) add(ORIG_PARTS, baseChunk);
  add(CHUNK_PARTS, chunkBuf);
  if (loaderBuf) add(LOADER_PARTS, loaderBuf);
  add(PRELOAD_PARTS, preloadBuf);
  add(INDEX_PARTS, indexBuf);
  add(PKG_PARTS, pkgBuf);

  // Remove the old DOM addon, if this is an upgrade.
  deleteEntry(header.json, ["out", "renderer", OLD_PANEL]);

  const newData = Buffer.concat([dataBuf].concat(appended));
  const headerBytes = pickleString(JSON.stringify(header.json));
  const output = Buffer.concat([pickleUInt32(headerBytes.length), headerBytes, newData]);

  const tmp = asar + ".skills-new";
  fs.writeFileSync(tmp, output);
  const check = readHeader(tmp);
  const checkChunk = readEntry(tmp, check.json, check.dataStart, CHUNK_PARTS).toString("utf8");
  const checkLoader = existingLoader(tmp, check) || "";
  if (!nodeAt(check.json, MAIN_PARTS) || !nodeAt(check.json, SCAN_PARTS) || !nodeAt(check.json, LINKS_PARTS)) {
    throw new Error("validazione del nuovo app.asar fallita");
  }
  if (!checkChunk.includes(CHUNK_MARKER) || !checkChunk.includes("SkillsContent")) {
    throw new Error("chunk popover non patchato");
  }
  if (!nodeAt(check.json, ORIG_PARTS)) throw new Error("backup del chunk mancante");
  if (!checkLoader.includes(SKILLS_IMPORT)) throw new Error("loader non aggiornato");
  if (!readEntry(tmp, check.json, check.dataStart, PRELOAD_PARTS).toString("utf8").includes("skillsList")) {
    throw new Error("preload non aggiornato");
  }
  fs.renameSync(tmp, asar);

  console.log("Patch applicata: " + asar);
  console.log("Chunk popover: " + popoverName);
  console.log("Riavvia OpenCode. La tab Skills compare nel popover di stato, dopo Plugins.");
  console.log("Per rimuoverla: node apply.js remove (solo Skills) o restore-all (tutti gli addon).");
}

function remove(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  if (!fs.existsSync(asar)) {
    console.error("app.asar non trovato: " + asar);
    process.exit(1);
  }
  if (appRunning() && !args.force) {
    console.error("OpenCode e' in esecuzione. Chiudilo prima di rimuovere (oppure usa --force).");
    process.exit(1);
  }
  const header = readHeader(asar);
  const popoverName = findPopoverName(header.json);
  if (!popoverName) {
    console.error("status-popover-body-*.js non trovato.");
    process.exit(1);
  }
  const CHUNK_PARTS = ["out", "renderer", "assets", popoverName];
  const ORIG_PARTS = ["out", "renderer", "assets", popoverName + ORIG_SUFFIX];

  const pkgRaw = readEntry(asar, header.json, header.dataStart, PKG_PARTS);
  const preloadRaw = readEntry(asar, header.json, header.dataStart, PRELOAD_PARTS);
  const indexRaw = readEntry(asar, header.json, header.dataStart, INDEX_PARTS);
  const origRaw = readEntry(asar, header.json, header.dataStart, ORIG_PARTS);
  if (!pkgRaw || !preloadRaw || !indexRaw || !origRaw) {
    console.error("backup del chunk o file attesi mancanti: nulla da rimuovere?");
    process.exit(1);
  }

  const hasLoader = !!nodeAt(header.json, LOADER_PARTS);
  const pkg = JSON.parse(pkgRaw.toString("utf8"));
  pkg.main = hasLoader ? LOADER_MAIN : BASE_MAIN;
  const pkgBuf = Buffer.from(JSON.stringify(pkg, null, 2) + "\n", "utf8");
  const stubBuf = Buffer.from(REMOVED_SENTINEL + "\n", "utf8");
  const preloadBuf = Buffer.from(patchPreload(preloadRaw.toString("utf8"), false), "utf8");
  const indexBuf = Buffer.from(stripIndex(indexRaw.toString("utf8")), "utf8");

  const full = fs.readFileSync(asar);
  const dataBuf = full.subarray(header.dataStart);
  let cursor = dataBuf.length;
  const appended = [];
  const add = (parts, buf) => {
    setEntry(header.json, parts, { size: buf.length, offset: String(cursor), integrity: integrityOf(buf) });
    cursor += buf.length;
    appended.push(buf);
  };
  add(MAIN_PARTS, stubBuf);
  add(CHUNK_PARTS, origRaw);
  add(PRELOAD_PARTS, preloadBuf);
  add(INDEX_PARTS, indexBuf);
  add(PKG_PARTS, pkgBuf);
  deleteEntry(header.json, ORIG_PARTS);
  deleteEntry(header.json, ["out", "renderer", OLD_PANEL]);

  const newData = Buffer.concat([dataBuf].concat(appended));
  const headerBytes = pickleString(JSON.stringify(header.json));
  const output = Buffer.concat([pickleUInt32(headerBytes.length), headerBytes, newData]);
  const tmp = asar + ".skills-new";
  fs.writeFileSync(tmp, output);
  readHeader(tmp);
  fs.renameSync(tmp, asar);
  console.log("Skills rimosso: chunk popover ripristinato, modulo neutralizzato.");
  console.log("Riavvia OpenCode.");
}

function restoreAll(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  const shared = sharedBackup(asar);
  const legacy = asar + ".deepseek-backup";
  const src = fs.existsSync(shared) ? shared : fs.existsSync(legacy) ? legacy : null;
  if (!src) {
    console.error("Nessun backup trovato (" + shared + ").");
    process.exit(1);
  }
  if (appRunning() && !args.force) {
    console.error("OpenCode e' in esecuzione. Chiudilo prima di ripristinare (oppure usa --force).");
    process.exit(1);
  }
  const tmp = asar + ".skills-restore";
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, asar);
  console.log("app.asar originale ripristinato da: " + src);
  console.log("Tutti gli addon (DeepSeek, Freelancer e Skills) sono stati rimossi.");
}

function status(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  const shared = sharedBackup(asar);
  console.log("Install dir  : " + appDir);
  console.log("app.asar     : " + (fs.existsSync(asar) ? "ok" : "MANCANTE"));
  console.log("backup shared: " + (fs.existsSync(shared) ? shared : "assente"));
  if (fs.existsSync(asar)) {
    const header = readHeader(asar);
    const pkg = JSON.parse(readEntry(asar, header.json, header.dataStart, PKG_PARTS).toString("utf8"));
    const mainNode = nodeAt(header.json, MAIN_PARTS);
    const neutral = mainNode
      ? readEntry(asar, header.json, header.dataStart, MAIN_PARTS).toString("utf8").includes("oc-addon-removed")
      : false;
    const loader = existingLoader(asar, header) || "";
    const popoverName = findPopoverName(header.json);
    const chunk = popoverName
      ? readEntry(asar, header.json, header.dataStart, ["out", "renderer", "assets", popoverName])
      : null;
    const orig = popoverName
      ? nodeAt(header.json, ["out", "renderer", "assets", popoverName + ORIG_SUFFIX])
      : null;
    console.log("main         : " + pkg.main);
    console.log("loader       : " + (nodeAt(header.json, LOADER_PARTS) ? "presente" : "assente"));
    console.log("loader skills: " + (loader.includes(SKILLS_IMPORT) ? "si" : "no"));
    console.log("chunk        : " + (popoverName || "assente"));
    console.log("chunk patch  : " + (chunk && chunk.toString("utf8").includes(CHUNK_MARKER) ? "si" : "no"));
    console.log("chunk backup : " + (orig ? "presente" : "assente"));
    console.log("skills       : " + (neutral ? "rimosso (stub)" : mainNode ? "installato" : "assente"));
  }
  console.log("in esecuzione: " + (appRunning() ? "si" : "no"));
}

function verify(args) {
  const appDir = args.app || defaultAppDir();
  const asar = resolveAsar(appDir);
  const header = readHeader(asar);
  const pkg = JSON.parse(readEntry(asar, header.json, header.dataStart, PKG_PARTS).toString("utf8"));
  const preload = readEntry(asar, header.json, header.dataStart, PRELOAD_PARTS).toString("utf8");
  const index = readEntry(asar, header.json, header.dataStart, INDEX_PARTS).toString("utf8");
  const main = readEntry(asar, header.json, header.dataStart, MAIN_PARTS);
  const scan = readEntry(asar, header.json, header.dataStart, SCAN_PARTS);
  const loader = existingLoader(asar, header) || "";
  const popoverName = findPopoverName(header.json);
  if (!popoverName) throw new Error("chunk popover mancante");
  const CHUNK_PARTS = ["out", "renderer", "assets", popoverName];
  const ORIG_PARTS = ["out", "renderer", "assets", popoverName + ORIG_SUFFIX];
  const chunk = readEntry(asar, header.json, header.dataStart, CHUNK_PARTS);
  const orig = readEntry(asar, header.json, header.dataStart, ORIG_PARTS);
  if (pkg.main !== LOADER_MAIN) throw new Error("package.json main non e' il loader condiviso");
  if (!nodeAt(header.json, LOADER_PARTS)) throw new Error("oc-addons.js (loader) mancante");
  if (!loader.includes(SKILLS_IMPORT)) throw new Error("loader: import skills-main mancante");
  if (!nodeAt(header.json, SCAN_PARTS)) throw new Error("skills-scan.mjs mancante");
  if (!nodeAt(header.json, LINKS_PARTS)) throw new Error("links.json mancante");
  if (!preload.includes("skillsList")) throw new Error("preload: bridge skills mancante");
  if (index.includes("skills-panel.js")) throw new Error("index.html: vecchio script addon ancora presente");
  if (!main || !main.toString("utf8").includes("skills-list")) throw new Error("skills-main.js mancante/invalido");
  if (!scan || !scan.toString("utf8").includes("scanSkills")) throw new Error("skills-scan.mjs mancante/invalido");
  if (!chunk || !chunk.toString("utf8").includes(CHUNK_MARKER)) throw new Error("chunk popover non patchato");
  if (!chunk.toString("utf8").includes('value: "skills"')) throw new Error("trigger skills mancante");
  if (chunk.toString("utf8").includes("__SKILLS_VERSION__")) throw new Error("versione non iniettata");
  if (!orig || orig.toString("utf8").includes(CHUNK_MARKER)) throw new Error("backup del chunk mancante o non pristino");
  console.log(
    "verify ok: loader + entry + preload + chunk (" +
      chunk.length +
      " byte) + backup (" +
      orig.length +
      " byte) + scan (" +
      scan.length +
      " byte) + main (" +
      main.length +
      " byte)"
  );
}

const args = parseArgs(process.argv);
try {
  if (args.cmd === "install") install(args);
  else if (args.cmd === "remove") remove(args);
  else if (args.cmd === "restore" || args.cmd === "restore-all") restoreAll(args);
  else if (args.cmd === "status") status(args);
  else if (args.cmd === "verify") verify(args);
  else {
    console.error("Comando sconosciuto: " + args.cmd);
    process.exit(1);
  }
} catch (err) {
  console.error("Errore: " + (err && err.message ? err.message : err));
  process.exit(1);
}
