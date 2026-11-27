#!/usr/bin/env node
// rustify install smoke test v2 — zero dependencies, runs on node or bun.
//
// Installs a packed release the way a user would (`bun i -g` or `npm i -g`),
// runs a command from it, and fails unless the native binary answered.
// Run it on every OS in CI: it is the proof that the release installs and
// starts there.
//
//   Before publishing — serves <dist> from a throwaway local registry:
//     smoke.mjs --dist npm-dist --run "<command> --version"
//   After publishing — installs from the real registry:
//     smoke.mjs --dist npm-dist --run "<command> --version" --registry https://registry.npmjs.org
//
// Options:
//   --installer bun|npm   default: both, when available
//   --expect <text>       text the output must contain (default: the version);
//                         write --expect=<text> if the text starts with --
//   --env NAME=value      set for the commands under test; repeatable
//   --also "<command> [args] => <text> !> <text it must not print>"
//                         one more command of the package that must exit 0
//                         and print <text>; repeatable. The part from `!>` on
//                         is optional. Markers may lead the line, in any order:
//                           [2]          expects exit code 2 instead of 0
//                           [native]     the binary must answer it itself
//                           [handback]   the binary must hand it to the JavaScript
//                           [native:linux,darwin]  demanded on these platforms
//                                        only (linux, darwin, win32, or a key
//                                        such as linux-arm64); same for handback
//                           [real-home]  this command gets your own home directory
//   --real-home           every command under test gets your own home directory
//
// Installs go to a temp directory. Your real global installs are not touched.
//
// The commands under test get a home directory of their own, empty at first,
// one per installer: HOME and USERPROFILE point at it, on Windows HOMEDRIVE,
// HOMEPATH, APPDATA and LOCALAPPDATA as well, and the XDG_*_HOME variables are
// removed so that they default to it. A command can then neither use the
// credentials nor change the files of whoever runs this test. What a command
// leaves there is seen by the lines after it. --env is applied afterwards, so
// a variable given there wins. A `bun` or `node` that does not start with that
// home directory (a version manager's shim) is asked, with the real one, where
// it is, and that directory goes first in the commands' PATH. The installs
// themselves run with the real environment. Not covered: variables that hold
// credentials themselves, agents the environment points at (SSH_AUTH_SOCK),
// the directory the test is started in, which stays the commands' working
// directory (bun reads a `.env` there), the system keychain, and Windows
// programs that ask the system instead of the environment for their folders.
//
// Who answered: a command the binary hands back to the JavaScript passes its
// line just like one the binary answers itself. For a line marked [native] or
// [handback] the test sets RUSTIFY_HANDBACK_TRACE, which makes the hand-back
// helper (templates/rust/js_fallback.rs, v5 and later) write one fixed line to
// stderr before it starts the JavaScript. A binary with an older helper, or
// with none, never writes that line, and its silence must not be read as a
// native answer. So the test looks for the line's text in the installed
// binary, and fails a marked line when it is not there. The line is taken out
// of the output before the texts of the line are looked for.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { TRACE_ENV, TRACE_LINE, homeVariables, parseLine, withEnv, withPath } from "./smoke-command.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";

