#!/usr/bin/env node
// rustify parity runner v2 — zero dependencies, runs on node or bun.
//
// Runs the same command lines against two implementations of a CLI and fails
// unless they behave the same: stdout, stderr, exit code, and whatever they
// leave behind. It is the proof behind a `verified` entry in a parity ledger.
//
//   parity.mjs --cases parity.json --ts "bun ts/cli.ts" --rs "rs/target/release/mycli"
//              [--filter <text>] [--show] [--keep]
//
// A binary that hands some invocations back to the JavaScript passes those
// cases by construction. To prove which cases the binary answers itself:
//
//   parity.mjs --cases parity.json --rs "rs/target/release/mycli" \
//              --handback MYCLI_PACKAGE_ROOT=dist/cli.js
//
// runs only the binary, with a stand-in package whose JavaScript entry does
// nothing but say it was reached, and fails unless exactly the cases marked
// "handback" got there.
//
// Every case runs once per implementation, each time in its own fresh
// directory with its own empty HOME, so nothing leaks between runs or in from
// your machine.
//
// parity.json:
//   {
//     "env": { "TZ": "UTC" },                    // for every case
//     "normalize": [["\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z", "<TIME>"]],
//     "cases": [
//       {
//         "name": "init creates the config",
//         "args": ["init", "--yes"],
//         "stdin": "",                           // optional
//         "env": { "MYCLI_TOKEN": "x" },         // optional
//         "files": { "a.txt": "hello\n" },       // created in the directory first
//         "setup": ["git init -q"],              // shell commands run first
//         "after": ["cat .myclirc", "ls -a"],    // their output is compared too
//         "normalize": [["pid \\d+", "pid <N>"]], // optional, on top of the global list
//         "handback": "usage errors belong to yargs"  // optional: this case is
//                                  // MEANT to reach the JavaScript, and why
//       }
//     ]
//   }
//
// <CWD> and <HOME> in `args`, `env`, `stdin`, `files`, `setup` and `after`
// stand for the directories of the run.
//
// The paths of the temp directories are replaced by <CWD> and <HOME> before
// comparing. Anything else that legitimately varies between two runs
// (timestamps, random ids) needs a `normalize` rule; keep those rare, each one
// is a hole in the proof.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.cases || !opts.rs || (!opts.ts && !opts.handback)) {
  console.error(
    'usage: parity.mjs --cases <file.json> --ts "<command>" --rs "<command>" [--filter <text>] [--show] [--keep]\n' +
      '       parity.mjs --cases <file.json> --rs "<command>" --handback <ROOT_ENV>=<js entry> [--filter <text>]',
  );
  process.exit(2);
}
const isWindows = process.platform === "win32";
const launchDir = process.cwd();
const spec = JSON.parse(fs.readFileSync(opts.cases, "utf8"));
// A command is run from another directory, so anything in it that names a
// file here has to become absolute.
const command = (text) =>
  String(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (fs.existsSync(path.resolve(launchDir, token)) && /[\\/.]/.test(token) ? path.resolve(launchDir, token) : token));
const impls = { ts: opts.ts ? command(opts.ts) : null, rs: command(opts.rs) };
const MARKER = "__RUSTIFY_HANDED_BACK__";
const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rustify-parity-"));

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runCase(testCase, impl, index, extraEnv = {}) {
  const root = path.join(work, `${index}-${impl}`);
  const cwd = path.join(root, "cwd");
  const home = path.join(root, "home");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  // <CWD> and <HOME> in what a case says stand for this run's directories.
  const here = (text) => String(text).split("<CWD>").join(cwd).split("<HOME>").join(home);
  const hereAll = (object) => Object.fromEntries(Object.entries(object || {}).map(([k, v]) => [k, here(v)]));
  for (const [file, content] of Object.entries(testCase.files || {})) {
    const target = path.join(cwd, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, here(content));
  }
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    // Outside HOME: a JavaScript runtime fills its cache, a native binary
    // does not, and that must not show up as a difference in HOME.
    XDG_CACHE_HOME: path.join(root, "cache"),
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    ...(isWindows ? { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PATHEXT: process.env.PATHEXT } : {}),
    ...hereAll(spec.env),
    ...hereAll(testCase.env),
    ...extraEnv,
  };
  const shell = (line) => spawnSync(here(line), { cwd, env, shell: true, encoding: "utf8", timeout: 120_000 });
  for (const line of testCase.setup || []) {
    const result = shell(line);
    if (result.status !== 0) {
      return { broken: `setup \`${line}\` exited ${result.status}: ${result.stderr || result.stdout}` };
    }
  }
  const [program, ...baseArgs] = impls[impl];
  const result = spawnSync(program, [...baseArgs, ...(testCase.args || []).map(here)], {
    cwd,
    env,
    input: here(testCase.stdin ?? ""),
    encoding: "utf8",
    timeout: (testCase.timeout || 120) * 1000,
  });
  if (result.error && result.status === null) return { broken: `could not run ${program}: ${result.error.message}` };
  const rules = [...(spec.normalize || []), ...(testCase.normalize || [])].map(([pattern, to]) => [new RegExp(pattern, "g"), to]);
  const clean = (text) => {
    let out = String(text ?? "");
    for (const [dir, name] of [[cwd, "<CWD>"], [home, "<HOME>"], [root, "<ROOT>"]]) {
      out = out.replace(new RegExp(escapeRegExp(dir), "g"), name);
      if (isWindows) out = out.replace(new RegExp(escapeRegExp(dir.replace(/\\/g, "/")), "g"), name);
    }
    for (const [pattern, to] of rules) out = out.replace(pattern, to);
    return out;
  };
  const observed = { "exit code": String(result.status), stdout: clean(result.stdout), stderr: clean(result.stderr) };
  for (const line of testCase.after || []) {
    const probe = shell(line);
    observed[`after: ${line}`] = clean(`${probe.stdout}${probe.stderr}[exit ${probe.status}]`);
  }
  return { observed };
}

