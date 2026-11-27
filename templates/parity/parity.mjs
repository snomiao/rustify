#!/usr/bin/env node
// rustify parity runner v4 — no npm dependencies, runs on node or bun.
// (A case that asks for a terminal also takes python3 and terminal.py, the
// file beside this one.)
//
// Runs the same command lines against two implementations of a CLI and fails
// unless they behave the same: stdout, stderr, exit code, and whatever they
// leave behind. It is the proof behind a `verified` entry in a parity ledger.
//
//   parity.mjs --cases parity.json --ts "bun ts/cli.ts" --rs "rs/target/release/mycli"
//              [--filter <text>] [--show] [--keep]
//              [--tty [stdin,stdout,stderr]] [--capture files]
//
// A binary that hands some invocations back to the JavaScript passes those
// cases by construction. To prove which cases the binary answers itself:
//
//   parity.mjs --cases parity.json --rs "rs/target/release/mycli" \
//              --handback MYCLI_PACKAGE_ROOT=dist/cli.js
//
// runs only the binary, with a stand-in package whose JavaScript entry does
// nothing but say it was reached, and fails unless exactly the cases marked
// "handback" got there. --tty and --capture apply here as well.
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
//         "tty": true,                           // optional, see "A terminal"
//         "capture": "files",                    // optional, see "Regular files"
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
// machine: no TERM (except on a terminal, below), NO_COLOR or FORCE_COLOR.
//
// A terminal. Without "tty" a program gets pipes, and nothing that depends on
// a terminal is compared: colours, clickable links, a question that is only
// asked there, a last newline that is only printed there.
//
//     "tty": true               stdin, stdout and stderr are one terminal
//     "tty": "stdout"           only stdout is; also "stdin,stderr",
//                               ["stdout", "stderr"], …
//     "tty": false              pipes, whatever --tty says
//     --tty, --tty stdout       the same for every case that has no "tty"
//
//   The program is started as under a terminal emulator: in a session of
//   its own, with this terminal as its controlling terminal (/dev/tty).
//
//   What is compared is every byte the terminal was sent, in the order it
//   arrived, under the name "terminal". A stream that is not the terminal is
//   still compared on its own. In what the runner prints about such a case,
//   control characters are spelled out (\r, \e for the escape character,
//   \x07), so that a difference in them can be seen.
//   - stdout and stderr on the terminal are one stream there. Their order is
//     compared; which of the two a byte came from cannot be. To compare them
//     apart, make one of them the terminal.
//   - Line ends are as the terminal got them: a line feed the program wrote
//     arrives as CR LF. They are left alone, so a program that switches the
//     terminal to raw mode and then forgets the carriage return shows up.
//   - What is typed is echoed by the terminal unless the program has turned
//     that off, and the echo is part of the text.
//   - The window is 80 columns by 24 rows, and TERM is xterm-256color unless
//     an `env` says otherwise (null for none).
//   - A stream that is a pipe while another is the terminal is compared as it
//     is: bun, for one, colours console.error when either stdout or stderr is
//     a terminal, so that colour shows up in a piped stderr too.
//   Not compared: when the bytes arrived; the settings the program leaves the
//   terminal with; what a process it left behind writes after it has ended;
//   and nothing answers a question put to the terminal itself (where is the
//   cursor, which colours do you have), so a program that asks one waits out
//   its own timeout.
//
//   Typing, when stdin is the terminal:
//     "stdin": "y\n"                 typed before the program starts; the
//                                    echo is the first thing on the terminal
//     "stdin": [["[y/N] ", "y\n"],   typed once the terminal has shown the
//               ["Sure? ", "y\n"]]   text on the left (the text itself, not a
//                                    pattern; looked for after the one before)
//   Wait for the last thing the program prints before it reads; text typed
//   while the program is still printing is echoed somewhere in between. A
//   terminal's input does not end: a program that reads to the end needs
//   "\u0004" (Ctrl-D) typed at the start of a line. "\u0003" is Ctrl-C.
//   With --tty every case's `stdin` is typed; a case that has to keep its
//   stdin a pipe says "tty": "stdout,stderr".
//
//   Linux and macOS. On Windows, and where python3 is missing, a case that
//   asks for a terminal is BROKEN, with the reason in one line.
//
// Regular files. "capture": "files" (--capture files for every case that does
// not say; "capture": "pipes" in a case keeps the pipes) gives the program
// regular files as stdout and stderr and compares what is in them when it
// exits. For a bun program that prints a lot: bun 1.4.0 loses stdout written
// to a pipe or socket once the program has read process.stdout.isTTY. On the
// machine this was written on, 500 such lines arrived whole through a pipe in
// 20 of 30 runs and 5000 lines in none of 20 (1490 of them at worst); into a
// file, every one of 80 runs was whole. The program can tell a file from a
// pipe, and what a process it left behind writes later is not seen, hence
// not the default.
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
import { fileURLToPath } from "node:url";

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
      "                  [--tty [stdin,stdout,stderr]] [--capture files]\n" +
      '       parity.mjs --cases <file.json> --rs "<command>" --handback <ROOT_ENV>=<js entry> [--filter <text>]\n' +
      "                  [--tty [stdin,stdout,stderr]] [--capture files]\n" +
      "  --tty      a terminal instead of pipes, for every case that has no \"tty\" of its own (all three streams, or those named)\n" +
      "  --capture  files: stdout and stderr go to regular files instead of pipes, for every case that has no \"capture\"\n" +
      "The cases file is described at the top of parity.mjs.",
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

