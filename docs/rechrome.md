# rechrome

Survey of `snomiao/rechrome` at `212e5e2` on 2026-11-27. Based on reading the
tree and on one local build; the TypeScript was not ported or compared.

## Size

About 10,700 lines of TypeScript to replace in 18 files (`rechrome.ts` alone
is 5,200, `serve.ts` 1,650), with about 6,200 lines of tests (roughly 430
cases). The browser extension, the hosted functions and the signaling worker
stay TypeScript for now (`keep_ts` in `projects.toml`). `tray/` is a separate
Rust crate for the tray icon and is not part of the CLI.

## State

- npm: `rechrome`, published by semantic-release. The commands `rech` and
  `rechrome` are `rechrome.ts`, run by bun.
- Rust: `rs/` is on `main` since snomiao/rechrome PR #120 (merged
  2026-11-26): a binary that hands every command to `rechrome.ts`, and the
  pipeline workflow (build and install test only), green on all six
  platforms.
- No parity ledger yet. Writing one is the first step of the port.

## Notes for whoever ports it

- The package is assembled by `prepublishOnly` (vendors the playwright CLI,
  builds `.js` twins, checks that every shipped import is in the tarball). The
  pipeline runs it as `js-build`.
- rechrome finds its own files through `import.meta.dir` and restarts itself
  through `process.execPath` and `Bun.main`. The hand-back keeps all of that
  working because it runs the same `rechrome.ts` from the same directory.
- Much of the value is in the daemon (`rech serve`) and the browser bridge.
  Commands that only talk to the daemon are the natural first ports; the
  playwright pass-through will stay JavaScript longest.
- `CLAUDE.md` in the repo forbids restarting the user's Chrome. Tests must not
  either.
