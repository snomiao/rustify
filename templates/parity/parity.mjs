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
//              [--tty [stdin,stdout,stderr]] [--capture files] [--shell <path>]
//
// An option's value may also follow an equals sign (--tty=stdout). An option
// the runner does not know is a mistake, not ignored. --ts and --rs are split
// into words at spaces; a word in double quotes keeps its spaces
// ("C:\Program Files\nodejs\node.exe" cli.mjs), and nothing else is special.
//
// A binary that hands some invocations back to the JavaScript passes those
// cases by construction. To prove which cases the binary answers itself:
//
//   parity.mjs --cases parity.json --rs "rs/target/release/mycli" \
//              --handback MYCLI_PACKAGE_ROOT=dist/cli.js
//
// runs only the binary, with a stand-in package whose JavaScript entry does
// nothing but say it was reached, and fails unless exactly the cases marked
// "handback" for this operating system got there (see "Platforms"). --tty,
// --capture and --shell apply here as well.
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
//         "handback": "usage errors belong to yargs", // optional: this case is
//                                  // MEANT to reach the JavaScript, and why;
//                                  // also per system, see "Platforms"
//         "skip": { "win32": "needs a POSIX file mode" } // optional: not run
//                                  // on these systems, and why ("Platforms")
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
// `setup` and `after` lines are run by /bin/sh, or by the POSIX shell that
// --shell or RUSTIFY_PARITY_SHELL names; on Windows by Git for Windows' bash
// (see "Windows").
//
// The paths of these directories are replaced by <CWD>, <HOME>, <ROOT> and
// <REPO> before comparing (on Windows, a spelling other than the one the
// runner hands out gets a tag, <CWD:json>: see "Windows"). Anything else that
// legitimately varies between two runs
// (timestamps, random ids) needs a `normalize` rule; keep those rare, each one
// is a hole in the proof.
//
// What is compared: the exit code, or the signal that ended the program
// ("signal SIGTERM"); stdout and stderr; and what each `after` line prints.
// Through pipes, stdout and stderr are read as UTF-8 text, so bytes that are
// not UTF-8 all become U+FFFD there and are not told apart. On a terminal and
// in regular files (both below) every byte counts, and one that is not UTF-8
// is shown as \xNN.
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
//   - What is typed is echoed by the terminal unless the program had turned
//     that off when it was typed, and the echo is part of the text. Text
//     typed ahead is echoed before the program starts, so whether a program
//     hides an answer (a password) is only compared when the answer waits
//     for its question (below).
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
//                                    echo is the first thing on the terminal,
//                                    whatever the program does afterwards
//     "stdin": [["[y/N] ", "y\n"],   typed 50 ms after the terminal has shown
//               ["Sure? ", "y\n"]]   the text on the left (the text itself, not
//                                    a pattern; looked for after the one before)
//   Use the list for every question whose echo matters: a password, a key
//   read on its own. A program that turns echo off or reads single keys in
//   its own process, right after asking, has done so within those 50 ms
//   (node's setRawMode: 40 of 40 runs on a machine loaded 26 on 8 cores); one
//   that starts another program for it, such as stty, may not have, and then
//   its answer is echoed as though it never turned echo off.
//   Wait for the last thing the program prints before it reads; text typed
//   while the program is still printing is echoed somewhere in between. A
//   terminal's input does not end: a program that reads to the end needs
//   "\u0004" (Ctrl-D) typed at the start of a line. "\u0003" is Ctrl-C.
//
//   --tty alone makes stdin the terminal in every case as well: each case's
//   `stdin` is typed ahead, and a program that reads stdin to the end waits
//   out its timeout. To run a whole cases file again on a terminal, use
//   --tty stdout,stderr, the streams colours depend on, and give each question
//   a case of its own with "tty" and `stdin` as a list. A command that the
//   binary hands back only on a terminal needs such a case too, with
//   "handback": a case's "handback" holds in every run of the file.
//
//   Linux and macOS. On Windows, and where python3 is missing, a case that
//   asks for a terminal is BROKEN, with the reason in one line.
//
// Regular files. "capture": "files" (--capture files for every case that does
// not say; "capture": "pipes" in a case keeps the pipes) gives the program
// regular files as stdout and stderr and compares what is in them, byte for
// byte, when it exits. For a bun program that prints a lot: bun 1.4.0 loses stdout written
// to a pipe or socket once the program has read process.stdout.isTTY. On the
// machine this was written on, 500 such lines arrived whole through a pipe in
// 20 of 30 runs and 5000 lines in none of 20 (1490 of them at worst); into a
// file, every one of 80 runs was whole. The program can tell a file from a
// pipe, and what a process it left behind writes later is not seen, hence
// not the default.
//
// Platforms. The same cases run on Linux, macOS and Windows, and a port may
// answer a command itself on some of them and hand it back on others. A
// "handback" given as text holds on every system, as it always has. Given as
// an object, it holds on the systems it names, each with its reason, and the
// case is meant to be answered by the binary everywhere else:
//
//     "handback": { "win32": "node's path rules are not ported" }
//
// "skip" names the systems where a case is not run at all, because it cannot
// mean the same thing there (a file mode, a signal, a GNU tool):
//
//     "skip": { "win32": "needs a POSIX file mode", "darwin": "GNU stat" }
//
// Systems are named as node's process.platform names them: linux, darwin,
// win32 (and the others node knows, such as freebsd). There is no name for an
// architecture (darwin-arm64, as the pipeline's platform keys are written):
// a port's code differs by operating system, not by processor, and the node
// that runs the runner can be of another architecture than the binary (x64
// under emulation on an ARM machine), so such a mark could hold for the wrong
// one. A name the runner does not know is a mistake that stops the run, so
// a misspelt one (windows, macos) cannot quietly hold on no system at all.
//
// A skipped case shows as "skip" where it would have been compared, and at
// the end of every run, in both modes, the runner says how many cases were
// skipped on this system and why. A run in which every case was skipped ran
// nothing: "no case ran", exit code 2.
//
// Windows. What is different there:
// - `setup` and `after` lines run in a POSIX shell, not in cmd.exe: the one
//   --shell or RUSTIFY_PARITY_SHELL names, else usr\bin\bash.exe of the Git
//   for Windows that `git --exec-path` points into, else of the one in
//   %ProgramFiles%\Git (or %ProgramFiles(x86)%\Git,
//   %LOCALAPPDATA%\Programs\Git). Never a bash.exe found on PATH: Windows' own
//   (System32\bash.exe) starts WSL, which runs the line in another operating
//   system with other programs and other paths, and it is refused as --shell
//   too. Where no shell can be found, a case that has such lines is BROKEN,
//   with the reason in one line, and the other cases run.
// - The line reaches the shell in the variable RUSTIFY_PARITY_LINE, which the
//   shell removes before it runs the line, so the line does not see it. On
//   its command line Git Bash would read the line by rules of its own, which
//   make one backslash of two. The shell's own directory goes first on the
//   line's PATH unless PATH has it ahead of System32 already: find, sort and
//   stat are then the shell's, not Windows' own find.exe and sort.exe. In Git
//   Bash, where the pipeline runs the parity command, PATH has it ahead.
// - <CWD>, <HOME>, <ROOT> and <REPO> are written with forward slashes
//   (C:/Users/…/cwd): the one spelling that the shell and Windows programs
//   both read as that directory. A backslash is an escape to the shell.
// - Before comparing, these directories are turned back into their names in
//   every spelling a program or a tool may print, and a spelling other than
//   the ones the runner hands out keeps a tag that says which it was. So a
//   port that prints a directory in another spelling than its TypeScript
//   still differs, and one that prints it the same way compares the same:
//     <CWD>        C:\Users\…\cwd as Windows gives it, or C:/Users/…/cwd as the
//                  placeholders are written; for <REPO> also the long
//                  spelling of the directory the runner was started in
//     <CWD:json>   C:\\Users\\…, with doubled backslashes, as JSON and Rust's
//                  {:?} write it
//     <CWD:msys>   /c/Users/…/cwd as MSYS tools print it, or /tmp/rustify-
//                  parity-…/0-ts/cwd: the shell that runs the lines shares the
//                  mounts of a Git Bash that is still running (the runner was
//                  started from it), whose /tmp is that Git Bash's temp
//                  directory, so the runner asks the shell once where its
//                  /tmp is
//     <CWD:8.3>    C:\Users\RUNNER~1\…, the short spelling, as GitHub's runners
//                  give the temp directory (also <CWD:8.3:json>, <CWD:8.3:msys>)
//     <CWD:case>   any of these in other letters, which Windows takes for the
//                  same directory (c:\users\…); <CWD:json:case>, …
//   The pwd of a line is therefore <CWD:msys> on Windows where it is <CWD>
//   elsewhere, the same for both sides. The run's directory is made in the
//   long spelling. The \\?\ that Rust's std::fs::canonicalize puts in front of
//   a path stays (\\?\<CWD>): the TypeScript does not print it, so it is a
//   difference.
// - Inside the shell, `pwd`, `~` and $HOME are MSYS paths (/c/Users/… or
//   /tmp/…). A line that writes such a path into a file or a variable for the
//   program hands it a path no Windows program reads as meant; write <CWD>,
//   <ROOT> or <HOME> there instead of $(pwd), ~ or $HOME.
// - A program in --ts or --rs named without .exe (rs/target/release/mycli) is
//   started with it, also behind another program (env, sh).
// - A leading `env NAME=value …` in --ts or --rs is done by the runner itself:
//   it starts the program with those variables, the values as written (a
//   Windows path: $GITHUB_WORKSPACE, or $(pwd -W) in Git Bash, not $PWD). The
//   env on Windows is MSYS's, which would give the program TERM=xterm-256color
//   and rewrite its arguments.
// - Any other program of the MSYS family in front of the program (sh
//   rs/parity/run.sh, or an env behind a wrapper) reads its command line by
//   rules of its own: it globs * ? [ against the case's files, expands ~ and
//   {a,b}, reads a file for @name, and turns what looks like a POSIX path into
//   a Windows one when it starts a Windows program (/ into C:/Program
//   Files/Git/, x=/tmp/y into x=C:/…/tmp/y). So the runner puts an argument
//   with a space or any of " ' * ? [ ] { } ~ @ in double quotes, where MSYS
//   does none of that and Windows programs read it the same, and gives the
//   program MSYS2_ARG_CONV_EXCL=* and MSYS_NO_PATHCONV=1, which stop the
//   conversion. One difference is left: in double quotes MSYS makes one
//   backslash of two, so an argument that is quoted and has two backslashes
//   in a row (\\server\share x) arrives with one. Such a program also gives
//   what it starts a TERM, and a wrapper script that starts a Windows program
//   with a POSIX path of its own converts that path itself (cygpath -w). The
//   lines do not get the two variables: they need the conversion (git -C
//   "$(pwd)"). A case can set them, or take them out with null, in its `env`;
//   the lines then get what it says. (MSYS=noglob is no help: with it, MSYS
//   reads no quotes, and an argument with a space arrives in pieces.)
// - A program also sees SystemRoot, PATHEXT, TEMP and TMP (its temp directory,
//   as TMPDIR is), and the two variables above. node itself adds HOMEDRIVE,
//   HOMEPATH, LOGONSERVER, SYSTEMDRIVE, USERDOMAIN, USERNAME and WINDIR from
//   the runner's own environment where the program's lacks them, so null
//   cannot take these out, and HOMEDRIVE with HOMEPATH names the real home
//   directory.
// - There is no terminal (a case with "tty" is BROKEN, see "A terminal") and
//   no signal for a program to end by, only its exit code.
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
// way; 2 nothing could be run (usage, an option the runner does not know, a
// mistake in the cases file, no case selected); 3 the run's directory
// disappeared.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OPTIONS = ["cases", "ts", "rs", "filter", "show", "keep", "handback", "tty", "capture", "shell"];