const STREAMS = ["stdin", "stdout", "stderr"];
const TERMINAL_PY = path.join(path.dirname(fileURLToPath(import.meta.url)), "terminal.py");
const WINDOW = { columns: 80, rows: 24 };

// The streams a "tty" value names: true is all three, false none, otherwise
// a list of names or one string with commas.
function streamsOf(value, where) {
  if (value === true) return [...STREAMS];
  if (value === false) return [];
  const names = (Array.isArray(value) ? value : String(value).split(",")).map((name) => String(name).trim()).filter(Boolean);
  const unknown = names.filter((name) => !STREAMS.includes(name));
  if (unknown.length) mistake(`${where} takes true, false, or some of stdin, stdout and stderr; it has ${unknown.join(", ")}`);
  return STREAMS.filter((name) => names.includes(name));
}

const everyCase = { terminals: streamsOf(opts.tty ?? false, "--tty"), capture: opts.capture ?? "pipes" };
if (!["files", "pipes"].includes(everyCase.capture)) mistake(`--capture takes files or pipes; it has ${opts.capture === true ? "nothing" : opts.capture}`);

// How one case is run: which streams are a terminal, where the others go, and
// what is typed. The case's own word comes before the command line's.
function planOf(testCase) {
  const where = `case ${JSON.stringify(testCase.name)}`;
  const terminals = testCase.tty == null ? everyCase.terminals : streamsOf(testCase.tty, `${where}: "tty"`);
  const capture = testCase.capture ?? everyCase.capture;
  if (!["files", "pipes"].includes(capture)) mistake(`${where}: "capture" takes "files" or "pipes"; it has ${JSON.stringify(capture)}`);
  const stdin = testCase.stdin ?? "";
  let typed = [];
  if (Array.isArray(stdin)) {
    if (!stdin.every((step) => Array.isArray(step) && step.length === 2 && step.every((part) => typeof part === "string"))) {
      mistake(`${where}: "stdin" as a list takes pairs of text, [what to wait for, what to type]`);
    }
    if (!terminals.includes("stdin")) mistake(`${where}: "stdin" as a list is typed at a terminal, and stdin is not one here; say "tty" in the case`);
    typed = stdin;
  } else if (terminals.includes("stdin") && String(stdin) !== "") {
    typed = [["", String(stdin)]];
  }
  return { terminals, files: capture === "files", typed, piped: terminals.includes("stdin") || Array.isArray(stdin) ? "" : stdin };
}

