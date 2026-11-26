# Porting a project, command by command

How a TypeScript CLI becomes a Rust one here without ever shipping a
behaviour change. Read [purpose.md](purpose.md) first.

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

## 1. Start the crate

In a clean worktree of the project, on a new branch:

```bash
rustify scaffold <project> --at <worktree>   # rs/Cargo.toml, rs/src/main.rs, rs/src/js_fallback.rs
rustify vendor <project> --at <worktree>     # .github/workflows/rust-npm-release.yml
```

`--at` names the worktree to write into; without it the project's default
checkout is used. `rustify audit <project> --at <worktree>` reads the same
place.

Then add the `rustify` block the scaffold prints to `package.json`, build once
and commit `Cargo.lock`. The pull request's run builds six platforms and
install-tests them. Use `build:` or `ci:` commit types for all of this: the
project's users get nothing new yet, so no release should be cut.

A package with several commands (`ay`, `claude-yes`, …) still needs only one
cargo bin: map every command to it in `rustify.bins`. The binary learns which
command it was started as from its own name.

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
rule. Every rule is a hole in the proof, so keep them few.

Cover, for the command:

- its plain use, and each flag that changes what it does;
- the ways it fails: missing argument, bad value, missing file, a server
  error. The exit code and the text on stderr are part of the behaviour;
- what it leaves behind (`after`: files, git state, config);
- input on stdin, if it reads any.

The runner starts each case in an empty directory with an empty `HOME` and
without a terminal. A command that talks to a service needs both
implementations pointed at the same stand-in: a mock server the project's
tests already have, or recorded responses. A project that has such a harness
can keep its own test instead of `parity.mjs`; what matters is that one test
runs both implementations and compares everything they print.

## 3. Port the command

Read all of the TypeScript the command runs, including the helpers and the
argument parser's configuration. Then write the Rust so the cases pass.

- **Port what is shared first**: global flags, where configuration and
  credentials come from, how output is formatted. Every later command needs
  them.
- **Byte for byte.** Same text, same order, same blank lines, same exit code.
  Do not improve anything on the way; improvements are separate changes made
  to both implementations.
- **Usage errors and `--help` belong to the argument parser** (yargs,
  commander). Their text is hard to reproduce. Keep handing them back: let
  Rust take an invocation only when it has the shape Rust implements, and
  hand back everything else.
- **When in doubt, hand back.** A handed-back command is merely not faster. A
  wrong native command is a bug in a release.

## 4. Switch the command over

Add one arm for it in `main.rs`, guarded by `native()` so that
`<PROJECT>_NO_NATIVE=1` still hands everything back. That variable is the way
out for a user if a ported command misbehaves; keep it until the JavaScript is
gone.

## 5. Make CI hold the line

Pass the test to the pipeline in the project's workflow:

```yaml
    with:
      parity: node "$RUSTIFY_PARITY" --cases rs/parity.json --ts "bun ts/cli.ts" --rs "$RUSTIFY_BIN_DIR/<bin>"
```

It runs on Linux against the freshly built binary and has to pass before
anything can be published. Add an install check for the command to
`smoke-extra` as well, so every platform runs it once.

## 6. Record it

In `parity/<project>.toml` set the feature to `verified`, with `proof`
pointing at the cases file, and move `reconciled` forward. `rustify audit
<project>` shows the new count.

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
  [npm-distribution.md](npm-distribution.md)), rehearsed once with nothing
  published;
- the owner has decided to switch it on. Publishing is never an agent's call.
