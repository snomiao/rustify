// Unit tests for the shim rewriting in templates/npm/launcher.cjs.
//
// The `.bunx` samples are built by an encoder written from bun's
// `BinLinkingShim::encode_into`, independently of the code under test. These
// tests catch offset mistakes; whether bun's real shim accepts the result is
// checked by smoke.mjs on Windows runners.
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const launcher = require("../../templates/npm/launcher.cjs");
const { directBunx, bunxTarget, retargetBun, retargetNpm, BUNX_VERSION } = launcher;

function u16(...values) {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
}
function u32(...values) {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32LE(v, i * 4));
  return b;
}
// bun's encoder: [bin_path]["][0]([launcher][space][u32 path bytes][u32 launcher bytes incl. space])[flags]
function encode(binPath, launcherName, { absolute = false, version = BUNX_VERSION } = {}) {
  const isNode = launcherName === "node";
  const isNodeOrBun = isNode || launcherName === "bun" || launcherName === "bun run";
  const flags =
    (launcherName && isNodeOrBun ? 1 : 0) |
    (isNode ? 2 : 0) |
    (launcherName ? 4 : 0) |
    (absolute ? 8 : 0) |
    (version << 4);
  const parts = [Buffer.from(binPath, "utf16le"), u16(0x22, 0)];
  if (launcherName) {
    parts.push(Buffer.from(launcherName, "utf16le"), u16(0x20));
    parts.push(u32(binPath.length * 2, launcherName.length * 2 + 2));
  }
  parts.push(u16(flags));
  return Buffer.concat(parts);
}

const TARGET = "install\\global\\node_modules\\pkg\\bin\\toy";

test("a shebang .bunx becomes the direct form with the suffix added", () => {
  for (const name of ["bun", "node", "bun run"]) {
    assert.deepEqual(directBunx(encode(TARGET, name), ".exe"), encode(`${TARGET}.exe`, null));
  }
});

test("the absolute-target flag survives", () => {
  const abs = "C:\\Users\\me\\AppData\\Roaming\\pkg\\bin\\toy";
  assert.deepEqual(
    directBunx(encode(abs, "bun", { absolute: true }), ".exe"),
    encode(`${abs}.exe`, null, { absolute: true }),
  );
});

test("non-ASCII paths keep their bytes", () => {
  const p = "install\\global\\node_modules\\包\\bin\\工具";
  assert.deepEqual(directBunx(encode(p, "bun"), ".exe"), encode(`${p}.exe`, null));
});

test("anything unfamiliar is left alone", () => {
  const good = encode(TARGET, "bun");
  assert.equal(directBunx(encode(TARGET, null), ".exe"), null, "already direct");
  assert.equal(directBunx(encode(TARGET, "bun", { version: BUNX_VERSION + 1 }), ".exe"), null, "newer format");
  assert.equal(directBunx(good.subarray(0, good.length - 2), ".exe"), null, "truncated");
  assert.equal(directBunx(good.subarray(1), ".exe"), null, "odd length");
  assert.equal(directBunx(Buffer.concat([u16(0x41), good]), ".exe"), null, "length fields do not add up");
  assert.equal(directBunx(Buffer.alloc(0), ".exe"), null, "empty");
  assert.equal(directBunx("text", ".exe"), null, "not a buffer");
});

test("the target can be read back from both forms", () => {
  assert.deepEqual(bunxTarget(encode(TARGET, "bun")), { path: TARGET, absolute: false });
  assert.deepEqual(bunxTarget(encode(`${TARGET}.exe`, null)), { path: `${TARGET}.exe`, absolute: false });
  assert.equal(bunxTarget(encode(TARGET, "bun", { version: 1 })), null);
});