const selected = spec.cases
  .map((testCase, index) => ({ testCase, index, plan: null }))
  .filter(({ testCase }) => typeof opts.filter !== "string" || testCase.name.includes(opts.filter));
for (const entry of selected) entry.plan = planOf(entry.testCase);

// The terminal helper, looked for once: the interpreter to start it with, or
// why a case that asks for a terminal cannot have one here.
let terminalHelper = null;
function terminal() {
  if (terminalHelper) return terminalHelper;
  const asks = 'this case is to run on a terminal ("tty")';
  let problem = null;
  let python = null;
  if (isWindows) problem = `${asks}, and the runner has none to give on Windows; run it on Linux or macOS`;
  else if (!fs.existsSync(TERMINAL_PY)) problem = `${asks}; that takes ${TERMINAL_PY}, the file that belongs beside parity.mjs, and it is not there`;
  else {
    const check = spawnSync("python3", ["-I", TERMINAL_PY, "--check"], { encoding: "utf8" });
    if (check.error) problem = `${asks}; that takes python3, and ${check.error.code === "ENOENT" ? "no python3 was found on PATH" : `python3 could not be started (${check.error.message})`}`;
    else if (check.status !== 0) problem = `${asks}, and none could be opened here: ${lastLine(check.stderr) || `python3 exited ${check.status}`}`;
    // By its full path from here on: a case may run with a PATH that lacks it.
    else python = check.stdout.trim() || "python3";
  }
  terminalHelper = { problem, python };
  return terminalHelper;
}

// The first [wait, text] that terminal.py did not type, because the terminal
// never showed its wait: the same search terminal.py makes, on the whole
// transcript.
function neverTyped(transcript, typed) {
  let from = 0;
  for (const [wait, text] of typed) {
    if (!wait) continue;
    const at = transcript.indexOf(wait, from);
    if (at < 0) return [wait, text];
    from = at + wait.length;
  }
  return null;
}

