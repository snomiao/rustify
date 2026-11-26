# Porting a project, command by command

How a TypeScript CLI becomes a Rust one here without ever shipping a
behaviour change. Read [purpose.md](purpose.md) first.

Two projects have been through it: genvx (every command, 316 cases) and
slack-hub's `search` (164 cases). What they ran into is written into the
steps below.

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
source file read in isolation. That includes what the runtime does before the
first line of the program:

- bun loads `.env`, `.env.local`, `.env.development` and
  `.env.development.local` from the current directory into the environment,
  with its own syntax (`$VAR` expansion, `export`, quoting), and honours
  `bunfig.toml`, `BUN_OPTIONS` and `NODE_OPTIONS`;
- on a terminal, `console.error` may colour its output;
- a bundled entry can differ from the source it was built from.

Find out which of these the project's users can observe before deciding what
a case has to cover. For genvx this was the largest part of the work.

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
template moves on, copy the new file over the crate's.

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

Cover, for the command:

- its plain use, and each flag that changes what it does;
- the ways it fails: missing argument, bad value, missing file, a server
  error. The exit code and the text on stderr are part of the behaviour;
- what it leaves behind (`after`: files, git state, config);
- input on stdin, if it reads any;
- where its settings come from: every file, variable and flag, and which one
  wins.

The runner starts each case in an empty directory with an empty `HOME` and
without a terminal; `<CWD>` and `<HOME>` in a case stand for those
directories. A command that talks to a service needs both implementations
pointed at the same stand-in: a mock server the project's tests already have,
a fake of the external program it calls, or recorded responses. Compare what
each implementation *asked* the stand-in for, not only what it printed. A
project that has such a harness can keep its own test instead of
`parity.mjs`; what matters is that one test runs both implementations and
compares everything they print and do.

What the runner cannot express needs its own small test beside it: a terminal
(prompts, colours), one implementation reading what the other wrote, a chosen
working directory.

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
common setup goes back (slack-hub's `settings.yml`), users get no speed-up
yet, and that is worth knowing before anything is announced.

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

For the ordinary parity run, the binary built in the repo has to know where
the package is, so that handed-back cases reach the real JavaScript:

```bash
--rs "env <PROJECT>_PACKAGE_ROOT=$PWD rs/target/release/<bin>"
```

(`$GITHUB_WORKSPACE` in CI. The JavaScript entry named in `main.rs` has to
exist there, so build it first if it is a build product.)

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

It runs on Linux against the freshly built binary and has to pass before
anything can be published. The job installs nothing by itself, hence the
`bun install`. The workflow's `paths:` must list the TypeScript as well as the
Rust, or a change to the TypeScript alone never reruns the comparison.

Add a line to `smoke-extra` for the command too, so that every platform runs
it once after installing: `<command> [args] => <text>`, with a leading `[2] `
when it is meant to exit 2, a trailing ` !> <text>` for something it must not
print, and `smoke-env` for variables it needs. The parity job runs on Linux
only; the smoke lines are all that Windows and macOS get.

## 7. Record it

In `parity/<project>.toml` set the feature to `verified`, with `proof`
pointing at the cases file, and move `reconciled` forward. `rustify audit
<project>` shows the new count. See `parity/README.md` for how to record a
command that is native in its plain use and handed back in some situations.

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
