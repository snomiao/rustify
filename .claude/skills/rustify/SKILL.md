---
name: rustify
description: Check and advance the TypeScript-to-Rust migration of the projects in projects.toml (agent-yes, slack-hub, rechrome, otoji). Reports how far each Rust port is, compares Rust against TypeScript feature by feature, and sets up or checks the release pipeline that makes `bun i -g <package>` install the native binary on every platform. Use for "rustify status", "how far is the port", "compare rs and ts", "set up Rust CI/release", or when adding a project to the migration.
---

# rustify

This repo tracks a migration; it does not hold the ported code. Read
`docs/purpose.md` first if you have not this session. The rules that matter
while working:

- Rust code lives in each project's own repo, not here. So do releases: a
  project's binaries are built and published by its own workflow runs. This
  repo only supplies the pipeline those workflows call.
- "Done" means exact feature parity, and that `bun i -g <package>` gives the
  user the native binary without their knowing which platform they are on.
- Never work in a project checkout that has uncommitted changes — someone or
  some agent is using it. Use a separate git worktree.
- Committing, pushing, opening PRs and publishing happen only when the user
  asks. Publishing to npm or crates.io is never something to do on your own.
- Notes go in `docs/` of this repo, not in Claude memory.

Arguments: none = all projects; a project name = only that one; `release` after
a project name = go straight to step 3 for it.

## Step 1 — audit (always)

```bash
cargo run -q --release -- audit --write          # all projects, saves docs/status.md
cargo run -q --release -- audit slack-hub        # one project
cargo run -q --release -- audit slack-hub --offline   # skip registry lookups (ledger work)
```

The audit only reads. It reports, per project: checkout state, code size,
parity-ledger progress, and what `bun i -g` delivers today according to the
live npm registry. Each `todo` line is a gap; the summary table's "Next step"
is the first gap. Show the user the summary table, then act on the next steps
below as far as the user asked you to go. If they only asked for status, stop
after the table and the few findings that need their decision.

Add a project by appending a `[[project]]` to `projects.toml` (fields are
documented at the top of that file) and running the audit.

## Step 2 — compare Rust against TypeScript (the parity ledger)

Do this when the audit says "write the parity ledger" or "reconcile the parity
ledger". The format and the meaning of each status are in `parity/README.md`;
read it before writing a ledger.

Writing a ledger for the first time:

1. Find every entry point of the TypeScript: `bin` and `exports` in
   `package.json`, then the argument parsing and command dispatch. Read the dispatch code itself — do
   not rely on `--help` text or the README, which lag behind.
2. List every feature: commands, subcommands, significant flags, and behaviour
   that is not a command (config files, environment variables, output formats,
   exit codes, daemons, files written). The project's tests are a good second
   source: a tested behaviour is a feature.
3. For each feature, find the Rust that implements it and read it. Compare
   arguments, defaults, output and error cases — not just whether a function
   with a similar name exists. Where Rust has nothing, the dispatch code,
   flag definitions and test names are enough to list the feature as
   `missing`; read in full only where Rust has something to compare.
4. Record it with the lowest status that is true. `verified` only when a test
   in the project runs both implementations, or runs Rust against output
   recorded from TypeScript. Never write `dropped`; if something looks
   intentionally left out, mark it `missing` and list it for the user.
5. Set `reconciled` to `git rev-parse --short HEAD` of the checkout you read.
6. Run the audit for that project. Fix every ledger warning it prints.

Reconciling an existing ledger: the audit lists the TypeScript files changed
since `reconciled`. Re-check only features in those files, add new ones, then
move `reconciled` forward.

A full first pass over a large project means reading tens of thousands of
lines. With several projects to do, give each to its own subagent, pointing it
at this file and `parity/README.md`, and have it write only
`parity/<project>.toml`.

Report to the user: the percentage, the largest missing areas, and anything
that needs their decision (candidates for `dropped`, code that may stay
TypeScript).

## Step 3 — release pipeline (native binary through npm)

Do this when the audit's Delivery section has `todo` lines and the user wants
the pipeline set up. How it works and why is in `docs/npm-distribution.md`;
read it before changing a project.

The pipeline lives in this repo and projects reference it:
`snomiao/rustify/.github/workflows/rust-npm-build.yml@releases/v1` builds six
platforms, packs the npm packages and smoke-tests the install on real Linux,
macOS and Windows machines; `snomiao/rustify/actions/publish@releases/v1` publishes
from a job in the project's own workflow. Projects never list platforms.

