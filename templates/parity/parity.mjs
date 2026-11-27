#!/usr/bin/env node
// rustify parity runner v4 — zero dependencies, runs on node or bun.
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
//         "env": { "MYCLI_TOKEN": "x",           // optional
//                  "XDG_CONFIG_HOME": null },    // null: the variable is not set
//         "files": { "a.txt": "hello\n" },       // created in the directory first
//         "setup": ["git init -q"],              // shell commands run first
//         "after": ["cat .myclirc", "ls -a"],    // their output is compared too
//         "normalize": [["pid \\d+", "pid <N>"]], // optional, on top of the global list
//         "timeout": 30,                         // optional, in seconds (120)
//         "handback": "usage errors belong to yargs"  // optional: this case is
//                                  // MEANT to reach the JavaScript, and why
//       }
//     ]
//   }
//
// <CWD> and <HOME> in `args`, `env`, `stdin`, `files`, `setup` and `after`
// stand for the directories of the run, and <REPO> for the directory the
// runner was started in, so a committed cases file needs no machine's path.
// Each run also gets its own empty temp directory. <ROOT> stands for the
// directory that holds all of them: the place for what the test itself keeps
// per run (a log of requests, a copy of the package), outside everything the
// program looks at. The runner's own names there are cwd, home, tmp, cache
// and runner; any other is free.
//
// The paths of these directories are replaced by <CWD>, <HOME> and <ROOT>
// before comparing. Anything else that legitimately varies between two runs
// (timestamps, random ids) needs a `normalize` rule; keep those rare, each one
// is a hole in the proof.
//
// Variables. A program sees PATH, an empty HOME (and USERPROFILE), the three
// XDG directories, TMPDIR, then the `env` of the cases file, then the case's.
// A value of null removes the variable instead: in the case's `env` to take
// out what the cases file's `env` or the runner sets, in the cases file's
// `env` to take out what the runner sets. Nothing else comes in from the
// machine: no TERM, NO_COLOR or FORCE_COLOR.
//
// The run's directory is <temp>/rustify-parity-XXXXXX and holds a file IN-USE
// while the run lasts. If that directory, that file, or the <ROOT> of the case
// that is running is removed under the runner (a clean-up of the temp
// directory by someone else), the runner stops with one message and exit code
// 3 instead of reporting differences that are not the port's. Remove such a
// directory by its exact name only, never by pattern: other runs keep theirs
// beside it. --keep leaves it there, without the IN-USE file, and prints its
// path.
//
// Exit code: 0 all the same; 1 some case differs, is broken or went the wrong
// way; 2 nothing could be run (usage, a mistake in the cases file, no case
// selected); 3 the run's directory disappeared.

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
// A mistake in the command line or the cases file: nothing is run.
function mistake(text) {
  console.error(`parity: ${text}`);
  process.exit(2);
}
const isWindows = process.platform === "win32";
const launchDir = process.cwd();
let spec;
try {
  spec = JSON.parse(fs.readFileSync(opts.cases, "utf8"));
} catch (error) {
  mistake(`${opts.cases}: ${error.message}`);
}
if (!Array.isArray(spec?.cases)) mistake(`${opts.cases} has no "cases" list`);
// A command is run from another directory, so anything in it that names a
// file here has to become absolute.
const command = (text) =>
  String(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (fs.existsSync(path.resolve(launchDir, token)) && /[\\/.]/.test(token) ? path.resolve(launchDir, token) : token));
const impls = { ts: opts.ts ? command(opts.ts) : null, rs: command(opts.rs) };
const MARKER = "__RUSTIFY_HANDED_BACK__";

const selected = spec.cases
  .map((testCase, index) => ({ testCase, index }))
  .filter(({ testCase }) => typeof opts.filter !== "string" || testCase.name.includes(opts.filter));

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const work = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rustify-parity-"));
// Tells whoever finds the directory whose it is. It is also how the runner
// notices that the directory was emptied under it: a clean-up that races the
// run can fail to remove the directory itself and still take this file.
const inUse = path.join(work, "IN-USE");
fs.writeFileSync(
  inUse,
  `A rustify parity run is working in this directory: process ${process.pid} on ${os.hostname()}, started ${new Date().toISOString()} in ${launchDir}.\nDo not remove it while that process is alive.\n`,
);

// What must still be there for a result to mean anything. Only what nothing
// but a clean-up from outside removes: a case may remove its own HOME, temp
// or working directory on purpose, and that is compared like anything else.
const mine = [work, inUse];
class Vanished extends Error {}
function stillThere(...more) {
  for (const place of [...mine, ...more]) if (!fs.existsSync(place)) throw new Vanished(place);
}

