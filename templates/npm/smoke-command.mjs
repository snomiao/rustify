// What the install smoke test (smoke.mjs) does with one command under test:
// how it reads an `--also` line, and which home directory the command gets.
// A file of its own so that tests/unit can load it without starting a run.

import path from "node:path";

// The hand-back helper (templates/rust/js_fallback.rs, v5 and later) writes
// TRACE_LINE to stderr when TRACE_ENV is set and it passes a command to the
// JavaScript. Both are the same in every project.
export const TRACE_ENV = "RUSTIFY_HANDBACK_TRACE";
export const TRACE_LINE = "rustify: handed back to the JavaScript";

// Reads one `--also` line:
//
//   [marker]... <command> [args] => <text it must print> !> <text it must not print>
//
// Markers, in any order, each followed by a space:
//
//   [2]                    the command is meant to exit 2 instead of 0
//   [native]               the binary must answer this itself
//   [handback]             the binary must hand this to the JavaScript
//   [native:linux,darwin]  either of the two, demanded on some platforms only:
//                          linux, darwin, win32, or a whole key (linux-arm64);
//                          elsewhere the line runs without that demand
//   [real-home]            the command gets the caller's own home directory
//
// `hostKey` is this machine's platform key and `platformKeys` are all known
// ones. In the result, `who` is "native", "handback" or null: who has to
// answer on this machine. Throws on a marker it does not know.
export function parseLine(text, hostKey, platformKeys) {
  const [left, rest = ""] = text.split("=>").map((part) => part.trim());
  const [wanted, unwanted = ""] = rest.split("!>").map((part) => part.trim());
  const known = new Set([...platformKeys, ...platformKeys.map((key) => key.split("-")[0])]);
  const demands = new Set();
  let line = left;
  let code = 0;
  let realHome = false;
  for (let marker; (marker = line.match(/^\[([^\]\s]*)\](\s+|$)/)); line = line.slice(marker[0].length)) {
    const [word, list] = marker[1].split(/:(.*)/s);
    if (/^\d+$/.test(marker[1])) {
      code = Number(marker[1]);
    } else if (marker[1] === "real-home") {
      realHome = true;
    } else if (word === "native" || word === "handback") {
      const names = list === undefined ? null : list.split(",").filter(Boolean);
      const wrong = (names || []).filter((name) => !known.has(name));
      if (wrong.length || (names && !names.length)) {
        throw new Error(
          `[${marker[1]}] in "${text}" does not name a platform` +
            `${wrong.length ? ` ("${wrong.join('", "')}")` : ""}. Use ${[...known].sort().join(", ")}.`,
        );
      }
      if (!names || names.some((name) => hostKey === name || hostKey.startsWith(`${name}-`))) demands.add(word);
    } else {
      throw new Error(
        `unknown marker [${marker[1]}] in "${text}". The markers are [<exit code>], [native], [handback], ` +
          "[native:<platforms>], [handback:<platforms>] and [real-home].",
      );
    }
  }
  if (demands.size > 1) throw new Error(`"${text}" asks for a native answer and for a hand-back on ${hostKey}`);
  const [name, ...args] = line.split(/\s+/).filter(Boolean);
  if (!name) throw new Error(`"${text}" names no command`);
  return { line, name, args, code, wanted, unwanted, who: [...demands][0] || null, realHome };
}

// The variables that give a command a home directory of its own, `home`.
// `undefined` stands for a variable that has to be removed.
//
//   HOME, USERPROFILE   where node, bun and most programs look up the home
//                       directory; some Windows programs ask HOME first
//   XDG_*_HOME          removed, so that programs which follow that convention
//                       fall back to their places under HOME, as they do on a
//                       new account
//   on Windows also     HOMEDRIVE and HOMEPATH, the other spelling of the home
//                       directory, and APPDATA and LOCALAPPDATA, where
//                       programs keep their settings and data
//
// What no variable can redirect stays the user's: the system keychain or
// credential store, and on Windows the folders a program gets from the system
// (SHGetKnownFolderPath) instead of from the environment.
export function homeVariables(home, platform = process.platform) {
  const variables = {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: undefined,
    XDG_DATA_HOME: undefined,
    XDG_STATE_HOME: undefined,
    XDG_CACHE_HOME: undefined,
  };
  if (platform === "win32") {
    const drive = path.win32.parse(home).root.replace(/[\\/]+$/, "");
    variables.HOMEDRIVE = drive;
    variables.HOMEPATH = home.slice(drive.length) || "\\";
    variables.APPDATA = path.win32.join(home, "AppData", "Roaming");
    variables.LOCALAPPDATA = path.win32.join(home, "AppData", "Local");
  }
  return variables;
}

// `base` with `changes` applied; a value of `undefined` removes the variable.
// Windows ignores case in the names of environment variables, so there a
// change replaces the variable however `base` spells it.
export function withEnv(base, changes, platform = process.platform) {
  const fold = (name) => (platform === "win32" ? name.toUpperCase() : name);
  const changed = new Set(Object.keys(changes).map(fold));
  const env = {};
  for (const [name, value] of Object.entries(base)) {
    if (!changed.has(fold(name))) env[name] = value;
  }
  for (const [name, value] of Object.entries(changes)) {
    if (value !== undefined) env[name] = value;
  }
  return env;
}
