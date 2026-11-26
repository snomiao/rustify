# genvx

The first project ported end to end, and the pilot for
[porting.md](porting.md). snomiao/genvx PR #2, read at `8809766`.

genvx syncs `.env` files across machines through a private git repository:
about 1,500 lines of TypeScript, a yargs CLI that shells out to `git` and
encrypts with scrypt and AES.

## State

- Every command is answered by the Rust binary in its plain, non-interactive
  form: `branch`, `diff`, `pull`, `push`, `hooks run/status/install/uninstall`,
  `setup`. 3,300 lines of Rust.
- Proof: 316 parity cases, all the same on both sides; 238 of them answered by
  the binary, 78 handed back on purpose; both implementations working on one
  store in both directions; re-run independently after the port. The pipeline
  runs all of it on every pull request.
- Ledger: 27 features — 18 verified, 1 ported, 4 partial, 4 missing.
- Start time on Linux: `genvx branch` 83 ms → 3 ms. With an encrypted file
  scrypt dominates: `diff` 787 ms → 386 ms.

## What still goes to the JavaScript

`--help`, `--version` and usage errors (yargs); anything that asks a question
on a terminal; projects whose `.env` files use syntax bun interprets, or with
`bunfig.toml` or `NODE_ENV` set; `hooks install` in shared mode with a
`package.json`; plaintext mode.

## Not proven

Windows and macOS (the cases need a POSIX shell; those platforms build and
install-test the binary), prompts, and the wording of rarer file-system
errors.

## For the owner

- The PR lists ten behaviours of the TypeScript that look like bugs and were
  copied faithfully, among them: `--no-encrypt` does nothing; an error leaves
  `.genvx/` behind; `hooks install` in a linked worktree writes where git
  never looks.
- Releases still go through `release.yml`. Publishing the native package
  means wiring it to the pipeline, as slack-hub PR #118 does.