function runCase(testCase, impl, index, extraEnv = {}) {
  const root = path.join(work, `${index}-${impl}`);
  stillThere();
  let run;
  try {
    run = runIn(root, testCase, impl, extraEnv);
  } catch (error) {
    // A file that could not be written because its directory went away is
    // that, not a fault of the case.
    stillThere(root);
    throw error;
  }
  stillThere(root);
  return run;
}

function runIn(root, testCase, impl, extraEnv) {
  const cwd = path.join(root, "cwd");
  const home = path.join(root, "home");
  const tmp = path.join(root, "tmp");
  // One level at a time: making the missing parents too would quietly put
  // back a run directory that somebody removed.
  for (const dir of [root, cwd, home, tmp]) fs.mkdirSync(dir);
  // <CWD>, <HOME> and <ROOT> in what a case says stand for this run's directories.
  const here = (text) => String(text).split("<CWD>").join(cwd).split("<HOME>").join(home).split("<ROOT>").join(root).split("<REPO>").join(launchDir);
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
    // Its own: programs keep state in the temp directory too.
    TMPDIR: tmp,
    ...(isWindows ? { SystemRoot: process.env.SystemRoot, TEMP: tmp, TMP: tmp, PATHEXT: process.env.PATHEXT } : {}),
  };
  // The cases file's variables, then the case's. null takes a variable out
  // (on Windows in any spelling: Path and PATH are one variable there).
  for (const variables of [spec.env, testCase.env]) {
    for (const [name, value] of Object.entries(variables || {})) {
      if (value !== null) env[name] = here(value);
      else for (const key of Object.keys(env)) if (key === name || (isWindows && key.toUpperCase() === name.toUpperCase())) delete env[key];
    }
  }
  Object.assign(env, extraEnv);
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
    for (const [dir, name] of [[cwd, "<CWD>"], [home, "<HOME>"], [root, "<ROOT>"], [launchDir, "<REPO>"]]) {
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
  // Without it every handed-back case would look answered by the binary.
  mine.push(path.join(standIn, entry));
  let native = 0;
  let back = 0;
  for (const { testCase, index } of selected) {
    ran++;
    const run = runCase(testCase, "rs", index, { [rootEnv]: standIn });
    if (run.broken) {
      failed++;
      console.log(`  BROKEN  ${testCase.name}\n      ${run.broken}`);
      continue;
    }
    const reached = run.observed.stdout.includes(MARKER);
    if (reached) back++;
    else native++;
    if (reached === Boolean(testCase.handback)) continue;
    failed++;
    console.log(
      reached
        ? `  WRONG   ${testCase.name}\n      reached the JavaScript, but the case does not say "handback"`
        : `  WRONG   ${testCase.name}\n      was answered by the binary, but the case says it is handed back (${testCase.handback})`,
    );
  }
  if (ran && !failed) console.log(`${native} case(s) answered by the binary, ${back} handed back to the JavaScript, as the cases say`);
}

function compareAll() {
  for (const { testCase, index } of selected) {
    ran++;
    const ts = runCase(testCase, "ts", index);
    const rs = runCase(testCase, "rs", index);
    const broken = ts.broken || rs.broken;
    if (broken) {
      failed++;
      console.log(`  BROKEN  ${testCase.name}\n      ${broken}`);
      continue;
    }
    const differing = Object.keys(ts.observed).filter((k) => ts.observed[k] !== rs.observed[k]);
    if (!differing.length) {
      console.log(`  same    ${testCase.name}`);
      // --show: what was compared, so a case that proves nothing is visible.
      if (opts.show) for (const [k, v] of Object.entries(ts.observed)) console.log(show(k, v));
      continue;
    }
    failed++;
    console.log(`  DIFFER  ${testCase.name}  (${differing.join(", ")})`);
    for (const k of differing) {
      console.log(`    ${k}`);
      console.log(show("TypeScript", ts.observed[k]));
      console.log(show("Rust", rs.observed[k]));
    }
  }
}

let gone = null;
try {
  if (opts.handback) handbackCheck();
  else compareAll();
  // Once more at the end: the last case may have run while the directory was being removed.
  stillThere();
} catch (error) {
  if (!(error instanceof Vanished)) throw error;
  gone = error.message;
  console.log(
    `parity: stopped, because ${gone} is gone: something else on this machine removed this run's directory, or part of it, while the cases were running ` +
      "(a clean-up of the temp directory?). What is printed above for the last case(s) is not a result of the port. Run it again.",
  );
} finally {
  if (opts.keep && fs.existsSync(work)) {
    // The IN-USE file would tell whoever finds the directory later that a run is still in it.
    fs.rmSync(inUse, { force: true });
    console.log(`kept ${work}`);
    console.log(`  When you are done with it, remove that directory by this exact path, and nothing else:`);
    console.log(`  never ${path.join(path.dirname(work), "rustify-parity-*")} as a pattern, which takes the directories of runs still going.`);
  } else fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
if (gone) process.exit(3);
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
