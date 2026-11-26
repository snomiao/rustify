# Parity ledgers

One file per project, `parity/<project>.toml`. A ledger lists every feature of
the TypeScript implementation and says how far the Rust port has it. It is the
only measure of port progress that `rustify audit` reports, so it has to be
honest: when in doubt, choose the lower status.

```toml
# Commit of the project checkout this ledger was last checked against.
reconciled = "e315b19"

[[feature]]
name = "search"               # what a user would call it
status = "partial"            # see below
ts = "ts/cli.ts:6120"         # where TypeScript implements it
rs = "rs/src/main.rs"         # where Rust implements it
note = "no --json; results are not grouped by channel"

[[feature]]
name = "dump"
status = "verified"
ts = "ts/cli.ts:7001"
rs = "rs/src/main.rs"
proof = "tests/parity.test.ts"  # test showing both behave the same
```

## What counts as a feature

Anything a user or another program can observe:

- each command and subcommand
- a flag or option that changes behaviour in a way worth tracking on its own
  (fold minor flags into the command's `note`)
- behaviour that is not a command: config and credential files, environment
  variables, output formats, exit codes, files written, background daemons,
  network endpoints

Use the user's name for it (`todo add`, `--json output`, `profile switching`),
not the function name.

## Status

| Status | Meaning | Needs |
|---|---|---|
| `missing` | Rust has nothing for it, or only hands it back to the JavaScript | — |
| `partial` | Rust has some of it; `note` says what is absent or different | `rs`, `note` |
| `ported` | Rust appears to do all of it, but no test compares the two | `rs` |
| `verified` | A test shows Rust and TypeScript behave the same | `rs`, `proof` |
| `dropped` | Deliberately not carried over; `note` says who decided and why | `note` |

Status is about what the Rust binary does on its own. A feature that works
because Rust starts the JavaScript for it is `missing`, however well that
works for users today.

Only the project owner can decide `dropped`. Never use it to make a number
look better.

`ts`, `rs` and `proof` are paths relative to the project checkout. Each may be
followed by `:line` or by a space and a description, and several locations are
separated by `;` (`ts/tail.ts; ts/cli.ts:8860 dispatch`). `rustify audit`
checks that the paths exist and that `verified` entries carry a proof.

A proof is a test you have read and that really compares the two: it runs both
implementations, or runs Rust against output recorded from TypeScript. A test
that is skipped in CI, or that you have not seen pass, proves nothing. Nor
does a comparison that asserts less than the feature: a test that only checks
for a substring or an exit code proves the feature whose whole behaviour is
that substring or exit code, and no other.

## How fine-grained

The count is what the audit reports, so keep the grain even: one entry per
command or subcommand, plus one per behaviour that has its own module or its
own test file. Record a gap shared by every command (credentials, a global
flag) once, not once per command. Leave out test tooling and code that
`projects.toml` lists under `keep_ts`. Rust-only behaviour with no TypeScript
counterpart goes in the `note` of the nearest feature and in your report to the
owner — under exact parity it has to be removed or blessed.

## Keeping it current

`reconciled` is the short commit of the project the ledger was checked
against. When TypeScript files change after that commit, `rustify audit` lists
them. Re-check only the features living in those files, add any new feature,
then move `reconciled` forward.