function parseArgs(argv) {
  const out = { also: [], env: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    // `--key=value` is how to pass a value that itself starts with `--`.
    const eq = argv[i].indexOf("=");
    const key = eq > 0 ? argv[i].slice(2, eq) : argv[i].slice(2);
    const value = eq > 0 ? argv[i].slice(eq + 1) : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (key === "also") out.also.push(String(value));
    else if (key === "env") out.env.push(String(value));
    else out[key] = value;
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.run) {
  console.error(
    'usage: smoke.mjs --dist <dir> --run "<command> [args]" [--expect <text>] [--also "<command> [args] => <text>"]... ' +
      "[--registry <url>] [--installer bun|npm] [--env NAME=value]... [--real-home]",
  );
  process.exit(2);
}
// --env NAME=value, for the commands under test only (not for the install).
const commandEnv = Object.fromEntries(
  opts.env.map((pair) => {
    const eq = pair.indexOf("=");
    return eq > 0 ? [pair.slice(0, eq), pair.slice(eq + 1)] : [pair, ""];
  }),
);
// --real-home: no command under test gets a home directory of its own.
const everyRealHome = opts["real-home"] !== undefined && opts["real-home"] !== "false";
const dist = path.resolve(opts.dist || "npm-dist");
const plan = JSON.parse(fs.readFileSync(path.join(dist, "publish.json"), "utf8"));
const hostKey = `${process.platform === "android" ? "linux" : process.platform}-${process.arch}`;
const platformKeys = Object.keys(JSON.parse(fs.readFileSync(path.join(HERE, "platforms.json"), "utf8")));
if ((plan.unsupported || []).includes(hostKey)) {
  // The project said so itself (rustify.platforms); nothing to install here.
  console.log(`== ${plan.name}@${plan.version} on ${hostKey}\n  skip  the project does not ship a build for ${hostKey}`);
  process.exit(0);
}
const [command, ...args] = String(opts.run).split(/\s+/).filter(Boolean);
const expect = opts.expect || plan.version;
// Install scripts of the release itself, read from what was packed.
const ownInstallScripts = (() => {
  try {
    const scripts = JSON.parse(fs.readFileSync(path.join(dist, "main", "package.json"), "utf8")).scripts || {};
    return ["preinstall", "install", "postinstall"].filter((name) => scripts[name]);
  } catch {
    return [];
  }
})();
// Installs and the commands' home directories go here. rustify's own CI
// recognises a path of this test by the name `rustify-smoke-`.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-smoke-"));
let failures = 0;
const timings = [];

const ok = (message) => console.log(`  ok    ${message}`);
const bad = (message) => {
  failures++;
  console.log(`  FAIL  ${message}`);
};
const has = (tool) => spawnSync(tool, ["--version"], { stdio: "ignore", shell: isWindows }).status === 0;
const sh = (tool, toolArgs, env) =>
  spawnSync(tool, toolArgs, { encoding: "utf8", env: { ...process.env, ...env }, shell: isWindows });

function isScript(file) {
  const fd = fs.openSync(fs.realpathSync(file), "r");
  const head = Buffer.alloc(2);
  fs.readSync(fd, head, 0, 2, 0);
  fs.closeSync(fd);
  return head.toString() === "#!";
}

// Where `installer` puts a command of the package.
function binFor(installer, home, name) {
  if (installer === "bun") return path.join(home, "bin", name + (isWindows ? ".exe" : ""));
  return isWindows ? path.join(home, `${name}.cmd`) : path.join(home, "bin", name);
}

// A new, empty home directory for the commands under test.
function makeHome(label) {
  const dir = path.join(work, `home-${label}`);
  const { APPDATA, LOCALAPPDATA } = homeVariables(dir);
  for (const made of [dir, APPDATA, LOCALAPPDATA]) {
    if (made) fs.mkdirSync(made, { recursive: true });
  }
  return dir;
}

// Directories put first in PATH for the commands under test, see findRuntimes.
const runtimeDirs = [];

// The environment of a command under test: this process's, with the home
// directory `userHome` in place of the real one (see the header), then --env,
// then the switch that makes a hand-back visible.
function environment(userHome, { realHome = false, trace = false } = {}) {
  let env = { ...process.env };
  if (!realHome && !everyRealHome) {
    env = withEnv(env, homeVariables(userHome));
    if (runtimeDirs.length) env = withPath(env, runtimeDirs);
  }
  env = withEnv(env, commandEnv);
  if (trace) env = withEnv(env, { [TRACE_ENV]: "1" });
  return env;
}

// The launchers, the package managers' shims and the hand-back start `bun`
// and `node` by name. Where that name is a version manager's shim (asdf, mise,
// proto; Volta on Windows), the shim looks for its installs under the home
// directory and fails with the commands' own. Such a runtime is asked, with
// the real environment, where its executable is, and the commands under test
// get that directory first in PATH: the runtime the shim would have chosen.
function findRuntimes() {
  const probe = environment(makeHome("probe"));
  const starts = (tool, env) => spawnSync(tool, ["--version"], { stdio: "ignore", shell: isWindows, env }).status === 0;
  for (const tool of ["bun", "node"]) {
    if (!starts(tool, process.env) || starts(tool, probe)) continue;
    const asked = spawnSync(tool, ["-p", "process.execPath"], { encoding: "utf8", shell: isWindows });
    const executable = asked.status === 0 ? String(asked.stdout).trim() : "";
    const dir = executable && path.isAbsolute(executable) ? path.dirname(executable) : "";
    if (dir && starts(tool, withPath(probe, [dir]))) {
      runtimeDirs.push(dir);
      console.log(`  note  ${tool} does not start with the home directory the commands under test get; they get ${dir} first in PATH`);
    } else {
      console.log(
        `  note  ${tool} does not start with the home directory the commands under test get. ` +
          "Give it what it needs with --env, or run with --real-home",
      );
    }
  }
}

function runOnce(bin, runArgs, env) {
  const started = process.hrtime.bigint();
  const result = spawnSync(isWindows ? `"${bin}"` : bin, runArgs, { encoding: "utf8", shell: isWindows, env });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const [stdout, stderr] = [result.stdout || "", result.stderr || ""];
  return { ms, code: result.status, stdout, stderr, text: `${stdout}${stderr}`, error: result.error };
}

// The binary the platform package holds for the command `name`, or null.
function binaryOf(packageDir, name) {
  try {
    const manifest = path.join(packageDir, "package.json");
    const cargoBin = JSON.parse(fs.readFileSync(manifest, "utf8")).rustify.bins[name];
    const dir = path.dirname(createRequire(manifest).resolve(`${plan.name}-${hostKey}/package.json`));
    const file = path.join(dir, "bin", cargoBin + (isWindows ? ".exe" : ""));
    return fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

// Why this test cannot see who answers the command `name`, or "" when it can.
// Only a binary whose hand-back helper is v5 or later writes TRACE_LINE, and
// such a binary has the text of the line in its file.
const cannotTellWhy = new Map();
function cannotTell(packageDir, name) {
  const key = `${packageDir}\n${name}`;
  if (!cannotTellWhy.has(key)) {
    let why = "";
    const file = binaryOf(packageDir, name);
    if (plan.commands && !plan.commands.includes(name)) {
      why = `\`${name}\` is a JavaScript command of this package, so no binary answers it`;
    } else if (!file) {
      why = `the binary behind \`${name}\` was not found in the installed package`;
    } else if (!fs.readFileSync(file).includes(TRACE_LINE)) {
      why =
        `the binary behind \`${name}\` never says when it hands back: its hand-back helper is older than v5, ` +
        "or it has none. Copy the current templates/rust/js_fallback.rs into the crate";
    }
    cannotTellWhy.set(key, why);
  }
  return cannotTellWhy.get(key);
}

function check(installer, registry) {
  const spec = `${plan.name}@${plan.version}`;
  const home = path.join(work, installer);
  const userHome = makeHome(installer);
  const env = environment(userHome);
  const run = (file) => runOnce(file, args, env);
  let install;
  let bin;
  let packageDir;
  if (installer === "bun") {
    const env = { BUN_INSTALL: home, BUN_INSTALL_CACHE_DIR: path.join(work, "bun-cache") };
    install = sh("bun", ["i", "-g", spec, "--registry", registry], env);
    bin = binFor(installer, home, command);
    packageDir = path.join(home, "install", "global", "node_modules", plan.name);
  } else {
    install = sh("npm", ["i", "-g", "--prefix", home, spec, "--registry", registry]);
    bin = binFor(installer, home, command);
    packageDir = path.join(home, isWindows ? "" : "lib", "node_modules", plan.name);
  }
  if (install.status !== 0) {
    return bad(`${installer}: install of ${spec} failed\n${install.stdout || ""}${install.stderr || ""}`);
  }
  // bun does not run install scripts on a global install. The release must
  // not need one of its own; a dependency's is not the release's business.
  if (ownInstallScripts.length && installer === "bun") {
    bad(`${installer}: the package has its own ${ownInstallScripts.join(", ")} script, which bun does not run for a global install`);
  } else if (/blocked \d+ postinstall/i.test(`${install.stdout}${install.stderr}`)) {
    console.log(`  note  ${installer}: bun did not run an install script of a dependency (\`bun pm -g untrusted\` names it); the package behaves as it does for every bun user`);
  }
  if (!fs.existsSync(bin)) return bad(`${installer}: ${bin} was not created`);
  ok(`${installer}: installed ${spec}`);

  const first = run(bin);
  if (first.code !== 0 || !first.text.includes(expect)) {
    return bad(
      `${installer}: "${opts.run}" exited ${first.code}${first.error ? ` (${first.error.message})` : ""} ` +
        `and should print "${expect}". Output:\n${first.text}`,
    );
  }
  ok(`${installer}: first run works — ${first.text.trim().split("\n")[0].slice(0, 160)}`);

  const second = run(bin);
  if (second.code !== 0 || !second.text.includes(expect)) {
    return bad(`${installer}: second run exited ${second.code}. Output:\n${second.text}`);
  }
  // Binaries the package ships without a command must have arrived as well.
  for (const extra of (plan.extra || {})[hostKey] || []) {
    try {
      const dir = path.dirname(createRequire(path.join(packageDir, "package.json")).resolve(`${plan.name}-${hostKey}/package.json`));
      const file = path.join(dir, "bin", extra + (isWindows ? ".exe" : ""));
      if (fs.existsSync(file)) ok(`${installer}: the \`${extra}\` binary for ${hostKey} is installed beside the package`);
      else bad(`${installer}: ${file} is missing`);
    } catch {
      bad(`${installer}: the platform package ${plan.name}-${hostKey} is not installed`);
    }
  }

  // A command that stays JavaScript has nothing to turn native.
  if (plan.commands && !plan.commands.includes(command)) {
    ok(`${installer}: \`${command}\` is a JavaScript command of this package (second run: ${second.ms.toFixed(0)} ms)`);
    return extras(installer, home, packageDir, userHome);
  }

  const native = path.join(packageDir, plan.launcherDir || "bin", command + (isWindows ? ".exe" : ""));
  if (isWindows) {
    if (!fs.existsSync(native)) {
      return bad(`${installer}: ${native} is missing, so the binary runs from the platform package`);
    }
    ok(`${installer}: native copy is in place beside the launcher`);
    // The package manager's shim must now start that copy, not the launcher.
    if (installer === "bun") {
      const bunx = fs.readFileSync(path.join(home, "bin", `${command}.bunx`));
      const flags = bunx.readUInt16LE(bunx.length - 2);
      const target = bunx.subarray(0, bunx.length - 6).toString("utf16le");
      if (!(flags & 0b100) && target.toLowerCase().endsWith(`${command}.exe`.toLowerCase())) {
        ok(`${installer}: bun's shim starts the binary directly`);
      } else {
        bad(`${installer}: bun's shim still starts the launcher, so every start pays for a JS runtime`);
      }
    } else {
      const cmd = fs.readFileSync(bin, "utf8");
      if (cmd.includes(`${command}.exe"`)) ok(`${installer}: npm's shim starts the binary directly`);
      else bad(`${installer}: npm's shim still starts the launcher, so every start pays for a JS runtime`);
    }
  } else if (isScript(bin)) {
    bad(`${installer}: the command is still a script after the first run, so every start pays for a JS runtime`);
  } else {
    ok(`${installer}: the command is now the native binary itself`);
  }

  // Installing the same version again must leave a working command.
  const again = installer === "bun"
    ? sh("bun", ["i", "-g", spec, "--registry", registry], { BUN_INSTALL: home, BUN_INSTALL_CACHE_DIR: path.join(work, "bun-cache") })
    : sh("npm", ["i", "-g", "--prefix", home, spec, "--registry", registry]);
  const afterReinstall = [run(bin), run(bin)];
  if (again.status !== 0 || afterReinstall.some((r) => r.code !== 0 || !r.text.includes(expect))) {
    bad(`${installer}: the command broke after installing the same version again\n${afterReinstall.map((r) => r.text).join("\n")}`);
  } else {
    ok(`${installer}: still works after installing the same version again`);
  }

  // Start time: the installed command against the binary run directly.
  const best = (file) => Math.min(...Array.from({ length: 7 }, () => run(file).ms));
  const installed = best(bin);
  const direct = best(native);
  ok(
    `${installer}: start time ${installed.toFixed(1)} ms installed, ${direct.toFixed(1)} ms for the binary run directly ` +
      `(first run through the launcher: ${first.ms.toFixed(0)} ms)`,
  );
  timings.push({ installer, first: first.ms, installed, direct });
  extras(installer, home, packageDir, userHome);
}

// The additional commands given with --also.
function extras(installer, home, packageDir, userHome) {
  for (const extra of opts.also) {
    let parsed;
    try {
      parsed = parseLine(extra, hostKey, platformKeys);
    } catch (error) {
      bad(`${installer}: ${error.message}`);
      continue;
    }
    const { line, name, code, wanted, unwanted, who } = parsed;
    const result = runOnce(
      binFor(installer, home, name),
      parsed.args,
      environment(userHome, { realHome: parsed.realHome, trace: Boolean(who) }),
    );
    // The hand-back line answers this test's question. It is not part of
    // what the command prints for its users, so it is taken out again.
    const handedBack = result.stderr.includes(TRACE_LINE);
    const text = result.stdout + result.stderr.split(`${TRACE_LINE}\n`).join("").split(TRACE_LINE).join("");
    const unseen = who ? cannotTell(packageDir, name) : "";
    if (result.code !== code || !text.includes(wanted)) {
      bad(`${installer}: \`${line}\` exited ${result.code} and should exit ${code} and print "${wanted}". Output:\n${text}`);
    } else if (unwanted && text.includes(unwanted)) {
      bad(`${installer}: \`${line}\` must not print "${unwanted}". Output:\n${text}`);
    } else if (unseen) {
      bad(`${installer}: \`${line}\` is marked [${who}], but who answered it cannot be seen: ${unseen}.`);
    } else if (who === "native" && handedBack) {
      bad(`${installer}: \`${line}\` is marked [native], but the binary handed it back to the JavaScript. Output:\n${text}`);
    } else if (who === "handback" && !handedBack) {
      bad(`${installer}: \`${line}\` is marked [handback], but the binary answered it itself. Output:\n${text}`);
    } else {
      const by = who === "native" ? ", answered by the binary itself" : who === "handback" ? ", handed back to the JavaScript" : "";
      ok(`${installer}: \`${line}\` works${by} — ${text.trim().split("\n")[0].slice(0, 120)}`);
    }
  }
}

// The registry runs as its own process: the checks below block this one.
function startLocalRegistry() {
  const child = spawn(process.execPath, [path.join(HERE, "registry.mjs"), path.join(work, "registry")], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`local registry exited with ${code}`)));
    child.stdout.once("data", (line) => resolve({ url: String(line).trim(), close: () => child.kill() }));
  });
}