function lastLine(text) {
  return String(text ?? "").trim().split("\n").pop().trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A terminal's text is full of what a log does not show: carriage returns,
// the escape character of a colour. Spelled out (\r, \e, \x07), a difference
// in them can be seen. Line feeds stay line ends. Done for what is printed
// about a case that has a terminal; the comparison is on the text as it was.
function spelledOut(text) {
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, (char) => {
    if (char === "\r") return "\\r";
    if (char === "\t") return "\\t";
    if (char === "\u001b") return "\\e";
    return `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
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

function runCase(testCase, impl, index, plan, extraEnv = {}) {
  if (plan.terminals.length && terminal().problem) return { broken: terminal().problem };
  const root = path.join(work, `${index}-${impl}`);
  stillThere();
  let run;
  try {
    run = runIn(root, testCase, impl, plan, extraEnv);
  } catch (error) {
    // A file that could not be written because its directory went away is
    // that, not a fault of the case.
    stillThere(root);
    throw error;
  }
  stillThere(root);
  return run;
}

function runIn(root, testCase, impl, plan, extraEnv) {
  const { terminals } = plan;
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
    // On a terminal there is always a TERM, and programs choose their colours by it.
    ...(terminals.length ? { TERM: "xterm-256color" } : {}),
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
  const args = [...baseArgs, ...(testCase.args || []).map(here)];
  const seconds = testCase.timeout || 120;
  const options = { cwd, env, input: here(plan.piped), encoding: "utf8", timeout: seconds * 1000 };
  // The runner's own files of this run: what the program wrote, when that
  // goes to files, and what the terminal was sent.
  const own = path.join(root, "runner");
  if (plan.files || terminals.length) fs.mkdirSync(own);
  const sinks = {};
  if (plan.files) {
    for (const name of ["stdout", "stderr"]) sinks[name] = fs.openSync(path.join(own, name), "w");
    options.stdio = ["pipe", sinks.stdout, sinks.stderr];
  }
  const transcript = path.join(own, "terminal");
  let result;
  if (terminals.length) {
    // terminal.py stands between the runner and the program: it gives the
    // program the terminal, passes the other streams on as they are, and
    // writes what the terminal was sent to `transcript`.
    const request = path.join(own, "terminal.json");
    fs.writeFileSync(request, JSON.stringify({ terminals, type: plan.typed.map((step) => step.map(here)), transcript, ...WINDOW }));
    result = spawnSync(terminal().python, ["-I", TERMINAL_PY, request, program, ...args], options);
  } else {
    result = spawnSync(program, args, options);
  }
  for (const fd of Object.values(sinks)) fs.closeSync(fd);
  const written = (name) => (plan.files ? fs.readFileSync(path.join(own, name), "utf8") : result[name]);
  const onTerminal = terminals.length && fs.existsSync(transcript) ? fs.readFileSync(transcript, "utf8") : null;
  // On a terminal the runner started terminal.py, which had started the
  // program: any trouble with that is the run's, whatever exit code came back.
  if (result.error && (result.status === null || terminals.length)) {
    if (terminals.length && result.error.code === "ETIMEDOUT") {
      const last = spelledOut((onTerminal ?? "").slice(-200)).split("\n").pop();
      const waiting = neverTyped(onTerminal ?? "", plan.typed.map((step) => step.map(here)));
      const why = waiting ? `; it never showed ${JSON.stringify(waiting[0])}, so ${JSON.stringify(waiting[1])} was not typed` : "";
      return { broken: `${program} had not ended after ${seconds} s on a terminal, which last showed: ${last || "(nothing)"}${why}` };
    }
    return { broken: `could not run ${program}: ${result.error.message}` };
  }
  // terminal.py always leaves a transcript, except when it could not start the program.
  if (terminals.length && onTerminal === null) {
    return { broken: lastLine(written("stderr")) || `the terminal helper ended with ${result.status} and without a transcript` };
  }
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
  // A stream that is the terminal has nothing of its own: it is in "terminal".
  const observed = { "exit code": String(result.status) };
  if (!terminals.includes("stdout")) observed.stdout = clean(written("stdout"));
  if (!terminals.includes("stderr")) observed.stderr = clean(written("stderr"));
  if (terminals.length) observed.terminal = clean(onTerminal);
  for (const line of testCase.after || []) {
    const probe = shell(line);
    observed[`after: ${line}`] = clean(`${probe.stdout}${probe.stderr}[exit ${probe.status}]`);
  }
  return { observed };
}

function show(label, text, spell) {
  const lines = (spell ? spelledOut(text) : text).split("\n");
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
  for (const { testCase, index, plan } of selected) {
    ran++;
    const run = runCase(testCase, "rs", index, plan, { [rootEnv]: standIn });
    if (run.broken) {
      failed++;
      console.log(`  BROKEN  ${testCase.name}\n      ${run.broken}`);
      continue;
    }
    // The stand-in says so on stdout, which is the terminal when the case makes it one.
    const reached = `${run.observed.stdout ?? ""}${run.observed.terminal ?? ""}`.includes(MARKER);
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
  for (const { testCase, index, plan } of selected) {
    ran++;
    const ts = runCase(testCase, "ts", index, plan);
    const rs = runCase(testCase, "rs", index, plan);
    const broken = ts.broken || rs.broken;
    if (broken) {
      failed++;
      console.log(`  BROKEN  ${testCase.name}\n      ${broken}`);
      continue;
    }
    const differing = Object.keys(ts.observed).filter((k) => ts.observed[k] !== rs.observed[k]);
    const spell = plan.terminals.length > 0;
    if (!differing.length) {
      console.log(`  same    ${testCase.name}`);
      // --show: what was compared, so a case that proves nothing is visible.
      if (opts.show) for (const [k, v] of Object.entries(ts.observed)) console.log(show(k, v, spell));
      continue;
    }
    failed++;
    console.log(`  DIFFER  ${testCase.name}  (${differing.join(", ")})`);
    for (const k of differing) {
      console.log(`    ${k}`);
      console.log(show("TypeScript", ts.observed[k], spell));
      console.log(show("Rust", rs.observed[k], spell));
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
