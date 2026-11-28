# Porting a project, command by command

How a TypeScript CLI becomes a Rust one here without ever shipping a
behaviour change. Read [purpose.md](purpose.md) first.

Six projects have been through it: genvx, gchat-cli, slack-hub (`search` and
`news`), dotenvdotenc, qqdocs and onenote-cli, between 300 and 800 cases
each. What they ran into is written into the steps below.

## The model

1. **The Rust binary becomes the command, and hands everything back.** From
   the first release on, `bun i -g <package>` installs the native binary. It
   passes every invocation to the JavaScript the package still ships, so users
   notice nothing.
2. **A command moves to Rust when a test proves it behaves the same.** Not
   before, and one at a time. The proof runs in CI against the binary that is
   about to be published.
3. **When everything has moved, the JavaScript goes.** `mode` becomes
   `native` and the hand-back is deleted.

At every step the published package is correct. Progress is the number of
`verified` entries in the project's ledger (`parity/<project>.toml`).

## What "the TypeScript" means

The thing to match is the published command as its runtime runs it, not the
source file read in isolation. Check first which file that is: `npm view
<package> bin`. npm ignores `publishConfig.bin`, so a package that sets it
still runs what `bin` names (slack-hub and gchat-cli run `ts/cli.ts`, not the
`dist/cli.js` they also ship). That file is what the binary hands back to.

Then find out what the runtime does around the program. Every item below was
found by a port or by the verification of one, and each was visible to a user.

**Before the first line of the program, bun**

- loads `.env`, `.env.local`, `.env.development` and `.env.development.local`
  from the current directory into the environment (other names under another
  `NODE_ENV`), with its own syntax (`$VAR` expansion, `export`, quoting,
  multi-line values). A project's own tests often run with `--no-env-file`
  and never see this. It goes into `process.env` only, not into the
  environment the system keeps for the process, so the binary started by
  launcher v3 does not get it either (see "The launcher's environment" in
  [npm-distribution.md](npm-distribution.md)); the JavaScript it hands back
  to loads the files itself, as before;
- reads `bunfig.toml` from the directory and from the user's configuration,
  and takes options from `BUN_OPTIONS` and `NODE_OPTIONS`;
- reads `package.json`, `tsconfig.json` and `jsconfig.json` from the current
  directory and every directory above it, and reports one it cannot parse on
  stderr;
- writes to stderr when a variable meant for it is set: `NODE_DEBUG`,
  `BUN_JSC_*`, `MIMALLOC_VERBOSE`. The rule the ports ended up with: any
  `BUN_*` (except `BUN_INSTALL`, which the installer sets for nearly
  everyone), `NODE_*`, `MIMALLOC_*` or `ICU_*` variable goes back;