let registry = typeof opts.registry === "string" ? opts.registry : null;
let local = null;
try {
  console.log(`== ${plan.name}@${plan.version} on ${process.platform}-${process.arch}`);
  if (!registry) {
    local = await startLocalRegistry();
    registry = local.url;
    const npmrc = path.join(work, "npmrc");
    fs.writeFileSync(npmrc, `//${registry.replace(/^https?:\/\//, "")}/:_authToken=smoke\n`);
    process.env.NPM_CONFIG_USERCONFIG = npmrc; // npm
    process.env.NPM_CONFIG_TOKEN = "smoke"; // bun publish
    execFileSync(process.execPath, [path.join(HERE, "pack.mjs"), "publish", "--out", dist, "--registry", registry], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    ok(`published to a local registry (${registry})`);
  }
  if (!everyRealHome) findRuntimes();
  const wanted = typeof opts.installer === "string" ? [opts.installer] : ["bun", "npm"];
  const usable = wanted.filter(has);
  if (!usable.length) bad(`none of ${wanted.join(", ")} is installed`);
  for (const installer of usable) check(installer, registry);
} finally {
  if (local) local.close();
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
if (process.env.GITHUB_STEP_SUMMARY && timings.length) {
  const rows = timings.map(
    (t) =>
      `| ${process.platform}-${process.arch} | ${t.installer} | ${t.first.toFixed(0)} ms | ${t.installed.toFixed(1)} ms | ${t.direct.toFixed(1)} ms |`,
  );
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `| Platform | Installed with | First run | Later runs | Binary run directly |\n|---|---|---|---|---|\n${rows.join("\n")}\n`,
  );
}
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
