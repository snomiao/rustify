# gchat-cli

> **Set aside (2026-11-27)** by the owner: rarely used, so no more porting
> work goes into it. What follows is the record of the port so far.

The second project ported end to end. snomiao/gchat-cli PR #2, read at
`4ced1d2`.

gchat-cli is a thin Google Chat CLI: about 940 lines of TypeScript that build
the nested-JSON calls for the external `gws` program, resolve space names and
render messages. It has no network code of its own.

## State

- All six commands are answered by the Rust binary: `auth`,
  `spaces`/`rooms`/`ls`, `read`, `send` (both steps), `tail`, `watch`. 3,000
  lines of Rust.
- Proof: 602 parity cases, all the same on both sides, against a fake `gws`
  that records every call. 419 are answered by the binary with no JavaScript
  reachable; 183 are handed back on purpose. Re-run independently after the
  port. The pipeline runs them on every pull request.
- Ledger: 16 features — 12 verified, 1 ported, 1 partial, 2 missing.

## What still goes to the JavaScript

`--help`, `--version`, usage errors and unusual spellings of options (yargs,
whose text follows the user's locale); a `gws` that cannot be started; answers
from `gws` of an unexpected shape.

## Not proven

Windows (type-checked only; a `gws` that is a `.cmd` or `.bat` is handed back,
everything else is answered natively without a single case run there).

macOS was tried once by hand on 2026-11-27 (arm64, bun 1.4.4): 601 of 602
cases behave the same. The one that differs is real: given a `gws` that is a
text file without a `#!` line, bun fails with `ENOEXEC`, while the binary runs
it through the shell and prints the scope report. The committed
`rs/parity.json` also carries the paths of the machine that generated it
(`/code/snomiao/…`, `/root/.bun/bin`); CI regenerates it first, so CI is
unaffected, but the file should use `<REPO>`. Both are to be fixed before the
project turns on `parity-platforms`.

## For the owner

- The published package runs `ts/cli.ts`; npm ignores the
  `publishConfig.bin` that names `dist/cli.js`, which ships unused.
- `gchat --version` prints `unknown` when installed with `bun i -g`, today as
  well.
- The PR lists eight behaviours of the TypeScript that look like bugs and were
  copied faithfully, among them: `tail --interval <non-number>` polls without
  pause; a `send` whose answer from `gws` lacks `name` exits 1 although the
  message was sent.
- The install test runs the first step of `send` once per platform. It only
  prints the confirm prompt and cannot post.