// `--name value`, `--name=value`, or `--name` alone (true).
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const eq = argv[i].indexOf("=");
    if (eq > 2) out[argv[i].slice(2, eq)] = argv[i].slice(eq + 1);
    else out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return out;
}

const USAGE =
  'usage: parity.mjs --cases <file.json> --ts "<command>" --rs "<command>" [--filter <text>] [--show] [--keep]\n' +
  "                  [--tty [stdin,stdout,stderr]] [--capture files] [--shell <path>]\n" +
  '       parity.mjs --cases <file.json> --rs "<command>" --handback <ROOT_ENV>=<js entry> [--filter <text>]\n' +
  "                  [--tty [stdin,stdout,stderr]] [--capture files] [--shell <path>]\n" +
  "  --tty      a terminal instead of pipes, for every case that has no \"tty\" of its own (all three streams, or those named;\n" +
  "             to run a whole cases file again on a terminal, --tty stdout,stderr)\n" +
  "  --capture  files: stdout and stderr go to regular files instead of pipes, for every case that has no \"capture\"\n" +
  "  --shell    the POSIX shell that runs \"setup\" and \"after\" lines (also RUSTIFY_PARITY_SHELL); by default /bin/sh,\n" +
  "             and on Windows the bash of Git for Windows\n" +
  "An option's value may also follow an equals sign: --tty=stdout.\n" +
  "The cases file is described at the top of parity.mjs.";