1. In a clean worktree of the project, on a new branch:
   `cargo run -q --release -- vendor <project>` writes
   `.github/workflows/rust-npm-release.yml` filled in from the project's
   Cargo.toml and package.json. Check the values under `with:` (`pre-build`
   for steps cargo needs first, `js-build` in hybrid mode, `smoke-extra` for
   commands that are still JavaScript or handed back to it — one line each,
   `<command> [args] => <text it must print>`). If the project's build needs
   its own runners or steps, keep its build jobs, have them upload
   `native-<platform key>` artifacts, and pass `prebuilt: true`; if it cannot
   build all six platforms, list the ones it ships in `rustify.platforms`.
2. Add `rustify` to the project's `package.json`:
   - `bins`: each npm command → the cargo bin that implements it.
   - `mode`: `native` when the package needs no JavaScript at all; `hybrid`
     while it still ships some.
   - `runtime`: `bun` (the default, matching these projects' existing
     `#!/usr/bin/env bun`) or `node`.
   - `rootEnv`: a project-specific variable name such as `SLACK_HUB_PACKAGE_ROOT`.
   Only map a command to a cargo bin once that binary can answer every
   invocation of the command. While part of the command is still TypeScript,
   the Rust binary must hand those invocations back to the JavaScript entry:
   copy `templates/rust/js_fallback.rs` into the crate. Hand back everything
   that is not `verified` or at least `ported` in the parity ledger — a
   `partial` Rust command behaves differently from what users have today.
3. Connect it to how the project releases today. If a workflow already decides
   versions (semantic-release, release-plz), have it call this one
   (`uses: ./.github/workflows/rust-npm-release.yml` with `version` and
   `publish: true`) and turn off its own `npm publish`. Until that is done,
   leave the `publish` and `verify` jobs out, so the workflow can only build
   and test.
4. Rehearse locally where possible, from this repo:
   build the host binary, put it in `native/<platform key>/`, then
   `node templates/npm/pack.mjs pack --package <project>/package.json --artifacts native --allow-missing`
   and `node templates/npm/smoke.mjs --dist npm-dist --run "<command> --version"`
   (add `--also "<command> --help => <text>"` for a handed-back command).
   Pass `--version <x>` to `pack` equal to what the binary prints.
5. Open the PR only when the user asks. Its run builds every platform and
   smoke-tests the install on Linux, macOS and Windows without publishing.
   Read the results; do not assume.
6. Tell the user the one manual step: on npmjs.com, add the repository and the
   workflow a release starts from as the package's Trusted Publisher.
   Publishing itself is the user's call: the `publish` input, off by default.

After a release, run the audit again: "`bun i -g` gives" should read
"native binary, all platforms".

## Step 4 — port commands

Do this when a project has a ledger and the user wants the port itself to
move. The procedure is `docs/porting.md`; follow it exactly. In short:

1. A project without a crate: `cargo run -q --release -- scaffold <project>`
   starts one whose binary hands every command back to the JavaScript.
2. One command at a time: write its parity cases first and make them pass
   TypeScript against TypeScript, then port until they pass against Rust
   (`templates/parity/parity.mjs`), then switch the command over in `main.rs`.
3. Pass the test to the pipeline with `parity:` so CI holds the line, and set
   the ledger entry to `verified` with the cases file as `proof`.

Each project is a large, self-contained job that needs its whole codebase in
view. Give it to its own agent — or to the lane that already owns the project
— with `docs/porting.md` as the brief, rather than porting several projects
in one session. Project pull requests are merged by the owner or the owning
lane, not by you.

## Changing the pipeline itself

After changing anything in `templates/` or `.github/workflows/`:

1. `node --test tests/unit/*.test.mjs` and `tests/e2e/run.sh` (builds a toy binary,
   publishes it to a throwaway local registry, installs it with bun and npm
   into a temp directory, checks the result).
2. Open a PR here. The `ci` workflow runs the whole pipeline on the toy binary
   on all six platforms. Windows and macOS behaviour is only ever proven there.
3. After merging, and once `ci` is green on main, fast-forward the branch
   projects follow: `git push origin main:releases/v1`. Never force it. A
   change that projects must adapt to goes to a new `releases/v2` instead.
   (The tag `v1` marks the first release and does not move.)