test("retargetBun rewrites only a shim that starts this launcher", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-unit-"));
  try {
    const shimDir = path.join(home, "bin");
    const rel = path.join("install", "global", "node_modules", "pkg", "bin", "toy");
    const launcherPath = path.join(home, rel);
    fs.mkdirSync(shimDir, { recursive: true });
    const file = path.join(shimDir, "toy.bunx");

    fs.writeFileSync(file, encode(rel, "bun"));
    assert.equal(retargetBun(shimDir, "toy", path.join(home, "elsewhere", "toy")), false);
    assert.deepEqual(fs.readFileSync(file), encode(rel, "bun"), "a foreign shim is not touched");

    assert.equal(retargetBun(shimDir, "toy", launcherPath), true);
    assert.deepEqual(fs.readFileSync(file), encode(`${rel}.exe`, null));
    assert.equal(retargetBun(shimDir, "toy", launcherPath), false, "second call has nothing to do");
    assert.equal(retargetBun(shimDir, "missing", launcherPath), false);
    assert.deepEqual(fs.readdirSync(shimDir), ["toy.bunx"], "no temp files left behind");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("retargetNpm rewrites the three shims of this launcher and no others", () => {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-unit-"));
  try {
    const rel = path.join("node_modules", "pkg", "bin", "toy");
    const launcherPath = path.join(prefix, rel);
    const native = `${launcherPath}.exe`;
    const posix = rel.split(path.sep).join("/");
    // Shaped like cmd-shim's output.
    fs.writeFileSync(path.join(prefix, "toy.cmd"), `@ECHO off\r\n"%_prog%"  "%dp0%${path.sep}${rel}" %*\r\n`);
    fs.writeFileSync(path.join(prefix, "toy.ps1"), `& "$basedir/node$exe"  "$basedir/${posix}" $args\n`);
    fs.writeFileSync(path.join(prefix, "toy"), `exec node  "$basedir/${posix}" "$@"\n`);
    fs.writeFileSync(path.join(prefix, "other.cmd"), `"%dp0%${path.sep}node_modules${path.sep}other${path.sep}cli.js" %*\r\n`);

    assert.equal(retargetNpm(prefix, "other", launcherPath, native), false);
    assert.equal(retargetNpm(prefix, "toy", launcherPath, native), true);
    const cmd = fs.readFileSync(path.join(prefix, "toy.cmd"), "utf8");
    assert.equal(cmd, `@ECHO off\r\n"%~dp0${rel}.exe" %*\r\n`);
    assert.match(fs.readFileSync(path.join(prefix, "toy.ps1"), "utf8"), /Join-Path \$PSScriptRoot "node_modules\/pkg\/bin\/toy\.exe"/);
    assert.match(fs.readFileSync(path.join(prefix, "toy"), "utf8"), /exec "\$basedir\/node_modules\/pkg\/bin\/toy\.exe" "\$@"/);
    assert.match(fs.readFileSync(path.join(prefix, "other.cmd"), "utf8"), /other/);
    assert.equal(retargetNpm(prefix, "toy", launcherPath, native), false, "second call has nothing to do");
  } finally {
    fs.rmSync(prefix, { recursive: true, force: true });
  }
});

// ─────────────────────────── the binary's environment ───────────────────────

const { environmentOf, binaryEnvironment } = launcher;
const isWindows = process.platform === "win32";
const entries = (...lines) => lines.map((line) => Buffer.from(line, "latin1"));

test("the environment is read as the system reads it: the first of a name, '=' inside a value, an empty value", () => {
  assert.deepEqual(environmentOf(entries("A=1", "EQ=a=b=c", "E=", "A=2", "NOEQUALS", "=x"), false), { A: "1", EQ: "a=b=c", E: "", "": "x" });
  // A name that is not UTF-8 is left out; a value that is not keeps its other bytes.
  assert.deepEqual(environmentOf([Buffer.from("BAD\xe9NAME=x", "latin1"), Buffer.from("V=a\xffb", "latin1"), Buffer.from("U=\u00e9")], false), { V: "a\ufffdb", U: "\u00e9" });
  // A byte-order mark is part of the name, not taken off it.
  assert.deepEqual(Object.keys(environmentOf([Buffer.from("\ufeffBOM=1")], false)), ["\ufeffBOM"]);
  // Windows: a name may start with "=", and two names in different letter
  // case are one variable, the first.
  assert.deepEqual(environmentOf(["=C:=C:\\Users", "Foo=lower", "FOO=upper", "Path=x", "LONE\udc00=1", "V=a\ud800b"], true), {
    "=C:": "C:\\Users",
    Foo: "lower",
    Path: "x",
    V: "a\ud800b",
  });
  // As Windows 11 compares names (measured with SetEnvironmentVariableW and
  // GetEnvironmentVariableW): one UTF-16 unit at a time, so "été" and "ÉTÉ"
  // are one variable, and so are "ǆ" and "Ǆ", "ɐ" and "Ɐ"; "straße" and
  // "STRASSE" are two ("ß" has no capital of one unit), and so are "ı" and
  // "I", "ſ" and "S", "ς" and "Σ", "ǅ" and "Ǆ" (capitals whose small letter
  // is another one), and a pair of surrogates and its capital ("𐐨", "𐐀").
  const one = [["été", "ÉTÉ"], ["ǆ", "Ǆ"], ["ɐ", "Ɐ"], ["path", "PATH"]];
  const two = [["straße", "STRASSE"], ["ı", "I"], ["ſ", "S"], ["ς", "Σ"], ["ǅ", "Ǆ"], ["\u{10428}", "\u{10400}"]];
  for (const [a, b] of one) assert.deepEqual(environmentOf([`V${a}=1`, `V${b}=2`], true), { [`V${a}`]: "1" }, `${a} and ${b} are one`);
  for (const [a, b] of two) assert.deepEqual(environmentOf([`V${a}=1`, `V${b}=2`], true), { [`V${a}`]: "1", [`V${b}`]: "2" }, `${a} and ${b} are two`);
  assert.equal(launcher.windowsKey("straße été path"), "STRAßE ÉTÉ PATH");
});

test("the root variable is set, on Windows in place of one in other letters; without entries process.env is used", () => {
  // A copy of process.env, which on Windows spells PATH as it is spelt there (Path).
  const isProcessEnv = (env) => Object.keys(process.env).every((name) => env[name] === process.env[name]);
  const env = binaryEnvironment(null, "PKG_ROOT", "/root", false);
  assert.equal(env.PKG_ROOT, "/root");
  assert.ok(isProcessEnv(env), "process.env, copied");
  // Entries this process's own environment has are taken as they are.
  const own = Object.keys(process.env).find((name) => !name.startsWith("="));
  const line = `${own}=${process.env[own]}`;
  const read = binaryEnvironment([isWindows ? line : Buffer.from(line)], "PKG_ROOT", "/root", isWindows);
  assert.ok(read[own] === process.env[own] && read.PKG_ROOT === "/root" && Object.keys(read).length === 2, "the entries and the root, nothing else");
  // A name process.env lacks means something else was read: process.env is used instead.
  const instead = binaryEnvironment([isWindows ? "NOT_IN_PROCESS_ENV_X=1" : Buffer.from("NOT_IN_PROCESS_ENV_X=1")], "PKG_ROOT", "/r", isWindows);
  assert.ok(isProcessEnv(instead) && !("NOT_IN_PROCESS_ENV_X" in instead), "process.env instead");
  // On Windows a name with a unit outside ASCII does not count: bun leaves
  // some of them out of process.env there.
  const unicode = binaryEnvironment([line, "NOT_IN_PROCESS_ENV_aß=1"], "PKG_ROOT", "/r", true);
  assert.equal(unicode["NOT_IN_PROCESS_ENV_aß"], "1", "kept, and the entries are taken");
  // So does nothing read, or nothing usable, where process.env has something.
  for (const nothing of [[], [isWindows ? "NOEQUALS" : Buffer.from("NOEQUALS")]]) {
    const empty = binaryEnvironment(nothing, "PKG_ROOT", "/r", isWindows);
    assert.ok(isProcessEnv(empty) && empty.PKG_ROOT === "/r", "process.env for an empty read");
  }
  // Windows: the root variable replaces one of the same name in other letters.
  const spelt = Object.keys(binaryEnvironment([`${own.toLowerCase()}=x`], own.toUpperCase() === own ? `${own[0]}${own.slice(1).toLowerCase()}` : own.toUpperCase(), "/r", true));
  assert.equal(spelt.length, 1, "one variable, in the letters of the root variable");
});

// The generated launcher, run by bun in a directory with .env files, in front
// of a stand-in binary that prints its environment: a script that runs
// /usr/bin/env on Linux and macOS, a link to this node on Windows (which then
// runs a script that prints process.env; node reads no .env file).
// (node 20's test runner skips a test whose `skip` is null: false it is.)
const BUN = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0 ? false : "bun is not installed here";

function installed(runtime) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-unit-"));
  const key = `${process.platform === "android" ? "linux" : process.platform}-${process.arch}`;
  const modules = path.join(dir, "node_modules");
  const root = path.join(modules, "pkg");
  const platform = path.join(modules, `pkg-${key}`);
  fs.mkdirSync(path.join(root, "rustify"), { recursive: true });
  fs.mkdirSync(path.join(platform, "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: "pkg",
    version: "1.0.0",
    optionalDependencies: { [`pkg-${key}`]: `npm:pkg@1.0.0-${key}` },
    rustify: { bins: { tool: "tool" }, rootEnv: "PKG_ROOT" },
  }));
  fs.writeFileSync(path.join(root, "rustify", "package.json"), JSON.stringify({ type: "commonjs" }));
  const template = fs.readFileSync(new URL("../../templates/npm/launcher.cjs", import.meta.url), "utf8");
  fs.writeFileSync(path.join(root, "rustify", "tool"), template.replace("__RUNTIME__", runtime), { mode: 0o755 });
  fs.writeFileSync(path.join(platform, "package.json"), JSON.stringify({ name: "pkg", version: `1.0.0-${key}` }));
  const standIn = path.join(platform, "bin", isWindows ? "tool.exe" : "tool");
  if (isWindows) {
    try {
      fs.linkSync(process.execPath, standIn);
    } catch {
      fs.copyFileSync(process.execPath, standIn);
    }
  } else {
    // A script: macOS kills a copy of /usr/bin/env. bash, which passes every
    // name on; dash (Ubuntu's sh) drops one that is not a shell name (OWN_aß).
    fs.writeFileSync(standIn, "#!/bin/bash\nexec /usr/bin/env\n", { mode: 0o755 });
  }
  const printer = path.join(dir, "print-env.cjs");
  fs.writeFileSync(printer, 'process.stdout.write(Object.entries(process.env).map(([k, v]) => `${k}=${v}\\n`).join(""));\n');
  // The user's working directory, with what bun loads from it.
  const cwd = path.join(dir, "work");
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, ".env"), "FROM_DOTENV=yes\nSHARED=from-dotenv\nEMPTY=from-dotenv\nNODE_ENV=production\n");
  fs.writeFileSync(path.join(cwd, ".env.local"), "FROM_LOCAL=yes\n");
  fs.writeFileSync(path.join(cwd, ".env.production"), "FROM_PRODUCTION=yes\n");
  fs.writeFileSync(path.join(cwd, ".env.development"), "FROM_DEVELOPMENT=yes\n");
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  // As the launcher names it: macOS hands out temp directories behind a link.
  return { dir, root: fs.realpathSync(root), cwd, home, launcher: path.join(root, "rustify", "tool"), printer, standIn };
}

