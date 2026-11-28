# Delivering Rust through npm

The usual install is `bun i -g <package>`. The goal is that this one command,
on any machine, gives the user the native Rust binary — started directly, with
no JavaScript runtime in between — without anyone having to know which
platform they are on.

Status: implemented, and proven by this repo's `ci` workflow on a toy binary
on all six platforms, with bun and with npm. slack-hub is the first project
wired to it (snomiao/slack-hub PR #117: build and install test only). No
project has released through it yet; the publish step has never run against
the real npm registry.

## How mature projects do it

Read from the packages published on npm on 2026-11-26.

| Project | Command file in the package | Platform binaries | Install script | A start costs |
|---|---|---|---|---|
| codex 0.172.0 (TS, later Rust) | `bin/codex.js`, a JS launcher | Same package name, suffixed versions (`0.172.0-linux-x64`), pulled in through npm aliases | None | Node start on every run |
| claude-code 2.1.332 | `bin/claude.exe`, a placeholder | 8 separate packages | Required: hard-links the binary over the placeholder | Nothing after install |
| bun 1.4.5, opencode 1.19.6 | `bin/<name>.exe`, a placeholder | 12 separate packages each | Required, same idea | Nothing after install |
| esbuild 0.28.2 | `bin/esbuild`, a JS launcher | 26 separate packages | Optional: replaces the launcher with the binary on Unix | Nothing if the script ran, Node start otherwise |
| biome 2.6.9 | `bin/biome`, a JS launcher | 10 separate packages | None | Node start on every run |

What this shows:

1. Everyone ships one package per platform as an `optionalDependencies` entry
   with `os` and `cpu` set, so the package manager picks the right one.
2. Native start speed needs the command file to *be* the binary. Every project
   that gets there does it in an install script.
3. bun does not run a dependency's install script on a global install. Checked
   here with bun 1.4.0: the script was silently skipped, while npm ran it.
   So under `bun i -g`, the claude-code/bun/opencode layout leaves a
   placeholder that only prints an error, and esbuild's stays on the slow path.
   (bun has a built-in exception list for exactly two packages, esbuild and
   claude-code.)
4. codex's launcher uses `#!/usr/bin/env node`. On a machine with bun but no
   node that fails (`env: 'node': No such file or directory`, checked here).
5. codex publishes every platform build under its one package name. That needs
   one npm trusted-publisher setup instead of one per platform package — the
   pain otoji's `bootstrap-npm-packages.sh` exists to work around.

## What rustify does

Packaging follows codex; the speed comes from a step none of them have.

- **One package name.** `slack-hub@1.2.3` holds only launchers. Each platform
  build is `slack-hub@1.2.3-linux-x64` and so on, referenced as
  `"slack-hub-linux-x64": "npm:slack-hub@1.2.3-linux-x64"`.
- **No install script.** Nothing for bun to skip.
- **Launchers live in the package's `rustify/` directory**, one per command,
  so they cannot collide with a `bin/` the project already ships.
- **The launcher runs once, then gets out of the way.**
  - Linux, macOS: the first run hard-links the native binary over the launcher
    (and over every other command of the package). From the second run on, the
    command *is* the binary.
  - Windows: package managers write a command shim at install time that is
    bound to the launcher, so the launcher file cannot be swapped. The first
    run instead puts a native copy beside the launcher and repoints the shim
    at it: bun's `<command>.bunx`, or npm's `.cmd`/`.ps1`/sh trio. From the
    second run on the chain is shim → binary, the same chain every native tool
    installed by that package manager has.
- **Launchers use bun** (`#!/usr/bin/env bun`), like these projects' current
  entry points; `rustify.runtime` can switch a project to node. The launcher
  code itself runs on either.
- **Static Linux binaries** (musl), one per CPU, so glibc and musl
  distributions share a build.
- **Six platforms**, listed once in `templates/npm/platforms.json`: Linux,
  macOS and Windows, each on x64 and arm64.

### Why the Windows shim can be rewritten safely

From bun's source (`src/install/bin.rs`, `src/install/windows-shim/`, 1.4.5):
each command is `<command>.exe`, one small native shim shared by every
command, plus `<command>.bunx`, which names the target and whether to start
bun or node first. bun rewrites the `.bunx` on every install; it skips the
`.exe` when that file is in use.

- Rewriting the `.bunx` therefore cannot leave stale state: the next install
  or upgrade puts bun's own version back, and the launcher runs once more.
- Replacing the `.exe` with the binary is *not* safe and is not done: an
  upgrade while the tool is running would leave the old binary there for good.

The launcher only rewrites a `.bunx` whose format version it knows and whose
target is this very launcher; anything else is left alone and the command
keeps working through the launcher. The `.bunx` layout is bun-internal, so the
Windows smoke test in CI is what notices if bun changes it.

### The launcher's environment

The launcher's bun has loaded the working directory's `.env` files (`.env`,
`.env.local`, `.env.<NODE_ENV>`, `.env.<NODE_ENV>.local`, and an
`--env-file` in `BUN_OPTIONS`) into `process.env` before the launcher runs.
Launcher v2 handed `process.env` to the binary, so on a first run, and on
every run that cannot relink (`RUSTIFY_NO_LINK=1`, Yarn PnP, a package
directory the user cannot write), the binary and the JavaScript it hands
back to saw `.env` values as variables of the user's. wtx's terminal
sessions got `.env` secrets that way, and a `NODE_ENV=production` in `.env`
made the next bun read `.env.production`.

bun puts those values into `process.env` only. The environment the system
keeps for the process stays as the shell gave it, and launcher v3 reads that
one under bun: `/proc/self/environ` on Linux, `_NSGetEnviron()` through
bun:ffi on macOS, `GetEnvironmentStringsW()` through bun:ffi on Windows.
What it reads is what the binary gets, with `rootEnv` set in it: also an
empty environment (`env -i`; the binary gets `rootEnv` alone), and one that
holds names `process.env` lacks, such as a variable a preload deleted. On
Windows bun 1.4.2 leaves some names with a letter outside ASCII out of
`process.env` (`aß`, `éa`, `aÿ`, not `ß` or `éé`), though the block has
them, so v2 lost them and v3 passes them on. Only where the environment
cannot be read does `process.env` take its place, as in v2, without a word
(see "Where it cannot be read" below). Under node it is
`process.env`: node loads no `.env` file here, and it refuses `--env-file`
and `--env-file-if-exists` in `NODE_OPTIONS` ("is not allowed in
NODE_OPTIONS", exit 9; node 20.19 and 24.8).

The first cut of v3 compared what it read with `process.env`, and used
`process.env` where a name was missing from it or nothing was read. On
Linux and macOS that happened exactly after a preload deleted a variable,
and for an empty environment. On Windows the comparison turned down no read
in any case measured, and an empty block could not be read at all
(bun:ffi's `toBuffer` refuses a length of 0). Both are fixed.

**What a preload did before the launcher.** A `preload` of the working
directory's `bunfig.toml`, or a `--preload` in `BUN_OPTIONS`, runs in the
launcher's bun before the launcher (see the end of this section).

- Linux and macOS: bun writes nothing of what JavaScript does to
  `process.env` into `/proc/self/environ` or the C `environ`: not an
  assignment, not a `delete`, not the `.env` files, not `BUN_OPTIONS`'s
  `--env-file`, not `process.loadEnvFile()`, not `Object.assign`, not `TZ`;
  a long `process.title` leaves them alone too (bun 1.3.14, 1.4.0 and 1.4.5
  on Linux x64, 1.4.4 on macOS arm64; in a preload and in the main script).
  So the binary gets the environment as the command was started: what a
  preload deleted is passed on, and what it set is not. `tests/e2e/run.sh`
  and the unit tests check this byte for byte, for a `bunfig.toml` preload
  and a `BUN_OPTIONS` one that delete a variable of the user's and set
  others, and for `env -i`.
- Windows: bun writes every assignment that changes `process.env` (a new
  name or a new value) into the process's environment block at once, and
  every `delete` (bun 1.4.2): a preload's, the main script's, `Bun.env`'s,
  `TZ`, and `process.loadEnvFile()`'s for names and values the `.env` files
  did not already give. An assignment of the value a name already has
  writes nothing, so `process.loadEnvFile('.env')` adds nothing there. It writes the name as
  `toUpperCase()` makes it: `lc_x` becomes `LC_X`, `lc_été` `LC_ÉTÉ`, and
  `straße_x` becomes `STRASSE_X`, which Windows takes for another variable;
  a variable already there keeps its spelling (`Shared_Mixed`). The `.env`
  files and `--env-file` are not written. Nothing keeps the block as the
  process was started with it: the PEB's `ProcessParameters` point at the
  same block, changed alike, and Windows documents no other. So on Windows
  what a preload set in `process.env` reaches the binary, and what it
  deleted does not; the unit tests assert this, so that a bun that changes
  it is noticed.
- On Windows, the JavaScript the binary hands back to then starts with such
  a variable under the name in capitals: its `process.env` says `LC_X`
  where the JavaScript run directly says `lc_x` (one variable to Windows,
  and to a child it starts). A `NODE_ENV` a preload set is in the
  environment the hand-back's bun starts with, so that bun reads
  `.env.<NODE_ENV>`; the JavaScript run directly loads its `.env` files
  before its preload runs, and reads `.env.development`. A preload setting
  `NODE_ENV=production`, with a `.env` that does not, so brings the values
  of `.env.production` to the hand-back. The launcher cannot tell such a
  variable from one of the user's.

**Where it cannot be read**, the binary gets bun's `process.env`, `.env`
files included, as from v2. On the platforms the pipeline ships:

- Linux x64 and arm64 (the musl builds run on glibc systems too; the read is
  the kernel's, with no bun:ffi, the same in every bun): when
  `/proc/self/environ` cannot be opened. That is a system without `/proc`
  (a chroot or a sandbox without it; not measured), or a process the kernel
  has made non-dumpable and that does not run as root, which gets `EACCES`:
  bun installed so that the user may run it but not read it (mode 711),
  bun given file capabilities or set-user-ID, or a preload that calls
  `prctl(PR_SET_DUMPABLE, 0)` (the first and the last measured with bun
  1.4.5).
- macOS x64 and arm64: when bun:ffi's `dlopen` throws. bun 1.3 and 1.4
  build TinyCC, which it needs, for both (read in their build files); it
  worked on arm64 with 1.4.4.
- Windows x64: when bun:ffi's `dlopen` throws, or `GetEnvironmentStringsW`
  returns nothing (it fails only for want of memory). It worked with 1.4.2.
- Windows arm64: on every run with bun 1.3, which builds no TinyCC there;
  bun 1.4 builds it (read in bun's sources; no Windows arm64 machine was at
  hand).
- Anywhere, when something that ran before the launcher replaced
  `fs.readFileSync` or bun:ffi (the unit test does this to stand for the
  cases above).

The launcher could tell the binary that it got `process.env`, with a
variable it sets only then. It does not: the binary passes its environment
to every program it starts, not only to the JavaScript, so such a variable
would reach them unless every port's `main` took it out before starting
anything (Rust runs nothing of `js_fallback.rs` before `main` that could),
and all a binary could do with it is warn, in the few cases above.

Measured with bun 1.4.0 (Linux x64), 1.4.4 (macOS arm64) and 1.4.2
(Windows 11 x64):

- What the binary gets on a first run, installed with bun or npm and started
  in a directory with `.env` files, compared with what the shell gave the
  command (`toy env`; `tests/e2e/run.sh` checks it): on Linux and macOS the
  same entries in the same order, byte for byte, and `rootEnv` after them;
  v2 added `FROM_DOTENV`, `FROM_LOCAL`, `FROM_DEVELOPMENT` and `NODE_ENV`
  from the files there. On Windows, from cmd.exe, the same entries byte for
  byte, the hidden `=C:=C:\…` entries (the working directory of each drive)
  included, which v2 dropped. bun and node sort the block they hand a child
  (case-insensitively, as CreateProcess wants it), and the hidden entries can
  come in another order among themselves (`=ExitCode` before `=C:` where
  cmd.exe had them the other way round); the other entries keep cmd.exe's
  order. (cmd.exe adds `=ExitCode` once a program it started has ended, so
  a comparison starts one program first.)
- Names that are array indices (`1`, `42`) come first, in numeric order, as
  they always did in `process.env`.
- Two entries with one name (on Windows in other letters): the first is
  kept, which is the one getenv() and GetEnvironmentVariableW() find. bun's
  `process.env` holds the last one (on Windows under the first one's name),
  and v2 passed that on. Windows compares names one UTF-16 unit at a time,
  a unit in capitals only where its capital is one unit whose small letter
  it is: `été` and `ÉTÉ` are one variable, `straße` and `STRASSE` are two,
  and so are `ı` and `I`, `ſ` and `S`, `ς` and `Σ` (Windows 11, measured),
  which `toUpperCase()` makes one. The launcher compares them so, except
  letters that Unicode gave capitals after Windows' table was made
  (Georgian `ა` and `Ა`), which it takes for one name and Windows for two.
- A name that is not UTF-8 (on Windows, one with a lone surrogate) is left
  out; v2 left it out on Linux and passed it with U+FFFD on Windows. A value
  that is not UTF-8 arrives with U+FFFD for the bad bytes, as in v2: bun
  turns the text it is given into UTF-8 (UTF-16 on Windows), so no launcher
  can pass such bytes on. An entry without `=` (Linux and macOS only; Windows
  refuses to start a process with one) is left out; v2 passed it as `NAME=`.
  So is a variable named `__proto__`, which a plain object does not hold as
  a key, as in v2, and a `NODE_CHANNEL_FD` set outside a fork, which bun
  takes out of `process.env` (see below).
- The launcher's own switches come from `process.env`, `.env` files
  included: a `.env` with `RUSTIFY_NO_LINK=1` keeps the command from linking
  (it stays a launcher, about 30 ms per run), and on Windows a
  `BUN_INSTALL_BIN` there changes where it looks for bun's shims. Neither
  reaches the binary's environment.
- Anything thrown while the read is turned into an environment falls back
  to `process.env`; a `process.env` that throws when asked (a preload that
  puts its own object there) does not, and the IPC variables then go.
- An empty value and a `=` inside a value pass unchanged; bun keeps an empty
  variable of the user's even when `.env` names it.
- An empty environment, in a directory with `.env` files: the binary gets
  `rootEnv` alone, on Linux and macOS from `env -i` (with bun named by its
  path), on Windows from a block that CreateProcess was given empty (Rust's
  `env_clear`), where the first cut of v3 passed the `.env` files on. node
  does not start at all from an empty block (its random-number setup
  asserts without `SystemRoot`; node 24.8); bun does.
- A bun started by `child_process.fork` takes its IPC channel's variables
  (`NODE_CHANNEL_FD`, `NODE_CHANNEL_SERIALIZATION_MODE`) out of
  `process.env`; they are left out of the binary's environment too, as in v2.
  bun takes nothing else out (Linux, bun 1.4.0, with `BUN_OPTIONS`,
  `NODE_OPTIONS`, `NODE_DEBUG`, `NODE_ENV`, `NO_COLOR`, `FORCE_COLOR`,
  `BUN_INSTALL` and others set).
- A large environment passes unchanged: 200 variables of 1000 characters
  and one of 30000 on all three (the unit test does this); 1.5 MB on Linux
  (1500 variables of 1000 characters, or 15 of 100,000), 450 KB on macOS,
  whose limit for arguments and environment together is 1 MiB, and 1.9 MB
  on Windows (60 variables of 32,000 characters).
- Reading it costs about a millisecond in the launcher (the first call in
  a fresh bun, bun:ffi's compile of the two functions included, median of
  30: 1.3 ms on Linux, 0.75 ms on macOS, 1.2 ms on Windows). A whole run
  through the launcher with `RUSTIFY_NO_LINK=1`, which is a first run
  without the linking, v2 against v3 taking turns, median of 30: 29.6 and
  31.5 ms on Linux (load average 6), 87 and 90 ms on macOS (load average
  9; another round gave 94 and 88), 37.4 and 38.9 ms on Windows. Only that
  one run pays it.
- bun's builds without `process.execve` (every one before 1.4.0) start the
  binary as a child, with the same environment. Linux needs no bun:ffi.
  bun:ffi's `dlopen` needs TinyCC, which bun 1.3 and 1.4 build for macOS
  (x64, arm64) and Windows x64, as their build files say. bun 1.3 does not
  build it for Windows arm64, where `dlopen` throws and the launcher falls
  back to `process.env`; bun 1.4 builds it everywhere but Android and
  FreeBSD. (Read in bun's sources; no Windows arm64 machine was at hand.)

What v3 cannot undo: a preload has already run in the launcher. A
`preload` in the working directory's `bunfig.toml` runs there, and a
`--preload` in `BUN_OPTIONS` does too unless that `bunfig.toml` has a
preload of its own (then bun 1.4.0 and 1.4.4 skip the `BUN_OPTIONS` one for
the launcher, which has no file extension). The JavaScript the binary hands
back to runs them again, so on a first run, or a run that cannot relink, a
preload's output and side effects happen twice. What a preload sets or
deletes in `process.env` does not reach the binary on Linux and macOS; on
Windows it does (see "What a preload did before the launcher" above).
`BUN_OPTIONS` itself is the user's variable and is passed on.

### Measured

From one run of this repo's CI on GitHub-hosted runners, a trivial binary, best
of 7 starts. Shared runners are noisy: a second run gave the same picture with
numbers a few milliseconds apart. "Later runs" is the installed command; the last column is the same
binary started by its full path.

| Platform | Installed with | First run (launcher) | Later runs | Binary run directly |
|---|---|---|---|---|
| linux-x64 | bun | 14 ms | 1.1 ms | 1.1 ms |
| linux-x64 | npm | 12 ms | 1.2 ms | 1.1 ms |
| linux-arm64 | bun | 12 ms | 1.5 ms | 1.5 ms |
| linux-arm64 | npm | 12 ms | 1.4 ms | 1.5 ms |
| darwin-arm64 | bun | 63 ms | 3.2 ms | 3.7 ms |
| darwin-arm64 | npm | 42 ms | 3.2 ms | 5.4 ms |
| darwin-x64 | bun | 75 ms | 5.7 ms | 5.5 ms |
| darwin-x64 | npm | 40 ms | 5.2 ms | 5.2 ms |
| win32-x64 | bun | 71 ms | 17.5 ms | 11.7 ms |
| win32-x64 | npm | 51 ms | 15.6 ms | 11.5 ms |
| win32-arm64 | bun | 131 ms | 46.8 ms | 28.8 ms |
| win32-arm64 | npm | 103 ms | 36.9 ms | 28.2 ms |

On Linux and macOS the installed command costs the same as the binary. On
Windows the difference that remains is the package manager's own shim: 6 to
9 ms with bun and 4 to 6 ms with npm on x64 across the two runs. (Windows timings include a `cmd.exe`
wrapper in both columns, so the absolute numbers are higher than a bare
process start.)

For comparison, on the development machine a launcher that stays in the path
costs 23 ms per start with bun and 145 ms with node 20.

### While a project still has TypeScript

A command can only become native once the Rust binary can answer every
invocation of it. Two ways to get there before the port is complete:

- **`hybrid` mode**: the package keeps shipping its JavaScript. Commands listed
  in `rustify.bins` become native; the others stay as they are.
- **Hand-back**: the Rust binary runs the commands it has ported and passes
  the rest to the package's JavaScript entry point
  (`templates/rust/js_fallback.rs`). Ported commands start at native speed
  from the first release; the rest behave exactly as before.

- **Binaries only**: the commands stay JavaScript and the package merely
  carries native binaries the JavaScript starts (`"bins": {}` with the
  binaries listed in `"extra"`). They arrive in the platform packages instead
  of all being bundled into one package or downloaded on first run, and the
  JavaScript finds its binary with `templates/npm/native-binary.mjs`. For a
  package that already has a native core behind a JavaScript command.
  An extra that only some platforms have (a Windows-only helper) is named in
  `"extraPlatforms"`; it is then required there and not expected elsewhere.

The hand-back starts the JavaScript as it was started before the binary
existed. On Linux and macOS an entry with a `#!` line (`#!/usr/bin/env
node`, `bun`, `npx tsx`) is started as the system starts it, and a missing
runtime is reported by env, exit 127. On Windows it is started as the
package managers' shims start it: with the runtime the line names and no
other, except bun where the line names node and node is missing, as bun's
shim does; so an entry whose line names bun never goes to node. Nothing to
start is said in the binary's words, with exit code 1, as npm's shim exits
from a command prompt (bun's exits 255). An entry without a `#!` line goes
to bun, then to node unless it is TypeScript. See
[porting.md](porting.md), step 1.

Only hand a command to Rust when its ledger entry is `ported` or `verified`.
A `partial` Rust command behaves differently from what users have today.

### Release pipeline

Projects do not copy any of this. They call it from their own workflow. The
jobs then run in the project's repository, as part of the project's own
workflow run: that is where the binaries are built, where the artifacts live
and where publishing happens. rustify only supplies the definition.

```yaml
jobs:
  build:
    uses: snomiao/rustify/.github/workflows/rust-npm-build.yml@releases/v1
    with:
      manifest: rs/Cargo.toml
      bins: mycli
      smoke: mycli --version
  publish:
    needs: build
    if: inputs.publish == true
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    steps:
      - uses: snomiao/rustify/actions/publish@releases/v1
```

1. **build** (`rust-npm-build.yml`) — six binaries; Linux and macOS are
   cross-compiled on Linux runners with cargo-zigbuild, Windows builds on
   Windows runners.
2. **pack** — `templates/npm/pack.mjs` turns them into npm packages. A
   hybrid package without a `files` list ships its whole directory, except
   what the pipeline put there and the crate's directory (the workflow passes
   its `manifest` input to the packer as `--manifest`). When the crate is the
   package's own directory, nothing is left out; a package with a `files`
   list ships what it lists. If `bin` names a file inside the crate's
   directory, packing stops.
3. **smoke** — on real Linux, macOS and Windows runners, x64 and arm64: install
   the packed release from a throwaway local registry with bun and with npm,
   run it, check that the command became native, install the same version
   again, and time it. `smoke-extra` adds more commands to run: the ones that
   are still JavaScript or handed back to it, and ported ones, to see on
   every platform who answers them. The registry answers ordinary
   dependencies from the real one. The commands run with an empty home
   directory of their own, not the runner's, and a line can demand that the
   binary answered it itself (`[native]`) or handed it back (`[handback]`);
   see [porting.md](porting.md), step 6.
4. **publish** (`actions/publish`) — a job in the project's own workflow, so
   the npm credential is requested by the project. Platform builds first, the
   main package last. npm checks the *calling* workflow's filename when a
   release goes through a reusable workflow.
5. **verify** (`rust-npm-verify.yml`) — the smoke test again, against the real
   registry.

A pull request runs steps 1–3 only. Beside them, a project's `parity:`
command runs against the freshly built binaries, on Linux x64 or on each
platform that `parity-platforms` names, and has to pass before anything can
be published; see [porting.md](porting.md), step 6.

A project whose build needs its own runners or steps (large C++ dependencies,
system libraries) keeps its build: its own jobs upload one artifact per
platform, named `native-<platform key>`, and it calls the workflow with
`prebuilt: true`, which then only packs, tests and smoke-tests. Stamping the
release version into the binaries is then that build's job; the workflow
stamps `package.json` only. A project that
cannot build every platform lists the ones it ships in `rustify.platforms`;
the launcher tells users of the others that there is no build for them.

`releases/v1` is a branch that only ever fast-forwards, to a commit of `main`
whose CI was green. The workflows check out the packer and the smoke test at
the very commit they were loaded from, so a project never mixes versions.

## What is and is not verified

Verified by this repo's CI, on GitHub-hosted runners for all six platforms,
with bun and with npm:

- cross-compiling for musl Linux and macOS with cargo-zigbuild, and for
  Windows x64 and arm64 on a Windows runner; each machine then ran the build
  for its own CPU
- pack → publish to a local registry → `bun i -g` and `npm i -g`
- first run works through the launcher; afterwards the command is native
  (hard link on Linux and macOS, repointed shim on Windows, with bun's real
  shim and npm's real shims)
- installing the same version again leaves a working command
- a second command name for the same binary works
- `hybrid` mode: a command that is still JavaScript keeps working, and a
  command the binary hands back to JavaScript works
- the smoke commands see a home directory of their own (HOME and
  USERPROFILE, on Windows also APPDATA and LOCALAPPDATA), and so does the
  JavaScript they hand back to (on Windows x64 and arm64, bun's
  `os.homedir()` follows USERPROFILE)
- the hand-back helper's trace line comes through every package manager's
  shim, so `[native]` and `[handback]` lines hold on every platform, and the
  JavaScript starts without the trace variable
- a ported command that panics before printing, also in a worker thread, is
  handed back without a word
- a package without a `files` list ships without its crate (ci-extras)

The hand-back helper's own unit tests (`attempt` and the panic hook) also run
on macOS and Windows, in ci.yml's `unit` job. The parity job runs on all six
platforms as well (`parity-platforms`), each with its own binaries and the
parity runner, in bash (Git Bash on Windows). ci.yml's `bun-pin` job runs the
parity job's choice of bun on Linux x64, with a `.bun-version`, with a
`.tool-versions` and with no pin.

Verified additionally on Linux x64 by `tests/e2e/run.sh`:

- only the machine's own platform build is installed
- exit codes pass through
- an upgrade runs the new binary, not a stale link
- publishing the same release twice is harmless
- the hand-back also works while the launcher is still in the path
- a ported command run through `js_fallback::attempt` that declines, or
  panics before printing (also in a worker thread it started), is handed back
  without a word; a panic after `commit()` ends it with exit code 101; built
  with `panic = "abort"`, a panic ends it and nothing is handed back
- with `RUSTIFY_HANDBACK_TRACE` set, a hand-back shows on stderr and the
  JavaScript starts without the variable; the smoke test refuses a
  `[native]` line that was handed back, a `[handback]` line that was not,
  and either one for a binary without helper v5; a trace variable set where
  the smoke test runs does not reach its unmarked lines
- a package without a `files` list ships without its crate, installs, and
  hands back
- a bun or node behind a version manager's shim that needs the real home
  directory still starts under the smoke test's home directory
- on a first run the binary gets the shell's environment byte for byte and
  `rootEnv`: in a directory with `.env` files, after a `bunfig.toml` or
  `BUN_OPTIONS` preload that deletes a variable of the user's and sets
  others, and from `env -i` (also run on macOS)

Two bugs the six-platform run caught that Linux alone could not:

- macOS reports the path a command was started through, which for a global
  install is a symlink, so the hand-back could not find its package. Fixed in
  `templates/rust/js_fallback.rs`.
- slack-hub's Rust had never compiled for Windows (a Unix-only `libc` call).
  Fixed in its PR.

Verified on real machines (not CI runners) with `tests/e2e/upgrade.mjs`, on
Windows 11 x64 with bun 1.4.2 and npm, on a Mac (arm64) that has bun and no
npm, and on Linux x64 — upgrading while a command of the package is running:

- the package manager's upgrade succeeds
- the running command keeps running the old version
- the command starts the new version right away, and is native again after
  its first run

On the same Windows machine, a console control event sent to a command that
had been handed back to JavaScript: the binary stayed until the JavaScript
had finished its own shutdown (0.8 s in the test) and then exited with the
JavaScript's exit code. The event was Ctrl+Break, which takes the same handler
as Ctrl+C; Ctrl+C itself cannot be delivered to a hidden console from a remote
session.

The Mac also ran `tests/e2e/run.sh` in full. A machine with bun and no npm is
supported throughout: the launcher's shebang is bun, and the packer falls back
to `bun publish` and `bun pm pack`.

The upgrade test covers both places a running binary can sit: hard-linked into
the main package (a command that is the binary) and in the platform package
only (a JavaScript command that starts it).

Not verified:

- `npm publish` against the real registry with a suffixed version, a dist-tag
  and trusted publishing (codex does this in production; rustify has only
  published to the local test registry)
- pnpm and yarn global installs on Windows (they keep the launcher)

## Known limits

- The first run after every install or upgrade goes through the launcher once.
  A `preload` of the working directory's `bunfig.toml`, or one in
  `BUN_OPTIONS`, runs in it. On Windows what such a preload sets in
  `process.env` reaches the binary, in capitals, and what it deletes does
  not; a `NODE_ENV` it sets makes the hand-back's bun read
  `.env.<NODE_ENV>`. On Linux and macOS the binary gets the shell's
  environment all the same (see "The launcher's environment").
- Where the launcher cannot read the environment it was started with (no
  `/proc`, a bun that may not read its own, bun 1.3 on Windows arm64), the
  binary gets bun's `process.env`, the `.env` files included, as with
  launcher v2, and nothing says so.
- Windows keeps the package manager's shim in the path (a few milliseconds).
- If the package directory is read-only, the launcher cannot link and stays in
  use on every run. Nothing breaks.
- `RUSTIFY_NO_LINK=1` turns all rewiring off.
- `npm view <package> versions` lists seven entries per release.
- The smoke test's home directory cannot hide the system keychain, agents
  the environment points at (SSH_AUTH_SOCK), variables that name credential
  files elsewhere (GOOGLE_APPLICATION_CREDENTIALS, KUBECONFIG, GNUPGHOME, …),
  or the folders a Windows program asks the system for; the working
  directory stays the caller's.