function show(label, text) {
  const lines = text.split("\n");
  const shown = lines.slice(0, 30).map((l) => `        ${l}`);
  if (lines.length > 30) shown.push(`        … ${lines.length - 30} more line(s)`);
  return `      ${label}:\n${shown.join("\n")}`;
}

let failed = 0;
let ran = 0;

// --handback ROOT_ENV=entry: which cases does the binary answer itself?
function handbackCheck() {
  const eq = String(opts.handback).indexOf("=");
  if (eq < 1) {
    console.error("--handback needs <ROOT_ENV>=<js entry>, e.g. MYCLI_PACKAGE_ROOT=dist/cli.js");
    process.exit(2);
  }
  const [rootEnv, entry] = [opts.handback.slice(0, eq), opts.handback.slice(eq + 1)];
  const standIn = path.join(work, "stand-in");
  fs.mkdirSync(path.dirname(path.join(standIn, entry)), { recursive: true });
  fs.writeFileSync(path.join(standIn, "package.json"), JSON.stringify({ name: "stand-in", version: "0.0.0" }));
  fs.writeFileSync(path.join(standIn, entry), `console.log(${JSON.stringify(MARKER)});\n`);
  let native = 0;
  let back = 0;
  spec.cases.forEach((testCase, index) => {
    if (typeof opts.filter === "string" && !testCase.name.includes(opts.filter)) return;
    ran++;
    const run = runCase(testCase, "rs", index, { [rootEnv]: standIn });
    if (run.broken) {
      failed++;
      return console.log(`  BROKEN  ${testCase.name}\n      ${run.broken}`);
    }
    const reached = run.observed.stdout.includes(MARKER);
    if (reached) back++;
    else native++;
    if (reached === Boolean(testCase.handback)) return;
    failed++;
    console.log(
      reached
        ? `  WRONG   ${testCase.name}\n      reached the JavaScript, but the case does not say "handback"`
        : `  WRONG   ${testCase.name}\n      was answered by the binary, but the case says it is handed back (${testCase.handback})`,
    );
  });
  if (ran && !failed) console.log(`${native} case(s) answered by the binary, ${back} handed back to the JavaScript, as the cases say`);
}

try {
  if (opts.handback) handbackCheck();
  else spec.cases.forEach((testCase, index) => {
    if (typeof opts.filter === "string" && !testCase.name.includes(opts.filter)) return;
    ran++;
    const ts = runCase(testCase, "ts", index);
    const rs = runCase(testCase, "rs", index);
    const broken = ts.broken || rs.broken;
    if (broken) {
      failed++;
      console.log(`  BROKEN  ${testCase.name}\n      ${broken}`);
      return;
    }
    const differing = Object.keys(ts.observed).filter((k) => ts.observed[k] !== rs.observed[k]);
    if (!differing.length) {
      console.log(`  same    ${testCase.name}`);
      // --show: what was compared, so a case that proves nothing is visible.
      if (opts.show) for (const [k, v] of Object.entries(ts.observed)) console.log(show(k, v));
      return;
    }
    failed++;
    console.log(`  DIFFER  ${testCase.name}  (${differing.join(", ")})`);
    for (const k of differing) {
      console.log(`    ${k}`);
      console.log(show("TypeScript", ts.observed[k]));
      console.log(show("Rust", rs.observed[k]));
    }
  });
} finally {
  if (opts.keep) console.log(`kept ${work}`);
  else fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
if (!ran) {
  console.log("no case ran");
  process.exit(2);
}
if (opts.handback) {
  if (failed) console.log(`${failed} of ${ran} case(s) went the wrong way`);
} else {
  console.log(failed ? `${failed} of ${ran} case(s) differ` : `all ${ran} case(s) behave the same`);
}
process.exit(failed ? 1 : 0);