// A mistake in the command line or the cases file: nothing is run.
function mistake(text) {
  console.error(`parity: ${text}`);
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));
// An option the runner does not know would otherwise be ignored, and a
// misspelt --tty would pass on pipes.
for (const name of Object.keys(opts)) if (!OPTIONS.includes(name)) mistake(`--${name} is not an option of the runner\n${USAGE}`);
if (!opts.cases || !opts.rs || (!opts.ts && !opts.handback)) {
  console.error(USAGE);
  process.exit(2);
}
// --handback ROOT_ENV=entry, checked before the run's directory is made.
let handback = null;
if (opts.handback) {
  const value = String(opts.handback);
  const eq = value.indexOf("=");
  if (eq < 1 || eq === value.length - 1) mistake("--handback needs <ROOT_ENV>=<js entry>, e.g. MYCLI_PACKAGE_ROOT=dist/cli.js");
  handback = { rootEnv: value.slice(0, eq), entry: value.slice(eq + 1) };
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

// The words of a command: split at white space, except inside double quotes,
// which are taken out ("C:\Program Files\nodejs\node.exe" x.mjs). Nothing else
// is special, backslashes included, so a Windows path is written as it is. A
// command without double quotes is split as it always was.
function words(text, where) {
  const value = String(text);
  if ((value.match(/"/g) || []).length % 2) mistake(`${where} has a double quote that is not closed: ${value}`);
  return (value.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((word) => word.replace(/"/g, ""));
}

// A command is run from another directory, so anything in it that names a
// file here has to become absolute. On Windows a program is often named
// without its .exe (rs/target/release/mycli); with it, whatever starts the
// program (sh, a wrapper) finds it too.
//
// On Windows a leading `env NAME=value …` is done by the runner itself: the
// program is started with those variables, and no env.exe stands in between.
// The env there is MSYS's (Git's or MSYS2's usr\bin), which gives the program
// a TERM it would not have and rewrites its arguments (see "Windows"). An env
// with options of its own (-u, -i) or without a program is left to env.
function command(text, where) {
  let tokens = words(text, where);
  const vars = {};
  if (isWindows && /^env(\.exe)?$/i.test(tokens[0] ?? "")) {
    let at = 1;
    while (at < tokens.length && /^[^=-][^=]*=/.test(tokens[at])) at++;
    if (at < tokens.length && !tokens[at].startsWith("-")) {
      for (const assignment of tokens.slice(1, at)) {
        const eq = assignment.indexOf("=");
        setVariable(vars, assignment.slice(0, eq), assignment.slice(eq + 1));
      }
      tokens = tokens.slice(at);
    }
  }
  const argv = tokens.map((token) => {
    if (!/[\\/.]/.test(token)) return token;
    const file = path.resolve(launchDir, token);
    if (fs.existsSync(file)) return file;
    if (isWindows && fs.existsSync(`${file}.exe`)) return `${file}.exe`;
    return token;
  });
  return { argv, vars };
}

// Sets a variable in an environment; on Windows, where Path and PATH are one
// variable, in place of the one it has in any other letter case.
function setVariable(env, name, value) {
  if (isWindows) for (const key of Object.keys(env)) if (key !== name && key.toUpperCase() === name.toUpperCase()) delete env[key];
  env[name] = value;
}

const impls = { ts: opts.ts ? command(opts.ts, "--ts") : null, rs: command(opts.rs, "--rs") };
const MARKER = "__RUSTIFY_HANDED_BACK__";

// The POSIX shell named for "setup" and "after" lines, if one is: --shell,
// else RUSTIFY_PARITY_SHELL. Without one, node's /bin/sh runs them, and on
// Windows the bash of Git for Windows (see posixShell).
const namedShell = (() => {
  const [where, value] = opts.shell !== undefined ? ["--shell", opts.shell] : ["RUSTIFY_PARITY_SHELL", process.env.RUSTIFY_PARITY_SHELL || null];
  if (value === null) return null;
  if (value === true || value === "") mistake(`${where} needs the path of a POSIX shell, such as /bin/bash or C:/Program Files/Git/usr/bin/bash.exe`);
  const file = path.resolve(launchDir, String(value));
  const found = [file, ...(isWindows ? [`${file}.exe`] : [])].find((name) => fs.statSync(name, { throwIfNoEntry: false })?.isFile());
  if (!found) mistake(`${where}: there is no file ${value}; it takes the path of a POSIX shell, such as /bin/bash or C:/Program Files/Git/usr/bin/bash.exe`);
  if (isWindows && isWslLauncher(found)) mistake(`${where}: ${found} starts WSL, which runs the lines in another operating system, with other programs and other paths; name Git for Windows' bash instead`);
  return found;
})();

// Windows' own bash.exe, and the launchers WindowsApps holds for WSL's
// distributions, start a Linux system, not a shell on this one.
function isWslLauncher(file) {
  const lower = path.resolve(file).toLowerCase();
  const system = path.resolve(process.env.SystemRoot || "C:\\Windows").toLowerCase();
  if (lower.startsWith(`${system}\\`) && /\\(bash|wsl)\.exe$/.test(lower)) return true;
  return lower.includes("\\microsoft\\windowsapps\\");
}

// The operating systems a "handback" or "skip" can name: process.platform's
// names. Architectures are not told apart (see the header).
const SYSTEMS = ["linux", "darwin", "win32", "freebsd", "openbsd", "netbsd", "sunos", "aix", "android", "cygwin"];

// A mark keyed by operating system, { "win32": "why" }: the reason it gives
// for this one, or null. A mistake in it stops the run.
function forThisSystem(marks, key, where) {
  const shape = `"${key}" takes an object keyed by operating system, as node names it, with the reason as text: { "win32": "why" }`;
  if (marks === null || typeof marks !== "object" || Array.isArray(marks)) mistake(`${where}: ${shape}; it has ${JSON.stringify(marks)}`);
  for (const [system, reason] of Object.entries(marks)) {
    if (!SYSTEMS.includes(system) && system !== process.platform) {
      // darwin-arm64, as the pipeline's platform keys are written.
      const [name] = system.split("-");
      if (SYSTEMS.includes(name)) mistake(`${where}: "${key}" names ${JSON.stringify(system)}: the runner tells operating systems apart, not architectures; say ${JSON.stringify(name)}`);
      mistake(`${where}: "${key}" names ${JSON.stringify(system)}, which is not an operating system as process.platform names it (linux, darwin, win32, …)`);
    }
    if (typeof reason !== "string" || !reason.trim()) mistake(`${where}: "${key}" needs a reason for ${system}, as text`);
  }
  return Object.hasOwn(marks, process.platform) ? marks[process.platform] : null;
}

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
  // `--tty=` or "tty": "" names no stream; false is the way to say pipes.
  if (!names.length) mistake(`${where} names no stream; it takes true, false, or some of stdin, stdout and stderr`);
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
  // "handback" as text (or anything else that is true) holds everywhere, as it
  // always has; as an object, on the systems it names. "skip" is always an
  // object. Each comes down to this system's reason, or null.
  const marked = testCase.handback !== null && typeof testCase.handback === "object";
  const handback = marked ? forThisSystem(testCase.handback, "handback", where) : testCase.handback ? String(testCase.handback) : null;
  const skip = testCase.skip == null ? null : forThisSystem(testCase.skip, "skip", where);
  // For a case handed back elsewhere only: where, to say so when it is handed back here.
  const handbackElsewhere = marked && handback === null ? Object.keys(testCase.handback) : [];
  return { terminals, files: capture === "files", typed, piped: terminals.includes("stdin") || Array.isArray(stdin) ? "" : stdin, handback, handbackElsewhere, skip };
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

// The shell for "setup" and "after" lines, looked for once: { path } (null
// for node's own /bin/sh), or why a case that has such lines cannot run.
let lineShell = null;
function posixShell() {
  if (lineShell) return lineShell;
  if (namedShell || !isWindows) lineShell = { path: namedShell };
  else {
    const bash = gitBash();
    lineShell = bash
      ? { path: bash }
      : {
          problem:
            'this case has "setup" or "after" lines, which a POSIX shell runs, and none was found: no bash of Git for Windows where `git --exec-path` points ' +
            "or in %ProgramFiles%\\Git; install Git for Windows, or name a shell with --shell <path> or RUSTIFY_PARITY_SHELL",
        };
  }
  if (isWindows && lineShell.path) tempSpellings.push(...shellTemp(lineShell.path));
  return lineShell;
}

// Where the shell's /tmp is, in Windows' spellings (see tempSpellings): asked
// once, of the shell itself, because under a Git Bash that is still running
// it is that Git Bash's temp directory, whatever the runner's is.
function shellTemp(shell) {
  const temp = os.tmpdir();
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: temp, TMP: temp };
  const result = spawnSync(shell, ["-c", "cd /tmp && pwd -W"], { env, encoding: "utf8", timeout: 30_000, windowsHide: true });
  const dir = result.status === 0 ? result.stdout.trim().replace(/\//g, "\\") : "";
  if (!/^[A-Za-z]:\\[^\n]*$/.test(dir)) return [];
  let long = dir;
  try {
    long = fs.realpathSync.native(dir);
  } catch {}
  return [...new Set([dir, long])].map((spelling) => spelling.replace(/\\$/, "").toLowerCase());
}

// Git for Windows' bash: usr\bin\bash.exe in the installation of the git on
// PATH (`git --exec-path` says <Git>/mingw64/libexec/git-core, or clangarm64
// on ARM), else in the usual places. Never a bash.exe found on PATH: that can
// be Windows' own, which is WSL.
function gitBash() {
  const roots = [];
  const exec = spawnSync("git", ["--exec-path"], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  const libexec = exec.status === 0 ? exec.stdout.trim() : "";
  // A git of MSYS2's own says /usr/lib/git-core, which names no Windows directory.
  if (/^[A-Za-z]:[\\/]/.test(libexec)) for (let dir = path.dirname(libexec), up = 0; up < 3; up++, dir = path.dirname(dir)) roots.push(dir);
  for (const name of ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"]) if (process.env[name]) roots.push(path.join(process.env[name], "Git"));
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, "Programs", "Git"));
  return roots.map((root) => path.join(root, "usr", "bin", "bash.exe")).find((bash) => fs.existsSync(bash) && !isWslLauncher(bash)) ?? null;
}

// The name of the variable that carries a line to the shell on Windows.
const LINE = "RUSTIFY_PARITY_LINE";

// On Windows, what a program of the MSYS family between the runner and the
// program (sh with a wrapper script, an env that is not the first word) needs
// to pass the case's arguments on without turning what looks like a POSIX
// path into a Windows one: MSYS2's variable, and Git for Windows' own. Given
// to the program, not to the lines, which need that conversion: git -C
// "$(pwd)" hands git.exe a Windows path only because of it. (MSYS=noglob is
// not among them: with it, MSYS reads no quotes on its command line, and an
// argument with a space arrives in pieces. windowsArgument() keeps MSYS from
// globbing instead.)
const AS_WRITTEN = { MSYS2_ARG_CONV_EXCL: "*", MSYS_NO_PATHCONV: "1" };

// On Windows a program gets its arguments as one command line, which it
// splits by rules of its own. Windows programs (node, bun, Rust's std) follow
// the MSVC runtime, which node writes the line for. A program of the MSYS
// family also globs an argument there, expands ~ and {a,b}, and reads a file
// for @file, unless the argument is in double quotes, where it reads \" as
// the MSVC runtime does. So an argument with a space or one of those
// characters goes in double quotes, which a Windows program reads the same.
// (In double quotes MSYS also makes one backslash of two, where the MSVC
// runtime keeps both; outside them both keep them, so an argument with
// nothing else to quote stays as it is.)
function windowsArgument(arg) {
  if (arg !== "" && !/[\s"'*?[\]{}~@]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

// Runs one "setup" or "after" line in the case's directory and environment.
function runLine(line, cwd, env) {
  const options = { cwd, encoding: "utf8", timeout: 120_000 };
  const shell = posixShell().path;
  // As it always was: node's shell, /bin/sh.
  if (!shell) return spawnSync(line, { ...options, env, shell: true });
  if (!isWindows) return spawnSync(shell, ["-c", line], { ...options, env });
  // On Windows a shell of the MSYS family reads its command line by rules of
  // its own (Git Bash makes one backslash of two), so the line comes in a
  // variable, which the shell takes out of the environment before it runs it.
  // The shell's own directory goes first on PATH unless PATH has it ahead of
  // System32: there are the find, sort and stat the lines mean, and System32
  // has a find.exe and a sort.exe of its own.
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const entries = String(env[pathKey] ?? "").split(";").filter(Boolean);
  const own = path.dirname(shell);
  const at = (dir) => entries.findIndex((entry) => path.resolve(entry).toLowerCase() === dir.toLowerCase());
  const [ownAt, systemAt] = [at(own), at(path.join(process.env.SystemRoot || "C:\\Windows", "System32"))];
  const ahead = ownAt >= 0 && (systemAt < 0 || ownAt < systemAt);
  const lineEnv = { ...env, [pathKey]: ahead ? env[pathKey] : [own, ...entries].join(";"), [LINE]: line };
  return spawnSync(shell, ["-c", `eval "unset ${LINE}; $${LINE}"`], { ...options, env: lineEnv, windowsHide: true });
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
  return visible(
    text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, (char) => {
      if (char === "\r") return "\\r";
      if (char === "\t") return "\\t";
      if (char === "\u001b") return "\\e";
      // \xNN is a byte that is not UTF-8 (see visible); U+0080 to U+009F are characters.
      const code = char.charCodeAt(0);
      return code < 0x80 ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u${code.toString(16).padStart(4, "0")}`;
    }),
  );
}

// What the terminal was sent, or a program wrote into a file, as text that
// keeps every byte: valid UTF-8 as its characters, and every other byte as
// one of the code units U+DC80 to U+DCFF, which valid UTF-8 never decodes to
// (Python calls this "surrogateescape"). Decoded as plain UTF-8, two different
// invalid bytes would both become U+FFFD and compare the same.
function fromBytes(bytes) {
  let text = "";
  let start = 0;
  let at = 0;
  while (at < bytes.length) {
    const length = utf8Length(bytes, at);
    if (length) {
      at += length;
      continue;
    }
    text += bytes.toString("utf8", start, at) + String.fromCharCode(0xdc00 + bytes[at]);
    start = ++at;
  }
  return text + bytes.toString("utf8", start, at);
}

// The length of the well-formed UTF-8 sequence that starts at `at`, or 0
// (the table of well-formed sequences in the Unicode standard, 3.9).
function utf8Length(bytes, at) {
  const lead = bytes[at];
  if (lead < 0x80) return 1;
  let length;
  let [low, high] = [0x80, 0xbf];
  if (lead >= 0xc2 && lead <= 0xdf) length = 2;
  else if (lead >= 0xe0 && lead <= 0xef) {
    length = 3;
    if (lead === 0xe0) low = 0xa0;
    if (lead === 0xed) high = 0x9f;
  } else if (lead >= 0xf0 && lead <= 0xf4) {
    length = 4;
    if (lead === 0xf0) low = 0x90;
    if (lead === 0xf4) high = 0x8f;
  } else return 0;
  if (at + length > bytes.length || bytes[at + 1] < low || bytes[at + 1] > high) return 0;
  for (let next = at + 2; next < at + length; next++) if (bytes[next] < 0x80 || bytes[next] > 0xbf) return 0;
  return length;
}

// A byte that is not UTF-8 (see fromBytes), shown as \xNN.
function visible(text) {
  return text.replace(/[\u{dc80}-\u{dcff}]/gu, (unit) => `\\x${(unit.charCodeAt(0) - 0xdc00).toString(16)}`);
}

// On Windows the temp directory is often given in its 8.3 spelling
// (C:\Users\RUNNER~1\…); the native realpath spells it out, so the programs
// are handed one spelling, the long one.
const work = fs.mkdtempSync(path.join((isWindows ? fs.realpathSync.native : fs.realpathSync)(os.tmpdir()), "rustify-parity-"));

// Other spellings of a directory on Windows, each as [prefix, another
// spelling of that prefix, its tag]: the 8.3 one of the run's directory
// ("8.3"), the long ("") and 8.3 ones of <REPO>. A program can still come upon
// them. The long spelling of <REPO> has no tag: the runner was started in
// <REPO> as given, and Windows gives back the long one for it.
const otherSpellings = [];
// The directory that MSYS tools call /tmp, in every spelling: the runner's
// temp directory, and the one the shell for the lines says (shellTemp).
// Started from Git Bash, that shell shares the mounts of the Git Bash that is
// still running, whose /tmp is its temp directory, usually the runner's too,
// so its tools print the run's directories as /tmp/rustify-parity-…
const tempSpellings = [];
if (isWindows) {
  for (const dir of [work, launchDir]) {
    let long = dir;
    try {
      long = fs.realpathSync.native(dir);
    } catch {}
    const short = shortName(long);
    if (long !== dir) otherSpellings.push([dir, long, ""]);
    if (short && short !== dir && short !== long) otherSpellings.push([dir, short, "8.3"]);
  }
  const temp = os.tmpdir();
  const longTemp = fs.realpathSync.native(temp);
  for (const spelling of new Set([temp, longTemp, shortName(longTemp)])) if (spelling) tempSpellings.push(spelling.toLowerCase());
}

// The 8.3 spelling of a directory, as cmd gives it, or null.
function shortName(dir) {
  const cmd = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
  const result = spawnSync(cmd, ["/d", "/c", `for %I in ("${dir}") do @echo %~sI`], { encoding: "utf8", windowsVerbatimArguments: true, windowsHide: true, timeout: 30_000 });
  const short = result.status === 0 ? result.stdout.trim() : "";
  return /^[A-Za-z]:\\/.test(short) && !short.includes("\n") ? short : null;
}

// Every spelling of a directory that clean() turns back into its placeholder,
// each as [spelling, tags]: what sets it apart from the spellings the runner
// hands out. On Linux and macOS that is the directory as it is. On Windows the
// runner hands out the directory as given and with forward slashes (C:/Users/…,
// as the placeholders are written), and those have no tag. The others do:
// "8.3" for the short spelling (above), "json" with doubled backslashes
// (C:\\Users\\…, as JSON and Rust's {:?} write it), "msys" as MSYS tools print
// it (/c/Users/…, or /tmp/… under the shell's temp directory). So two programs
// that print a directory in different spellings still differ. Longest first,
// so that no spelling takes part of another.
function spellingsOf(dir) {
  if (!isWindows) return [[dir, []]];
  const bases = [[dir, []]];
  for (const [prefix, other, tag] of otherSpellings) {
    if (dir === prefix || dir.startsWith(`${prefix}\\`)) bases.push([other + dir.slice(prefix.length), tag ? [tag] : []]);
  }
  // The first tags given to a spelling hold.
  const forms = new Map();
  const add = (spelling, tags) => forms.has(spelling) || forms.set(spelling, tags);
  for (const [base, tags] of bases) {
    const slashed = base.replace(/\\/g, "/");
    add(base, tags);
    add(slashed, tags);
    add(base.replace(/\\/g, "\\\\"), [...tags, "json"]);
    const drive = /^([A-Za-z]):\//.exec(slashed);
    if (drive) add(`/${drive[1].toLowerCase()}${slashed.slice(2)}`, [...tags, "msys"]);
    for (const temp of tempSpellings) if (base.toLowerCase().startsWith(`${temp}\\`)) add(`/tmp${slashed.slice(temp.length)}`, [...tags, "msys"]);
  }
  return [...forms].sort(([a], [b]) => b.length - a.length);
}

// What clean() does for one directory: its spellings as they are, and on
// Windows also in any other letter case, which Windows takes for the same
// directory and which is then told apart by the tag "case".
function placeOf(dir, name) {
  const forms = spellingsOf(dir);
  const pattern = forms.map(([spelling]) => escapeRegExp(spelling)).join("|");
  const exact = new Map(forms);
  const anyCase = new Map();
  for (const [spelling, tags] of forms) if (!anyCase.has(spelling.toLowerCase())) anyCase.set(spelling.toLowerCase(), [...tags, "case"]);
  const placeholder = (tags) => `<${[name, ...tags].join(":")}>`;
  return (text) => {
    const out = text.replace(new RegExp(pattern, "g"), (found) => placeholder(exact.get(found)));
    return isWindows ? out.replace(new RegExp(pattern, "gi"), (found) => placeholder(anyCase.get(found.toLowerCase()))) : out;
  };
}
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
  if ((testCase.setup?.length || testCase.after?.length) && posixShell().problem) return { broken: posixShell().problem };
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
  // <CWD>, <HOME> and <ROOT> in what a case says stand for this run's
  // directories. On Windows with forward slashes, C:/Users/…: the one spelling
  // that both a POSIX shell and Windows programs read as that directory.
  const spelt = (dir) => (isWindows ? dir.replace(/\\/g, "/") : dir);
  const here = (text) =>
    String(text).split("<CWD>").join(spelt(cwd)).split("<HOME>").join(spelt(home)).split("<ROOT>").join(spelt(root)).split("<REPO>").join(spelt(launchDir));
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
    ...(isWindows ? { SystemRoot: process.env.SystemRoot, TEMP: tmp, TMP: tmp, PATHEXT: process.env.PATHEXT, ...AS_WRITTEN } : {}),
    // On a terminal there is always a TERM, and programs choose their colours by it.
    ...(terminals.length ? { TERM: "xterm-256color" } : {}),
  };
  // The cases file's variables, then the case's. null takes a variable out
  // (on Windows in any spelling: Path and PATH are one variable there).
  const named = new Set();
  for (const variables of [spec.env, testCase.env]) {
    for (const [name, value] of Object.entries(variables || {})) {
      named.add(isWindows ? name.toUpperCase() : name);
      if (value !== null) env[name] = here(value);
      else for (const key of Object.keys(env)) if (key === name || (isWindows && key.toUpperCase() === name.toUpperCase())) delete env[key];
    }
  }
  Object.assign(env, extraEnv);
  // The lines' environment: the program's, without the variables above that
  // keep MSYS from converting paths, unless the cases themselves set them.
  const lineEnv = { ...env };
  for (const name of Object.keys(AS_WRITTEN)) if (isWindows && !named.has(name)) delete lineEnv[name];
  const shell = (line) => runLine(here(line), cwd, lineEnv);
  for (const line of testCase.setup || []) {
    const result = shell(line);
    // The shell could not be started (a timeout is reported as before, below).
    if (result.error && result.error.code !== "ETIMEDOUT") return { broken: `setup \`${line}\` could not be run: ${result.error.message}` };
    if (result.status !== 0) {
      return { broken: `setup \`${line}\` exited ${result.status}: ${result.stderr || result.stdout}` };
    }
  }
  const [program, ...baseArgs] = impls[impl].argv;
  const args = [...baseArgs, ...(testCase.args || []).map(here)];
  // What a leading `env NAME=value` in --ts or --rs sets, on Windows (see command()).
  const programEnv = { ...env };
  for (const [name, value] of Object.entries(impls[impl].vars)) setVariable(programEnv, name, value);
  const seconds = testCase.timeout || 120;
  const options = { cwd, env: programEnv, input: here(plan.piped), encoding: "utf8", timeout: seconds * 1000 };
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
  } else if (isWindows) {
    // The command line as windowsArgument() writes it, the program's own path first.
    result = spawnSync(program, args.map(windowsArgument), { ...options, windowsVerbatimArguments: true, argv0: windowsArgument(program) });
  } else {
    result = spawnSync(program, args, options);
  }
  for (const fd of Object.values(sinks)) fs.closeSync(fd);
  // Files and the terminal are read byte for byte; pipes as UTF-8 text, as
  // the runner always has.
  const written = (name) => (plan.files ? fromBytes(fs.readFileSync(path.join(own, name))) : result[name]);
  const onTerminal = terminals.length && fs.existsSync(transcript) ? fromBytes(fs.readFileSync(transcript)) : null;
  // On a terminal the runner started terminal.py, which had started the
  // program: any trouble with that is the run's, whatever exit code came back.
  if (result.error && (result.status === null || terminals.length)) {
    if (terminals.length && result.error.code === "ETIMEDOUT") {
      // The last line that shows something: an echo ends with a line end.
      const last = spelledOut((onTerminal ?? "").slice(-200))
        .split("\n")
        .filter((line) => line.replace(/\\r/g, "").trim())
        .pop();
      const waiting = neverTyped(onTerminal ?? "", plan.typed.map((step) => step.map(here)));
      let why = "";
      if (waiting) why = `; it never showed ${JSON.stringify(waiting[0])}, so ${JSON.stringify(waiting[1])} was not typed`;
      else if (terminals.includes("stdin")) {
        why = '; stdin was the terminal, whose input does not end: a program that reads it to the end needs "\\u0004" typed, or stdin a pipe ("tty": "stdout,stderr")';
      }
      return { broken: `${program} had not ended after ${seconds} s on a terminal, which last showed: ${last || "(nothing)"}${why}` };
    }
    return { broken: `could not run ${program}: ${result.error.message}` };
  }
  // terminal.py always leaves a transcript, except when it could not start the program.
  if (terminals.length && onTerminal === null) {
    return { broken: lastLine(written("stderr")) || `the terminal helper ended with ${result.status} and without a transcript` };
  }
  const rules = [...(spec.normalize || []), ...(testCase.normalize || [])].map(([pattern, to]) => [new RegExp(pattern, "g"), to]);
  // Every spelling of each directory (see spellingsOf and placeOf).
  const places = [[cwd, "CWD"], [home, "HOME"], [root, "ROOT"], [launchDir, "REPO"]].map(([dir, name]) => placeOf(dir, name));
  const clean = (text) => {
    let out = String(text ?? "");
    for (const place of places) out = place(out);
    for (const [pattern, to] of rules) out = out.replace(pattern, to);
    return out;
  };
  // A stream that is the terminal has nothing of its own: it is in "terminal".
  // A program ended by a signal has no exit code; which signal it was is compared instead.
  const observed = { "exit code": String(result.status ?? `signal ${result.signal}`) };
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
  const lines = (spell ? spelledOut(text) : visible(text)).split("\n");
  const shown = lines.slice(0, 30).map((l) => `        ${l}`);
  if (lines.length > 30) shown.push(`        … ${lines.length - 30} more line(s)`);
  return `      ${label}:\n${shown.join("\n")}`;
}

let failed = 0;
let ran = 0;

// The cases a "skip" keeps from running on this system, by reason.
const skipped = new Map();
function skips(testCase, plan) {
  if (plan.skip === null) return false;
  if (!skipped.has(plan.skip)) skipped.set(plan.skip, []);
  skipped.get(plan.skip).push(testCase.name);
  return true;
}

// How many cases did not run here, and why: at the end of every run.
function skipReport() {
  if (!skipped.size) return;
  const count = [...skipped.values()].reduce((sum, names) => sum + names.length, 0);
  console.log(`${count} case(s) skipped on ${process.platform}, as the cases say:`);
  for (const [reason, names] of skipped) console.log(`  ${String(names.length).padStart(4)}  ${reason}`);
}

// --handback ROOT_ENV=entry: which cases does the binary answer itself?
function handbackCheck() {
  const { rootEnv, entry } = handback;
  const standIn = path.join(work, "stand-in");
  fs.mkdirSync(path.dirname(path.join(standIn, entry)), { recursive: true });
  fs.writeFileSync(path.join(standIn, "package.json"), JSON.stringify({ name: "stand-in", version: "0.0.0" }));
  fs.writeFileSync(path.join(standIn, entry), `console.log(${JSON.stringify(MARKER)});\n`);
  // Without it every handed-back case would look answered by the binary.
  mine.push(path.join(standIn, entry));
  let native = 0;
  let back = 0;
  for (const { testCase, index, plan } of selected) {
    if (skips(testCase, plan)) continue;
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
    if (reached === (plan.handback !== null)) continue;
    failed++;
    const system = typeof testCase.handback === "object" ? `on ${process.platform}: ` : "";
    let why;
    if (!reached) why = `was answered by the binary, but the case says it is handed back (${system}${plan.handback})`;
    else if (plan.handbackElsewhere.length) why = `reached the JavaScript on ${process.platform}, but the case says "handback" only on ${plan.handbackElsewhere.join(", ")}`;
    else why = 'reached the JavaScript, but the case does not say "handback"';
    console.log(`  WRONG   ${testCase.name}\n      ${why}`);
  }
  if (ran && !failed) console.log(`${native} case(s) answered by the binary, ${back} handed back to the JavaScript, as the cases say`);
}

function compareAll() {
  for (const { testCase, index, plan } of selected) {
    if (skips(testCase, plan)) {
      console.log(`  skip    ${testCase.name}`);
      continue;
    }
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
  if (handback) handbackCheck();
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
skipReport();
if (!ran) {
  console.log("no case ran");
  process.exit(2);
}
if (handback) {
  if (failed) console.log(`${failed} of ${ran} case(s) went the wrong way`);
} else {
  console.log(failed ? `${failed} of ${ran} case(s) differ` : `all ${ran} case(s) behave the same`);
}
process.exit(failed ? 1 : 0);
