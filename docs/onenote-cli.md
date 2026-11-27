# onenote-cli

snomiao/onenote-cli PR #4 (the crate and the pipeline) and PR #5 (the first
ported commands), read at `9af05e1`.

onenote-cli reads and searches OneNote notebooks through Microsoft Graph:
about 5,700 lines of TypeScript, a yargs CLI with a local cache and a SQLite
full-text index, MSAL login and an ink terminal UI for `sync`.

## State

- Native: `onenote search <query>` from the local index, on Linux, and
  `onenote auth setup` on every platform. Everything else is handed to
  `src/index.ts` before anything is printed.
- Proof: 562 parity cases, all the same on both sides, plain and on a
  pseudo-terminal (colours and clickable titles); 371 answered by the binary,
  191 handed back on purpose. A unit test starts bun under each of the 598
  time zone names and compares 22.9 million local times with the binary's.
  The pipeline runs all of it on every pull request, against the static Linux
  binary; it passed on PR #5.
- After the port an independent verifier added 196 cases and fuzzed the
  query, date and string helpers against the TypeScript's own (about 1.4
  million comparisons). It found four differences, all now handed back: the
  time zone data, runtime debugging variables, an index written in the last
  millisecond of a second, a package path bun cannot load.
- Ledger: 55 features, 6 verified, 3 partial, 46 missing.
- One search measured by hand: 142 ms in TypeScript, 7 ms in Rust.

## Where the search still goes to the JavaScript

- macOS and Windows: what bun's `toLocaleString()` and SQLite do there could
  not be tried from Linux, so the search is not even compiled for them.
- The first search on a machine (no index yet: the TypeScript starts a sync),
  `--online`, and any query SQLite rejects.
- Time zones where the binary's zone data (tzdb 2026f) and bun 1.4.0's (ICU
  78.3) disagree: Western Canada from late October 2026, Cuba this winter,
  Morocco from mid-September 2026.
- Any `BUN_*` (except `BUN_INSTALL`), `NODE_*`, `MIMALLOC_*` or `ICU_*`
  variable, so also machines behind a company proxy with
  `NODE_EXTRA_CA_CERTS`; a `.env*` file that mentions `TZ`, `BUN`, `NODE` or
  `ICU`; a `bunfig.toml`.

Every command that needs Graph or MSAL is still JavaScript. Porting those
needs a stand-in for Graph, which does not exist yet.

## For the owner

- **The TypeScript loses output on a slow reader** (bun 1.4.0, after
  `process.stdout.isTTY` was read at `src/index.ts:12`): `onenote search … |
  less`, or an agent harness reading through Node, can silently get partial
  results. The binary writes everything. This is the one place where the two
  differ on purpose; matching it would mean keeping a data loss.
- `onenote reindex` after a current sync wipes the index (it reads one
  directory level, sync writes two), and the fallback search has the same
  limit. Other defects found and copied: quoted phrases are not phrases,
  `#discuss` needs all three tags, titles mostly in Cyrillic are counted but
  never listed. The full list is in PR #5.
- The package has no `files` list. PR #4 adds `rs/.npmignore`, or the next
  release would ship the crate (675 KB) in the npm tarball.
- The index lives in the installed package directory, which an upgrade
  replaces; the fallback to `~/.onenote-cli/cache` that a comment promises
  does not exist.