- cannot load a program from a path with `?` or `\` in it.

**While it runs, bun**

- prints `console.error` in red whenever stdout *or* stderr is a terminal,
  reads `NO_COLOR` and `FORCE_COLOR` in its own way, and decides this before
  it loads `.env`;
- formats dates with `toLocaleString()` as en-US on Linux whatever `LANG` and
  `LC_*` say. What it does on macOS and Windows has to be tried there;
- takes local time from the time zone data it carries (ICU's), not from the
  system's. A Rust binary reads the system's zone files or a database
  compiled into it, and the three editions disagree wherever a country
  changed its rules recently: in late 2026, bun 1.4.0 against tzdb 2026f
  differed for Western Canada, Cuba and Morocco. Compare every zone name the
  binary accepts against the runtime, keep the comparison as a test, and hand
  back where they differ;
- cuts the output of a child started with `spawnSync` off near 1 MiB and
  reports a failure;
- can lose output: once the program has read `process.stdout.isTTY`, lines
  written with `console.log` to a pipe that is read slowly are dropped (bun
  1.4.0; 1,896 of 6,014 lines arrived in one measurement). The TypeScript is
  then not deterministic for large output through a pipe (step 2 says how a
  case compares it all the same), and whether the binary should copy the
  loss is the owner's decision.

**On Windows, bun**

- removes nothing when told to remove a directory by a path that starts with
  `./` or `.\`: `fs.promises.rm("./.genvx", { recursive: true, force: true
  })` and `fs.rmSync` return without an error and leave the directory as it
  was (bun 1.4.2; `.genvx` without the `./` is removed, and node 24 removes
  both). genvx's TypeScript names its working directory `./.genvx`, so on
  Windows it never removes it, and its Rust does;
- hangs, instead of failing, when `TEMP` names a directory it cannot use:
  wtx's first CI run on Windows hung in `bun --version` until the job was
  cancelled;
- writes what JavaScript changes in `process.env` (a new name or a new
  value) into the process's own environment block at once, the name in
  capitals (`toUpperCase()`'s:
  `lc_x` becomes `LC_X`, `straße_x` becomes `STRASSE_X`), and what it
  deletes (bun 1.4.2); on Linux and macOS it writes nothing there. So on
  Windows native code that reads the environment itself, or starts a
  program with it as bun-pty does, sees those changes, and so does the npm
  launcher, which passes what a preload did on to the binary there (see
  "The launcher's environment" in [npm-distribution.md](npm-distribution.md)).

**JavaScript itself**

- writes a number in the shortest form that reads back the same, and where
  two such forms are equally near it takes the even digit
  (`1459077941253781.25` is written `…781.2`); Rust's formatting takes the
  other;
- finds `constructor`, `toString` and `__proto__` in every plain object, so a
  lookup by a user's key (`obj[name]`) answers for those names too;
- parses dates leniently: `2026-02-30` is March 2nd.

**The argument parser**

- yargs prints `unknown` for `--version` when the package was installed
  globally with bun (it looks for the package relative to its own location,
  which in bun's flat `node_modules` is not the package), and the version
  when installed with npm;
- yargs prints the command's help when the last word is `help` (`mycli search
  help`), in the user's language;
- without a `.fail()` handler, yargs answers every error a command throws
  with the command's whole help text followed by the runtime's error report:
  source excerpt, stack trace, paths of the installed files. That cannot be
  reproduced, so such errors are handed back, and a command that writes
  cannot be ported at all until the project reports its errors itself (see
  "What to hand back").

Find out which of these the project's users can observe before deciding what
a case has to cover. It is the largest part of the work.

## 1. Start the crate

Run the tool from the rustify checkout and point it at a clean worktree of the
project, on a new branch:

```bash
cd <rustify checkout>
cargo run -q --release -- scaffold <project> --at <worktree>   # rs/Cargo.toml, rs/src/main.rs, rs/src/js_fallback.rs
cargo run -q --release -- vendor <project> --at <worktree>     # .github/workflows/rust-npm-release.yml
```

Then add the `rustify` block the scaffold prints to `package.json`, build once
and commit `Cargo.lock`. Add `manifest = "rs/Cargo.toml"` and `rust =
["rs/src"]` for the project in `projects.toml`, or the audit keeps reporting
that it has no Rust. The pull request's run builds six platforms and
install-tests them.

A project whose TypeScript lies at the repository root is `ts = ["."]`, and
the audit then counts every script in the repository as TypeScript to
replace. Only the scripts inside the `rust` directories of a crate that has a
directory of its own (`rs/src` for `rs/Cargo.toml`) are taken for the port's
own; a case generator elsewhere in `rs/` is not, so add `ignore = ["rs"]`.
The Rust is still counted: a directory listed under `rust` counts even when
an `ignore` entry holds it.

```toml
manifest = "rs/Cargo.toml"
ts = ["."]
rust = ["rs/src"]
ignore = ["rs", "skills"]
```

A crate at the repository root (`manifest = "Cargo.toml"`) shares its `src`
with the TypeScript, so there the file extension alone tells the two apart:
with `ts = ["."]` and `rust = ["src"]`, `src/index.ts` is TypeScript to
replace and `src/main.rs` is Rust. For such a crate the scaffold adds
`/target` to the project's own `.gitignore` and keeps everything else in it.

If `package.json` has no `files` list, npm and bun pack the whole directory,
the crate included. For a crate in a directory of its own the scaffold writes
`rs/.npmignore` containing `*`, and the pipeline's packer leaves the crate's
directory out as well; check with `npm pack --dry-run`. A command whose file
lies inside the crate's directory would be left out with it, so the packer
stops with an error instead: give such a package a `files` list.

Use `build:`, `test:` or `ci:` commit types for all of this, and for every
port commit after it: the project's users get nothing new until the owner
switches publishing on, so no release should be cut.

A package with several commands (`ay`, `claude-yes`, …) still needs only one
cargo bin: map every command to it in `rustify.bins`. The binary learns which
command it was started as from its own name, and the scaffold writes the
lookup from command to JavaScript file when the commands run different files.

One thing the hand-back cannot keep: under node, a script started through a
command's symlink sees that symlink's path in `process.argv[1]`; handed back,
it sees its own real path. (Under bun it always saw the real path.) A package
that runs on node, shares one file between several commands and tells them
apart by `argv[1]` needs its own answer, such as one small file per command.

`templates/rust/js_fallback.rs` carries a version in its first line. When the
template moves on, copy the new file over the crate's, and put the project's
own name back into `ROOT_ENV` (the scaffold wrote `<PROJECT>_PACKAGE_ROOT`
there). Version 5 needs Rust 1.81 or later. A port keeps the copy it has
until it adopts a newer one; nothing changes for it until then.

Version 6 keeps every name of version 5 (`run`, `attempt`, `HandBack`,
`commit`, `package_root`, `ROOT_ENV`, `TRACE_ENV`, `TRACE_LINE`) and adds
`names_root`, so it replaces a version 5 file as it is.
What it changes, from faults wtx's port found in version 5 and in version
6's first cut:

- On Linux and macOS an entry with a `#!` line is started as the system
  starts it, and only so: the interpreter and its argument as that system
  reads them, Linux passing all that follows the interpreter as one argument,
  macOS splitting it at blanks and ending the line at a `#` (both keep a
  carriage return: a CR LF entry asks env for `bun\r`). A relative
  interpreter is found from the working directory, as the kernel finds it.
  `#!/usr/bin/env bun` with no bun on PATH is reported by env, in its words,
  with exit code 127, as when the command was the script. Version 5 started
  the runtime the line names by its name and then tried bun and node as
  well, so without bun wtx's entry, which node cannot run, went to node.
  It also means that an entry whose line says `#!/usr/bin/env node`, on a
  machine with bun and no node (where the launcher's runtime is bun, say),
  now gets env's `No such file or directory` and exit 127, where version 5
  ran it with bun. That is what the command did before it was ported; an
  owner whose users may have only bun writes `#!/usr/bin/env bun` there. An
  entry without a `#!` line (or with one the system refuses: empty, longer
  than macOS reads, or with a NUL where the interpreter's name begins) goes
  to bun, then to node unless it is TypeScript, as before. A NUL right after
  a blank leaves an empty argument, which both kernels pass and version 6
  passes too. `tests/e2e/toy/tests/handback.rs` compares all this with the
  kernel on every run of the toy's tests.
- On Windows the entry is started as the package managers' shims start it,
  which is how it was started before the binary existed. Measured on
  Windows 11 with npm 11 (node 24.8) and bun 1.4.2, the runtime the `#!`
  line names missing from PATH: npm's `.cmd` lets cmd.exe say `'"bun"' is
  not recognized as an internal or external command, operable program or
  batch file.` and exits 1; npm's `.ps1` reports PowerShell's
  CommandNotFoundException and exits 0; npm's sh script (Git Bash) says
  `exec: bun: not found` and exits 127; bun's `.exe` says `error: bun is
  not installed in %PATH%` and exits 255. None of them gives an entry whose
  line names bun to node, and none starts anything else for a line naming
  another program (`tsx`: bun's says `interpreter executable "tsx" not found
  in %PATH%`). Only bun's starts bun for a line naming node, when node is
  missing and bun is there. So version 6 starts what the line names and
  nothing else, but bun after node. Its first cut went on, as version 5
  did, to bun and then node: a `#!/usr/bin/env bun` entry that imports
  `./src/server`, with no bun on PATH, went to node, which failed on that
  import with `ERR_MODULE_NOT_FOUND` and a stack trace. When nothing can be
  started the binary says what is missing (`cannot run C:\…\cli.mjs: its
  #! line names bun; bun was not found in PATH. See https://bun.sh`) and
  exits 1, as npm's shim does from a command prompt; that is the exit code
  of no other shim, and the words are the binary's own. An entry without a
  `#!` line goes to bun, then to node unless it is TypeScript, as before.
- On Windows each runtime is looked up in the directories of PATH, in order,
  with the extensions of PATHEXT a program can be started from (`.com`,
  `.exe`, `.bat`, `.cmd`), in PATHEXT's order; unlike cmd.exe, not in the
  working directory first. That finds `bun.exe`, and also the `bun.cmd` that
  `npm i -g bun` writes, which version 5 never tried. Rust starts a `.cmd`
  through cmd.exe and quotes every argument for it (since Rust 1.77.2, the
  BatBadBut fix): `%`, `"`, `&`, `^`, `|`, `<`, `>`, `!`, spaces, an empty
  argument, a trailing backslash and non-ASCII text all reached the program
  behind npm's `bun.cmd` unchanged (Windows 11, Rust 1.96). An argument
  with a line break (CR or LF) or a NUL is refused by Rust, and the binary
  then says so and exits 127, instead of trying node.
- `ROOT_ENV` is taken out of the JavaScript's environment when it names this
  package's directory, which is what the launcher sets it to, and only then.
  wtx hands its whole environment to every terminal session, where the
  launcher's variable showed up. A value of the user's own that names another
  directory stays.

## 2. Write the cases before the code

Pick one command. Write down how it must behave as parity cases — the command
lines, the inputs, and what to look at afterwards — and run them **TypeScript
against TypeScript** first:

```bash
node <rustify>/templates/parity/parity.mjs --cases rs/parity.json \
  --ts "bun ts/cli.ts" --rs "bun ts/cli.ts"
```

That run has to pass. If it does not, a case is not deterministic (a
timestamp, a random id, a path): fix the case, or add one narrow `normalize`
rule. Every rule is a hole in the proof, so keep them few. `--show` prints
what each case compared; use it to catch a case whose probes fail the same way
on both sides and so prove nothing.

A bun program that has read `process.stdout.isTTY` loses stdout written to a
pipe once it prints a few hundred lines. With bun 1.4.0, the same 500-line
program compared with itself differed in 22 of 30 cases, and in 15 of 15 on
a busier machine. If TypeScript against TypeScript fails this way, give the
case `"capture": "files"`, or pass `--capture files`. The program then writes
into regular files, nothing is lost, and every byte is compared. That settles
the case, not the question of whether the Rust should lose lines the same way
when users pipe the command (see "What the TypeScript means"). Through pipes
the runner reads at most 64 MiB of stdout and stderr together (node's
spawnSync counts the two as one); a case that prints more is BROKEN and says
to use `"capture": "files"`, which has no limit.

Cover, for the command:

- its plain use, and each flag that changes what it does;
- the ways it fails: missing argument, bad value, missing file, a server
  error. The exit code and the text on stderr are part of the behaviour;
- what it leaves behind (`after`: files, git state, config);
- input on stdin, if it reads any;
- where its settings come from: every file, variable and flag, and which one
  wins.

The runner starts each case in an empty directory with an empty `HOME`, its
own temp directory, and pipes for stdin, stdout and stderr. In a case,
`<CWD>` and `<HOME>` stand for those directories. `<ROOT>` stands for the
directory that holds them: the place for the test's own files of one run,
such as a request log or a copy of the package, outside what the program
looks at. `<REPO>` stands for the directory the runner was started in. So
the cases file can be committed as it is. A `null` in `env` removes a
variable, whether the cases file's global `env` or the runner set it, so one
case can go without the `TZ` that the global `env` gives every other case.

`setup` and `after` lines are POSIX shell. The runner runs them with
`/bin/sh`, on Windows with Git for Windows' bash, which it finds by itself,
or with the shell `--shell` names; never with Windows' own `bash.exe`, which
starts WSL. Write them so that they mean the same on every system the cases
run on. A path that the program is to read, in a file that a line writes or
in a variable, goes in as `<CWD>`, `<HOME>`, `<ROOT>` or `<REPO>`, never as
`$(pwd)`, `~` or `$HOME`. On Windows the shell spells those `/c/Users/…` or
`/tmp/…`, which no Windows program reads as meant, while the runner writes
the placeholders as `C:/Users/…`, which both read. 138 of genvx's cases
write the path of a store beside their directory, such as `"$(cd .. &&
pwd)/store.git"`, into a configuration file, and on Windows they test a
store that does not exist; `<ROOT>/store.git` is the same store on every
system. A probe that a system's tools answer differently proves nothing
there: GNU `stat -c '%a'` fails the same way on both sides on macOS, and Git
Bash reports 644 for every file, whatever its mode (71 of genvx's cases);
GNU `touch -d` fails on macOS. A file of the case whose name the system does
not keep (on Windows a tab, or a trailing dot) makes that case BROKEN, and
the run goes on with the rest. Where a case cannot mean the same thing on a
system, give it `"skip": { "win32": "<why>" }`, keyed by operating system as
node's `process.platform` names it (`linux`, `darwin`, `win32`). A misspelt
system (`windows`) or one with an architecture (`darwin-arm64`) stops the
run. Every run says at its end how many cases were skipped there and why,
and a run in which every case was skipped fails as "no case ran".

On Windows a directory comes back as its placeholder in every spelling, and
a spelling other than the runner's own keeps a tag. `<CWD>` is the directory
as Windows gives it, or with forward slashes. `<CWD:json>` has doubled
backslashes, as JSON and Rust's `{:?}` write them; `<CWD:msys>` is the way
MSYS tools print it; `<CWD:8.3>` is the short spelling; `:case` marks other
letter case. A line's `pwd` is therefore `<CWD:msys>` there. When both sides
print the same spelling, they compare the same. A port that prints `{:?}`
where its TypeScript prints the plain path differs, as its users would see.

The short spelling is not rare. On GitHub's Windows runners `TEMP` is
`C:\Users\RUNNER~1\AppData\Local\Temp`, while a machine whose user name has
eight letters or fewer never shows one. bun's `fs.realpathSync` writes such a
name out in full, node's keeps it, and node's `fs.realpathSync.native` writes
it out. A port's own test that compares directories runs both sides through
`fs.realpathSync.native` first. rustify's launcher tests passed on jr and
failed on the runners until they did.

The runner compares the exit code (for a program that a signal ended, which
signal: `signal SIGTERM`), stdout, stderr, and what each `after` line prints.
Through pipes, stdout and stderr are read as UTF-8 text, so bytes that are
not UTF-8 all turn into U+FFFD there and are not told apart. On a terminal
and with `"capture": "files"` (both below) every byte is compared, and the
runner shows a byte that is not UTF-8 as `\xNN`.

What the runner cannot express needs its own small test beside it: one
implementation reading what the other wrote, a chosen working directory.

A terminal is a field of the case. `"tty": true` gives the program a
pseudo-terminal as stdin, stdout and stderr; `"tty": "stdout"` (or
`"stdin,stderr"`, …) gives it only those; `--tty` does the same for every
case that does not say. The runner then compares every byte the terminal
received, in order, as `terminal`, beside the streams that stayed pipes.
Colours, links, CR LF and the echo of what was typed are all part of it.
This needs Linux or macOS with python3. On Windows, or without python3, such
cases are BROKEN, never passed.

A project's own script that gives a command a pseudo-terminal must keep the
terminal open itself until it has read everything, as the runner's
`terminal.py` does. On macOS, when a command exits and nothing else holds its
terminal open, the terminal waits at most 0.6 s for the reader to take what
is still unread (60 ticks in XNU's `ptsclose`), and then throws it away. If
the terminal is not the command's controlling terminal, nothing is kept at
all. `pty.fork` gives the command a controlling terminal but lets go of it in
the reader, so its 0.6 s limit applies. A process in the session that opened
`/dev/tty` lifts the limit. bash does that when it starts, and macOS's `sh`
is bash, so a command run through `sh` keeps its output; dash, zsh, a Rust
binary and bun started directly do not.

Linux keeps the output either way, so the loss shows only on macOS, and only
when the reader is late, as on a busy CI runner. Measured on macOS 27:

- With the reader late by 0.3 s and no controlling terminal, the output was
  lost in 20 of 20 tries.
- With the reader stopped for 1.5 s behind `pty.fork`, it was lost in 8 of
  8.
- With the reader holding the terminal, it was kept every time.

On a macOS pseudo-terminal, XNU also writes CR CR LF instead of CR LF
wherever the output queue was full, about every 1,023 bytes. Identical
output glitches identically on both sides. But a normalize rule that counts
or collapses a terminal's lines has to accept `\r+\n` (rustdesk.skill's
endless-output case, 2026-11-28).

A project's script that gives a command "a stdout whose reader has gone"
must not wait for a reader. The construction `(: < fifo) & exec 3> fifo`
races on macOS. When the background reader opens and leaves before the
writer's open sees it, the open waits, and SIGCHLD then fails it with
`Interrupted system call`. Instead, open the FIFO read-write and then
write-only, and close the read-write end: `exec 3<> fifo; exec 4> fifo;
exec 3<&-`. Nothing waits, and it works in dash and in macOS's `sh`.

This loss explains two flakes on GitHub's macOS runner: six scenes of
dotenvdotenc's `rs/tty-compat.py` lost their output, and so did one
onenote-cli case run through `rs/parity/terminal.py` (`pty.fork` in front of
the binary).

For a command whose output changes on a terminal, run the whole cases file a
second time with `--tty stdout,stderr`. Colours depend on those two streams:
bun colours `console.error` whenever stdout or stderr is a terminal. stdin
stays a pipe, so the cases that pipe input in still reach its end. `--tty`
alone would make stdin the terminal as well. Every case's `stdin` would then
be typed, and a program that reads stdin to the end would wait until the
case's timeout, because a terminal's input never ends.

Give each question its own case, with `"tty": true` and the answer written as
`"stdin": [["[y/N] ", "y\n"]]`. The answer is then typed 50 ms after the
question has appeared, as a person would type it. Plain `stdin` text is typed
before the program starts, so its echo comes first whatever the program does
afterwards: a port that shows a password the TypeScript hides passes that
way. Use the list form for every question whose echo matters. The list form
holds for a program that turns echo off in its own process. A program that
starts another program for it (`stty -echo`) may still have echo on 50 ms
later, and its answer is then echoed; look at such a case with `--show`.

Run the `--handback` check on the file as it is, without `--tty`. A command
that the binary hands back only on a terminal (dotenvdotenc's `enc`
question) needs a case of its own with `"tty"` and `"handback"`. A case's
`handback` holds for every run of the file, so a whole-file `--tty
--handback` run cannot express such a command.

A command that talks to a service needs both implementations pointed at the
same stand-in: a mock server the project's tests already have, a fake of the
external program it calls, or recorded responses. Compare what each
implementation *asked* the stand-in for, not only what it printed. A project
that has such a harness can keep its own test instead of `parity.mjs`; what
matters is that one test runs both implementations and compares everything
they print and do.

The runner has no stand-in of its own. The patterns the ports needed are all
built from a wrapper command put in front of both implementations (`--ts "sh
rs/parity/run.sh bun cli.ts" --rs "sh rs/parity/run.sh
rs/target/release/mycli"`). The wrapper runs the command with inherited
stdio and exits with the command's code. What it keeps of the run goes into
a file under `<ROOT>` or `$TMPDIR`, and an `after` line prints that file, so
it is compared.

- **The service's address is a constant in the code.** The wrapper starts a
  stand-in on 127.0.0.1, on a free port, for this one run, tells the program
  where it is through the environment, and writes down what the stand-in
  received. qqdocs's `rs/parity/with-mock.mjs` is a worked example. `--ts
  "bun --preload …"` is not enough: the JavaScript the binary hands back to
  is started by the binary, with the runtime its first line names, and never
  sees that flag, so those cases would talk to the real service. Whatever
  points the JavaScript at the stand-in has to come through the environment,
  or through a `bun` shim the wrapper puts first on `PATH`, which covers the
  TypeScript side and the hand-back alike (qqdocs's `rs/parity/bin/bun`
  starts the real bun with the preload). The binary needs to be pointed at
  the stand-in too; a variable that accepts only `http://127.0.0.1:<port>` is
  the smallest way, and it is Rust-only behaviour that the owner has to bless
  or have removed.
- **A case that is handed back after a request** reaches the stand-in twice:
  the binary makes the request once, then the JavaScript starts over and
  makes it again. In those cases compare which requests were made, not how
  many (qqdocs uses `cut -f3- "$TMPDIR/mcp.log" | sort -u`), and let the
  stand-in answer by what was asked, not by turn. Keep the exact log for the
  cases the binary answers.
- **What the program asks another program** (git): the wrapper puts a shim of
  that program first on `PATH`, which logs its arguments and calls the real
  one (dotenvdotenc's `rs/parity/bin/git`); an `after` probe prints the log.
- **The program keeps state in its own install directory** (onenote-cli's
  search index): give each case its own copy of the package. Never point
  `<PROJECT>_PACKAGE_ROOT` at a checkout that can hold a developer's real
  data.
- **A value that must not be in the cases file** (dotenvdotenc refuses to
  commit a file holding a private key): the wrapper computes it.
- **What environment a program got**: print it with a program that adds
  nothing to it. bash adds `SHLVL`, `_` and `PWD`; dash (Ubuntu's `sh`) drops
  a name that is not a shell name (`OWN_aß`); gawk, the awk of GitHub's
  Ubuntu runners, adds `AWKPATH` and `AWKLIBPATH` to its `ENVIRON`, where
  mawk and macOS's awk add nothing. A copy of `/usr/bin/env` is killed on
  macOS. `perl -e 'print map { "$_=$ENV{$_}\n" } keys %ENV'` adds nothing on
  Linux and macOS; rustify's launcher tests passed locally and failed on
  the runners with an awk one.

On Windows a wrapper started with `sh` is a program of the MSYS family. It
reads its command line by rules of its own and gives the program it starts
`TERM=xterm-256color`. The runner writes that command line so that the
case's arguments still arrive as written: it puts in double quotes what MSYS
would glob or expand, and it gives that one program `MSYS2_ARG_CONV_EXCL=*`
and `MSYS_NO_PATHCONV=1`, which stop MSYS from turning POSIX paths into
Windows ones. Everything behind the wrapper inherits those two variables,
git's own `sh` included. Put the same wrapper in front of both sides, so that
both get the same TERM and the same variables. Put `env NAME=value` first,
before the wrapper. The runner does a leading `env` itself, while an `env`
behind a wrapper is MSYS's: it gives only that side a TERM, and it reads the
command line the wrapper wrote for it by MSYS's rules, globbing included.
qqdocs's `--rs "node rs/parity/with-mock.mjs env QQDOCS_PACKAGE_ROOT=… …"`
would do that on Windows; `--rs "env QQDOCS_PACKAGE_ROOT=… node
rs/parity/with-mock.mjs …"` would not. A POSIX path of the wrapper's own
that it hands a Windows program has to be converted with `cygpath -w`.

The runner runs one case at a time. To use more cores, start several runners
at once, each with its own `--filter` (give each group of cases a common name
prefix). You can also run the plain, `--tty stdout,stderr` and `--handback`
checks as separate processes, as onenote-cli's `rs/parity/proof.sh` does.
Each run has its own directory, so the runs do not disturb each other.

Each run works in `<temp>/rustify-parity-XXXXXX`, which holds an `IN-USE`
file naming the process. If that directory or a case's directory disappears
during the run, the runner stops with one line and exit code 3: what it
printed for the last cases is not a result of the port. On a machine other
runs share, give the run a temp directory of its own (`TMPDIR=$(mktemp -d)`),
never clean up with `rm -rf /tmp/rustify-parity-*` (the directories of runs
in progress are among them), and remove a directory kept with `--keep` by
the exact path it prints.

Never run the project's command by hand, outside the runner, unless `HOME`
points at a throwaway directory: on a signed-in machine a harmless-looking
command can read real credentials or start real work.

## 3. Port the command

Read all of the TypeScript the command runs, including the helpers and the
argument parser's configuration. Then write the Rust so the cases pass.

- **Port what is shared first**: global flags, where configuration and
  credentials come from, how output is formatted. Every later command needs
  them.
- **Byte for byte.** Same text, same order, same blank lines, same exit code.
  Do not improve anything on the way. A bug in the TypeScript is copied and
  reported to the owner; fixes are separate changes made to both sides.
- **When in doubt, hand back.** A handed-back command is merely not faster. A
  wrong native command is a bug in a release.

### Dependencies

Few, well-known crates, and nothing that links a library of the system: the
binary is built for six platforms and shipped as one static file. Crypto and
TLS in pure Rust (rustls). Two things need a C compiler all the same: `ring`
underneath rustls, and SQLite when it is compiled in. The pipeline builds
both for every platform it targets. A development machine usually cannot:
`cargo check --target <another platform>` stops in their build scripts. Put
what needs them behind a cargo feature, or compile it only for the platforms
it is ported for, so that the rest of the crate can still be type-checked
for every target, and take the first run of the pipeline as the test.

### Unicode follows the toolchain, not bun

Everything in Rust's std that answers from Unicode data is compiled from the
Unicode version of the rustc that builds the binary (`char::UNICODE_VERSION`).
That covers:

- `to_lowercase` and `to_uppercase`;
- `is_alphabetic`, `is_numeric`, `is_alphanumeric`, `is_lowercase`,
  `is_uppercase` and `is_control`;
- `is_whitespace`, and with it `str::trim` and `split_whitespace`;
- `escape_debug`, behind `{:?}`.

The pipeline builds with the runner's current stable Rust, so a released
binary's answers move whenever stable moves to a new Unicode version. bun
moves on its own schedule, with its own ICU. In November 2026 the versions
were:

- Rust 1.100: Unicode 18;
- Rust 1.97 and 1.99: Unicode 17;
- bun 1.4.x: ICU 78 with Unicode 17 (`process.versions.unicode`).

rustdesk.skill's tests passed locally with 1.97 and failed in CI. Built with
1.100, the binary lowercased 18 code points that bun keeps.

A port that copies JavaScript's text functions (`toLowerCase`,
`toUpperCase`, `trim`, `\s`, `\p{…}`, case-insensitive matching) therefore
does not answer from std's tables:

- A generator run under bun records bun's answers into a table in the crate,
  with `--check` in the proof.
- The binary answers from that table.
- It hands back every code point the table's Unicode leaves unassigned, and
  every one where std's tables disagree with the table.
- A unit test against the bun CI runs stays as the alarm.

rustdesk.skill's `rs/unicode.gen.mjs` and `lowercase_unsure` in
`rs/src/js.rs` are a worked example. Before pushing, also test with the
newest stable:
`rustup toolchain install <version> --no-self-update && cargo +<version> test`.
Changing the default toolchain in place would affect everyone else on the
machine.

ASCII-only work (`to_ascii_lowercase`, `is_ascii_digit`, splitting at `' '`
and `'\t'`) does not depend on any of this.

### bun's own behaviour changes between releases

Measure the bun that CI runs, not only the one at hand. setup-bun takes the
latest bun when a project pins none. Download that release into a temporary
directory on each machine, which works on all three.

winrpc's port measured on one machine with bun 1.4.0 that bun on Linux asks
only `127.0.0.1` for `localhost`. That came from the container: glibc's
`AI_ADDRCONFIG` there ignores `::1`. bun 1.4.1 and later answer
`[::1, 127.0.0.1]` for `localhost` themselves, so CI's bun 1.4.5 reached the
other server. The refusal's wording also changed: `ConnectionRefused` in
1.4.0, `ECONNREFUSED` in 1.4.5 on Linux. When a choice like that differs
between supported bun releases, hand it back. The binary cannot know which
bun the JavaScript would run on.

### Home and app folders on Windows

On Windows, read the home directory and `APPDATA` from the environment, as
node's `os.homedir()` reads `USERPROFILE`. The `dirs` crate asks the system
for its folders instead. That is not what the TypeScript reads, and the
smoke test's home directory (step 6) does not redirect it.

### What to hand back

Rust takes an invocation only when it implements that exact situation. It
hands back, before it has printed or changed anything:

- **Shapes of the command line it does not implement.** Usage errors,
  `--help`, and the argument parser's less common spellings (`-n10`, `--flag
  true`, repeated flags, `--`) belong to yargs or commander; their behaviour
  is hard to reproduce.
- **States of the machine it does not implement.** A configuration file that
  only a JavaScript parser reads the same way, an `.env` file with syntax the
  runtime interprets, proxy and certificate variables that the JavaScript's
  HTTP client honours differently.
- **Failures the JavaScript reports in its runtime's own words** (no
  connection, a response that is not JSON). This hand-back happens at run
  time and is only safe for a command that reads and has not printed yet: the
  JavaScript simply does the work again.

Say in the ledger which situations go back and how common they are. If the
common setup goes back (slack-hub's `settings.yml`, a qqdocs command typed at
a terminal, an onenote-cli search in a time zone where the runtime's data
differs), users get no speed-up yet, and that is worth knowing before
anything is announced.

### Handing back safely

A hand-back starts the whole invocation again in the JavaScript, so it is
correct only while nothing of the first attempt can be seen.

- **Work out the whole answer, then print it.** A ported command returns its
  output, or declines; `main` prints. Nothing reaches stdout or stderr on the
  way.
- **Read everything, then write.** A command that changes files first reads
  all it is going to need (every file, every answer from `git`), so that
  whatever it does not implement shows before the first write. After the
  first write there is no way back: stop with a message that names
  `<PROJECT>_NO_NATIVE=1`, and treat reaching that message as a bug.
- **A panic is a decline.** A bug in the port must not cost users their
  command. While nothing has been printed or changed, a panic hands back,
  silently.
- **A hand-back after a request repeats the request.** The JavaScript does
  all of the work again. For a command that only reads this is safe, and it
  costs: qqdocs sent 62 requests where the TypeScript sends 31, against a
  daily quota, and only half were counted locally. Record the cost in the
  ledger. After a request that creates, changes or deletes, it is never
  acceptable.
- **So a command that writes to a service** can be ported only when every
  failure after the request can be reported natively, in the TypeScript's
  own words. With yargs's default error report it cannot (see "What the
  TypeScript means"); the project first needs an error handler of its own,
  which is a change to the TypeScript for its owner to make.

The hand-back helper carries the guard for the first three, from v5 on. Run
the command through `js_fallback::attempt`, as the commented arm in the
scaffold's `main.rs` shows. The command works out its whole answer before it
prints or changes anything, and returns it. For an invocation or a state of
the machine it does not implement, it returns `Err(js_fallback::HandBack)`,
and the arm falls through to the hand-back. A panic before anything was
printed is handed back too, without a word, so a bug in a ported command
costs the user nothing but speed; with `RUSTIFY_HANDBACK_TRACE=1` the panic
is reported, which is how to find it. A command that has to print or write
while it works calls `js_fallback::commit()` first. After that, a panic ends
it as any panic does (exit code 101), and handing back is a bug. All this
needs unwinding, Rust's default, which the scaffold's Cargo.toml keeps: with
`panic = "abort"`, a panic ends the process with its message and the
JavaScript never runs. qqdocs, onenote-cli and dotenvdotenc each wrote this
guard by hand before it existed.

Print the answer as the TypeScript prints it, also to a reader that has gone
away (`| head`). Measured with bun 1.4.0: what `console.log` and
`console.error` cannot write is dropped and the program goes on and exits
0, so print with `write_all` and ignore its error. `process.stdout.write`
goes on too, to the end of the code that runs at once, and then bun reports
an uncaught `EPIPE: broken pipe, write` with a stack trace and exits 1
(rustdesk.skill's port found this): there, exit 1 when the write fails with
`ErrorKind::BrokenPipe`. The report names bun's internals and the installed
file and is not copied; that difference goes to the owner. `print!` panics
in both cases.

While an attempt runs, the binary keeps panics on every thread quiet, so a
worker thread the command started says nothing either. In the crate's own
tests only the threads that run an attempt are quiet, so a test that fails
beside them keeps its message. Attempts may run on several threads at once
and inside one another. A test that installs a panic hook of its own should
not run beside tests that call `attempt`.

## 4. Switch the command over

Add one arm for it in `main.rs`, guarded by `native()` so that
`<PROJECT>_NO_NATIVE=1` still hands everything back. That variable is the way
out for a user if a ported command misbehaves; keep it until the JavaScript is
gone. Guard everything the binary answers itself the same way, `--version`
included.

## 5. Prove which cases are native

A handed-back invocation passes its case by construction, so a green parity
run does not show that anything was ported. Mark every case that is *meant*
to reach the JavaScript with `"handback": "<why>"`, and run:

```bash
node <rustify>/templates/parity/parity.mjs --cases rs/parity.json \
  --rs rs/target/release/<bin> --handback <PROJECT>_PACKAGE_ROOT=<js entry>
```

It runs only the binary, with a stand-in package whose JavaScript entry does
nothing but say it was reached, and fails unless exactly the marked cases got
there. On genvx this caught four cases that were believed native.

A case that the binary hands back on some systems only is marked for those,
keyed as `skip` is (step 2): `"handback": { "win32": "<why>" }`. On every
other system the binary is meant to answer it. Run the check on every system
the binary answers natively on. On Windows it found 14 genvx cases that the
Rust hands back only there (`setup --dir`, `GENVX_CONFIG_DIR`, lefthook),
none of them marked. Marked so, the check passes on Windows (224 answered by
the binary, 92 handed back), and it still passes on macOS (238 and 78).

For the ordinary parity run, the binary built in the repo has to know where
the package is, so that handed-back cases reach the real JavaScript:

```bash
--rs "env <PROJECT>_PACKAGE_ROOT=$PWD rs/target/release/<bin>"
```

(`$GITHUB_WORKSPACE` in CI. The JavaScript entry named in `main.rs` has to
exist there, so build it first if it is a build product.)

On Windows the runner does this leading `env` itself and passes the value as
written. So write a Windows path there: `$GITHUB_WORKSPACE`, or `$(pwd -W)`
in Git Bash, where `$PWD` is `/c/…`.

## 6. Make CI hold the line

Pass the proof to the pipeline in the project's workflow, in every workflow
that can lead to a release:

```yaml
    with:
      parity: >-
        bun install --frozen-lockfile
        && node "$RUSTIFY_PARITY" --cases rs/parity.json --ts "bun ts/cli.ts"
        --rs "env MYCLI_PACKAGE_ROOT=$GITHUB_WORKSPACE $RUSTIFY_BIN_DIR/mycli"
        && node "$RUSTIFY_PARITY" --cases rs/parity.json
        --rs "$RUSTIFY_BIN_DIR/mycli" --handback MYCLI_PACKAGE_ROOT=dist/cli.js
```

It runs against the freshly built binary, on Linux x64 unless
`parity-platforms` says otherwise (below), and has to pass before anything
can be published. The job installs nothing of the project by itself, hence
the `bun install`. It sets up node 24 and the bun the project pins in
`.bun-version`, or in a `bun <version>` line of `.tool-versions`; without
such a pin, setup-bun chooses by itself (`packageManager`, then `engines.bun`
in `package.json`, otherwise the latest bun). A pin to one exact version
fails the job when that is not the bun that got installed. The smoke test
always takes the latest bun, as users run whatever bun they have. The
workflow's `paths:` must list the TypeScript as well as the Rust, or a change
to the TypeScript alone never reruns the comparison. `rustify vendor` writes
those lines from `projects.toml`: one pattern per script extension for
TypeScript at the root, `Cargo.toml`, `Cargo.lock`, `build.rs` and the `rust`
directories for a crate at the root.

A project whose output changes on a terminal adds a third command to
`parity:`: the comparison again with `--tty stdout,stderr`. python3 is on
GitHub's Linux and macOS runners. An option the runner does not know stops
it with exit code 2, so a misspelt flag fails the job instead of passing on
pipes. A value may also be written after an equals sign
(`--tty=stdout,stderr`).

`parity-platforms` runs the parity command on more platforms than Linux x64.
It is a JSON list of platform keys (`linux-x64`, `linux-arm64`,
`darwin-arm64`, `darwin-x64`, `win32-x64`, `win32-arm64`), for example
`parity-platforms: '["linux-x64", "darwin-arm64", "win32-x64"]'`. Each
platform runs the command on a runner of its own, in bash (Git Bash on
Windows), with that platform's binaries in `$RUSTIFY_BIN_DIR` and its key in
`$RUSTIFY_PLATFORM`. The default is `["linux-x64"]`, whose check keeps the
name it always had, `parity (Rust against TypeScript)`, so a project that
does not ask sees no change.

A binary that answers natively on macOS or Windows should be proven there,
or hand that platform back. Running existing ports' cases on a Mac found
differences that Linux could not show: gchat-cli's binary runs a program file
without a `#!` line through the shell, where bun fails with ENOEXEC, and in
qqdocs a closed connection was taken as success. On Windows, genvx's cases
found one difference that comes from the runtime: bun leaves `./.genvx`
behind (see "What the TypeScript means"). They also showed what cases
written for Linux need first: placeholders instead of `$(pwd)` in paths that
a line hands the program, a `skip` for probes that mean nothing there (step
2), and marks for what goes back only there (step 5). The same `parity:`
command serves every platform, with any `env` put before the wrapper (step
2). On Windows the runner starts `$RUSTIFY_BIN_DIR/mycli` as `mycli.exe`;
the "Windows" section at the top of `templates/parity/parity.mjs` says what
else differs there. A terminal case is BROKEN on Windows, so run the `--tty`
command only where `$RUSTIFY_PLATFORM` does not start with `win32`. Add a
platform to `parity-platforms` once the cases pass on it.

Add a line to `smoke-extra` for the command too, so that every platform runs
it once after installing: `<command> [args] => <text>`, with a leading `[2] `
when it is meant to exit 2, a trailing ` !> <text>` for something it must not
print, and `smoke-env` for variables it needs. A platform that
`parity-platforms` does not name gets only the smoke lines, and a command the
binary hands back passes its line just as well. So mark the line with who has
to answer it: `[native]` fails unless the binary answered itself,
`[handback]` fails unless it handed the command to the JavaScript, and
`[native:linux,darwin] [handback:win32]` says it per system, for a command
that is native on some systems only. For a marked line the smoke test sets
`RUSTIFY_HANDBACK_TRACE`, which makes `js_fallback::run` write `rustify:
handed back to the JavaScript` to stderr; the other lines run without that
variable. Only helper v5 and later can write that line, and the smoke test
looks for its text in the installed binary: with an older helper, or none, a
marked line fails rather than pass on a guess. So when a crate stops handing
anything back and deletes `js_fallback.rs`, take the markers off its smoke
lines in the same change.

The smoke commands run with an empty home directory of their own, one per
installer: HOME and USERPROFILE point there, on Windows HOMEDRIVE, HOMEPATH,
APPDATA and LOCALAPPDATA too, and the XDG_*_HOME variables are removed. So a
line cannot use the credentials of the machine it runs on, and what one line
writes there the next line sees. `smoke-env` wins over it, and a line that
needs the real home starts with `[real-home]`. The working directory is not
changed. Pass the same `smoke-env` to rust-npm-verify, so that the lines run
the same way after publishing.

## 7. Record it

In `parity/<project>.toml` set the feature to `verified`, with `proof`
pointing at the cases file, and move `reconciled` forward. `rustify audit
<project>` shows the new count. It asks for a new reconciliation when a file of the
TypeScript has changed since `reconciled`: a script it counts, or any other
file under a named `ts` directory (a shell script the program runs, a
template it writes out). At the repository root only scripts count, so a
change to `package.json`, a workflow or the README does not ask for one.
Nothing under `ignore`, `keep_ts` or the crate counts. See `parity/README.md` for how to record a
command that is native in its plain use and handed back in some situations,
or native on some operating systems only.

## 8. Have someone else try to break it

The author of a port tests what they thought of. All three ports that were
handed to an independent verifier afterwards passed every proof their author
had written, and all three behaved differently from the TypeScript somewhere:
a time zone table, the word `help`, a number that rounds two ways, a file the
runtime reads from the directories above.

Whoever verifies works on a fresh clone, does not change the port, and:

1. reproduces every proof from the commands the author gives;
2. writes new cases aimed at what the author may have missed (boundary
   values, empty and huge input, unusual but valid orders of flags, non-ASCII
   and CRLF content, files that are missing or unreadable, everything the
   runtime reads before the program starts), and runs them TypeScript against
   TypeScript first, then against the binary, then with `--handback`;
3. compares mechanically wherever the inputs can be generated: the argument
   gate against the project's own yargs chain (about 220,000 command lines
   for qqdocs: the only mismatches had `help` as the last word), the helper
   functions against the JavaScript they replace, every time zone name
   against the runtime;
4. reads every point where the binary hands back: is it before anything was
   printed or changed, and is every native arm behind `<PROJECT>_NO_NATIVE`?
5. reads the ledger against the code: is any status higher than what is
   proven?

Every difference is then repaired in one of two ways: the Rust is made to
behave like the TypeScript, or the situation is handed back. The verifier's
cases go into the committed cases file, the ones now handed back marked so.
A difference that comes from a defect in the TypeScript (output lost on a
slow reader) is not copied silently; it goes to the owner.

## Order of work

Port first what people run most and wait for longest: the commands used in
scripts and prompts, where start time is felt. Leave for last what is rare,
interactive, or tied to a JavaScript-only library (a browser driver, a
vendored SDK). If something cannot reasonably leave JavaScript, say so in the
ledger's `note` and ask the owner; do not mark it `dropped` yourself.

## Ready to publish

A project is ready when:

- its pull requests are green on all six platforms, parity job included;
- its release workflow publishes through the pipeline (see
  [npm-distribution.md](npm-distribution.md)) and passes the same `parity:`,
  rehearsed once with nothing published;
- the owner has decided to switch it on. Publishing is never an agent's call.