const DOTENV_NAMES = ["FROM_DOTENV", "FROM_LOCAL", "FROM_PRODUCTION", "FROM_DEVELOPMENT", "NODE_ENV"];

// The user's environment: this one without anything that would change what
// bun or node does, a home directory of its own, and the variables under test.
function userEnvironment(pkg, extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(BUN_|NODE_|npm_|XDG_)/i.test(name) || [...DOTENV_NAMES, "SHARED", "EMPTY", "EQ", "OWN", "PKG_ROOT", "RUSTIFY_NO_LINK"].includes(name.toUpperCase())) continue;
    env[name] = value;
  }
  // OWN_aß: bun 1.4.2 leaves such a name out of process.env on Windows.
  return { ...env, HOME: pkg.home, USERPROFILE: pkg.home, SHARED: "mine", EMPTY: "", EQ: "a=b=c", OWN: "mine", OWN_aß: "mine", ...extra };
}

// What the stand-in binary saw, as name → value (the first of a name).
function runLauncher(pkg, { runtime = "bun", env, flags = [] }) {
  const args = isWindows ? [pkg.printer] : [];
  const result = spawnSync(runtime, [...flags, pkg.launcher, ...args], { cwd: pkg.cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, `the launcher failed: ${result.error || ""}${result.stderr}`);
  const seen = {};
  for (const line of result.stdout.split("\n")) {
    const eq = line.indexOf("=", 1);
    if (eq > 0 && !(line.slice(0, eq) in seen)) seen[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return seen;
}

function assertUserEnvironment(seen, pkg) {
  for (const name of DOTENV_NAMES) assert.equal(seen[name], undefined, `${name} from .env reached the binary`);
  assert.equal(seen.SHARED, "mine", "a variable of the user's that .env also names keeps the user's value");
  assert.equal(seen.EMPTY, "", "and so does an empty one");
  assert.equal(seen.EQ, "a=b=c");
  assert.equal(seen.OWN, "mine");
  assert.equal(seen.OWN_aß, "mine", "a name with a letter outside ASCII");
  assert.equal(seen.PKG_ROOT, pkg.root, "the root variable names the package");
}

test("under bun, the binary gets the user's environment, not the .env files bun loaded", { skip: BUN }, () => {
  const pkg = installed("bun");
  try {
    const env = userEnvironment(pkg, { RUSTIFY_NO_LINK: "1" });
    // bun did load them, so the check below means something.
    const loaded = spawnSync("bun", ["-e", "console.log(process.env.FROM_DOTENV, process.env.SHARED)"], { cwd: pkg.cwd, env, encoding: "utf8" });
    assert.equal(loaded.stdout.trim(), "yes mine");
    assertUserEnvironment(runLauncher(pkg, { env }), pkg);
    // A bun without process.execve (before 1.4.0) starts the binary as a child, with the same environment.
    const noExecve = path.join(pkg.dir, "no-execve.cjs");
    fs.writeFileSync(noExecve, "delete process.execve;\n");
    assertUserEnvironment(runLauncher(pkg, { env, flags: ["--preload", noExecve] }), pkg);
  } finally {
    fs.rmSync(pkg.dir, { recursive: true, force: true });
  }
});

test("under bun started by fork, the IPC channel bun took is not passed on, and .env is not either", { skip: BUN }, async () => {
  const pkg = installed("bun");
  try {
    const env = userEnvironment(pkg, { RUSTIFY_NO_LINK: "1" });
    const child = fork(pkg.launcher, isWindows ? [pkg.printer] : [], { execPath: "bun", cwd: pkg.cwd, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const code = await new Promise((resolve) => child.on("exit", resolve));
    assert.equal(code, 0, stderr);
    const seen = Object.fromEntries(stdout.split("\n").filter((l) => l.indexOf("=", 1) > 0).map((l) => [l.slice(0, l.indexOf("=", 1)), l.slice(l.indexOf("=", 1) + 1)]));
    assertUserEnvironment(seen, pkg);
    assert.equal(seen.NODE_CHANNEL_FD, undefined);
  } finally {
    fs.rmSync(pkg.dir, { recursive: true, force: true });
  }
});

test("under bun, where the environment cannot be read, the binary gets process.env as before", { skip: BUN }, () => {
  const pkg = installed("bun");
  try {
    // Stands for a system where /proc or bun:ffi is not there.
    const unreadable = path.join(pkg.dir, "unreadable.cjs");
    fs.writeFileSync(
      unreadable,
      'const ffi = require("bun:ffi"); ffi.dlopen = () => { throw new Error("no bun:ffi"); };\n' +
        'const fs = require("fs"); const read = fs.readFileSync;\n' +
        'fs.readFileSync = function (file, ...rest) { if (String(file) === "/proc/self/environ") throw new Error("no /proc"); return read.call(this, file, ...rest); };\n',
    );
    const seen = runLauncher(pkg, { env: userEnvironment(pkg, { RUSTIFY_NO_LINK: "1" }), flags: ["--preload", unreadable] });
    assert.equal(seen.FROM_DOTENV, "yes", "the fallback is bun's process.env, .env included");
    assert.equal(seen.SHARED, "mine");
    assert.equal(seen.PKG_ROOT, pkg.root);
  } finally {
    fs.rmSync(pkg.dir, { recursive: true, force: true });
  }
});

test("under bun, the first run, which links the binary, passes the user's environment too, also a large one", { skip: BUN }, () => {
  const pkg = installed("bun");
  try {
    // 200 variables of 1000 characters and one of 30000 (Windows takes at most 32767).
    const large = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`LARGE_${i}`, `${i}`.padEnd(1000, "x")]));
    large.HUGE = "h".repeat(30000);
    const seen = runLauncher(pkg, { env: userEnvironment(pkg, large) });
    assertUserEnvironment(seen, pkg);
    for (const [name, value] of Object.entries(large)) assert.equal(seen[name], value, name);
    if (!isWindows) assert.ok(fs.readFileSync(pkg.launcher).equals(fs.readFileSync(pkg.standIn)), "the launcher was replaced by the binary");
    else assert.ok(fs.existsSync(path.join(pkg.root, "rustify", "tool.exe")), "a native copy is beside the launcher");
  } finally {
    fs.rmSync(pkg.dir, { recursive: true, force: true });
  }
});

test("under node, the binary gets process.env, which holds no .env file", () => {
  const pkg = installed("node");
  try {
    assertUserEnvironment(runLauncher(pkg, { runtime: process.execPath, env: userEnvironment(pkg, { RUSTIFY_NO_LINK: "1" }) }), pkg);
  } finally {
    fs.rmSync(pkg.dir, { recursive: true, force: true });
  }
});
