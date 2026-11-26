# Delivering Rust through npm

The usual install is `bun i -g <package>`. The goal is that this one command,
on any machine, gives the user the native Rust binary — started directly, with
no JavaScript runtime in between — without anyone having to know which
platform they are on.

Status: implemented in `templates/` and rehearsed end to end on Linux x64
(`tests/e2e/run.sh`). The GitHub workflow has not run yet, and nothing has been
tried on macOS or Windows. No project uses it yet.

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
4. codex's launcher uses `#!/usr/bin/env node`. On a machine with bun but no
   node that fails (`env: 'node': No such file or directory`, checked here).
5. codex publishes every platform build under its one package name. That needs
   one npm trusted-publisher setup instead of one per platform package — the
   pain otoji's `bootstrap-npm-packages.sh` exists to work around.

## What rustify does

Packaging follows codex; the speed comes from a step codex does not have.

- **One package name.** `slack-hub@1.2.3` holds only launchers. Each platform
  build is `slack-hub@1.2.3-linux-x64` and so on, referenced as
  `"slack-hub-linux-x64": "npm:slack-hub@1.2.3-linux-x64"`.
- **No install script.** Nothing for bun to skip.
- **The launcher replaces itself.** On Linux and macOS, the first run hard-links
  the native binary over the launcher (and over every other command of the
  package). From the second run on, the command *is* the binary.
- **Windows keeps the launcher.** Windows package managers write a command shim
  at install time that is bound to the launcher, so it cannot be swapped
  afterwards. The launcher starts a native copy kept beside it. Every start
  there still pays for a bun or node start.
- **Launchers use bun** (`#!/usr/bin/env bun`), like these projects' current
  entry points; `rustify.runtime` can switch a project to node. The launcher
  code itself runs on either.
- **Static Linux binaries** (musl), one per CPU, so glibc and musl
  distributions share a build.
- **Six platforms**, listed once in `templates/npm/platforms.json`: Linux,
  macOS and Windows, each on x64 and arm64.

Measured on this machine (Linux x64, a trivial binary, average of 30 starts):

| How the command starts | Time |
|---|---|
| The binary run directly | 1.5 ms |
| Installed with `bun i -g`, after its first run | 1.4 ms |
| Through a bun launcher on every run | 23 ms |
| Through a node 20 launcher on every run | 145 ms |

### While a project still has TypeScript

A command can only become native once the Rust binary can answer every
invocation of it. Two ways to get there before the port is complete:

- **`hybrid` mode**: the package keeps shipping its JavaScript. Commands listed
  in `rustify.bins` become native; the others stay as they are.
- **Hand-back**: the Rust binary runs the commands it has ported and passes
  the rest to the package's JavaScript entry point
  (`templates/rust/js_fallback.rs`). Ported commands start at native speed
  from the first release; the rest behave exactly as before.

### Release pipeline

`templates/github/rust-npm-release.yml`, vendored into each project:

1. **build** — six binaries; Linux and macOS are cross-compiled on Linux
   runners with cargo-zigbuild, Windows builds on Windows runners.
2. **pack** — `scripts/rustify/pack.mjs` turns them into npm packages.
3. **smoke** — on real Linux, macOS and Windows runners, x64 and arm64: install
   the packed release from a throwaway local registry with bun and with npm,
   run it, and check that the command became the native binary.
4. **publish** — only when asked (`publish` input) and only if smoke passed.
   Platform builds first, the main package last. Uses npm trusted publishing.
5. **verify** — the smoke test again, against the real registry.
6. **crate** — optional `cargo publish`.

A pull request runs steps 1–3 only.

## What is and is not verified

Verified here, on Linux x64, by `tests/e2e/run.sh`:

- pack → publish to a local registry → `bun i -g` and `npm i -g`
- only the host's platform build is installed
- first run works through the launcher; afterwards the command is the binary
- a second command name for the same binary keeps its own name
- exit codes pass through
- an upgrade runs the new binary, not a stale link
- publishing the same release twice is harmless
- `hybrid` mode, and the hand-back to JavaScript in both launcher and linked
  state

Not verified:

- the GitHub workflow as a whole (never run)
- anything on macOS or Windows, including the Windows launcher path
- cross-compiling real projects with cargo-zigbuild for the musl targets
  (agent-yes and otoji already use it for macOS)
- `npm publish` with a suffixed version and a dist-tag against the real
  registry (codex does this in production; rustify has only done it against
  the local test registry)
- which workflow filename npm's trusted publishing expects when the release
  workflow is called from another workflow

## Known limits

- Windows does not get native start speed.
- If the package directory is read-only, the launcher cannot link and stays in
  use on every run. Nothing breaks.
- `RUSTIFY_NO_LINK=1` turns the self-replacement off.
- `npm view <package> versions` lists seven entries per release.
