# rechrome

State of `snomiao/rechrome` at `c4ef27e` (2026-11-27).

## Size

About 13,000 lines of TypeScript to replace: `rechrome.ts` (5,300), `serve.ts`
(1,700), eight audio modules (2,500) and fifteen smaller ones, with 62 test
files. The browser extension, the hosted functions and the signaling worker
stay TypeScript for now (`keep_ts` in `projects.toml`). `tray/` is a separate
Rust crate for the tray icon and is not part of the CLI.

## State

- npm: `rechrome`, published by semantic-release. The commands `rech` and
  `rechrome` are `rechrome.ts`, run by bun.
- Rust: `rs/` is on `main` since snomiao/rechrome PR #120 (merged
  2026-11-26): a binary that hands every command to `rechrome.ts`, and the
  pipeline workflow (build and install test only), green on all six
  platforms.
- Ledger: `parity/rechrome.toml`, 328 user-visible features, all `missing`
  because nothing is ported yet. It was written by reading all of the code;
  nothing was run. Three passes: six readers and a merge; a critic that
  enumerated commands, flags, variables, files and routes mechanically (six
  gaps and six inaccuracies, fixed); and a line-by-line read of the eight
  audio modules and the Windows tests, which the first pass had left
  unassigned (27 entries added, 23 corrected).

## What to port first

In this order. Each step needs the ones before it.

1. **`rech --version`.** The smallest command that needs neither daemon nor
   browser. It forces the one thing everything else needs: finding the
   package from the native binary. Use it to stand up the parity harness.
2. **Where `RECHROME_URL` comes from, and how it is parsed.** Every command
   starts here. Needs a decision from the owner first: bun loads the
   folder's `.env` files before `rech` starts and the TypeScript relies on
   it. First visible result: the three-line "not connected" message.
3. **Session identity** (the worktree key, `RECH_IDENTITY`, submodules) and
   the project's `.rechrome` folder. The key has to match byte for byte, or
   live browser sessions are orphaned.
4. **Argument handling of the client**: dispatch, `rech pw` and `--`,
   `--profile`, `--isolate`, the unknown-command hint. Pure functions with
   unit tests today.
5. **The `rech1_` token format** and the values derived from a token. All of
   sharing depends on it later.
6. **Read-only local state**: the profile registry, `listeners.json`, the
   extension-token readers. They read Chrome's files and must stay read-only
   and lock-free.
7. **Redaction of secret-shaped strings in command output.** About 200
   gitleaks expressions; JavaScript regex semantics make this the hardest
   client piece. Record a comparison corpus from the TypeScript first.
8. **Browser commands sent to the daemon** (`open`, `click`, `screenshot`,
   `eval`, …). This is where start time is felt. The client half needs no
   browser and can be compared against a stub daemon.
9. **`rech status`, then the commands that only edit files** under
   `~/.rechrome` (`listener …`, `share …`, `session ls`). They have to write
   those files exactly as the TypeScript does, because the JavaScript daemon
   keeps reading them.

Setup, the daemon itself and WebRTC come after all of this.

## Candidates to stay JavaScript (the owner decides)

- The vendored playwright CLI and its patched playwright-core.
- The Chrome extension, the invite page, the signaling worker.
- Code that is sent into the browser page or into playwright as text: the
  in-page audio bridge, the snippets of `fill-secret`, `read-*`, `record` and
  the upload scripts. A Rust binary would carry them as strings.
- Help and usage-error text, which yargs writes and translates by locale.
- The WebRTC transport, until a Rust WebRTC stack is shown to interoperate
  with node-datachannel peers and browsers.
- Possibly the secret scanner, if the comparison corpus shows that the
  JavaScript regex behaviour cannot be matched exactly.

## What a port and its tests must never do

From the repo's `CLAUDE.md` and from the code:

- Never quit, kill, restart or relaunch the user's Chrome, not even to reload
  the extension. Never test against the user's real Chrome or its profile:
  use a throwaway browser with its own data directory, and a stub daemon for
  client tests.
- Never write to Chrome's own data. The token readers stay read-only.
- Never bind port 13775 or one of the user's listener ports, and never
  restart, re-register or delete the user's real daemon. Tests use a
  temporary `HOME` and other ports.
- Never read-modify-write the real `~/.rechrome`, `~/.env.local` or a
  project's `.rechrome/.env.local` from a test. A wrong writer loses extension
  tokens and cuts every saved link.
- Never widen what gets killed or moved: stale-port recovery and `profile rm`
  act only on rechrome's own processes and managed folders.
- Never change the inputs of the session key or the `RECH_IDENTITY` default.
- Never put a secret in argv, a log line, a URL query or test output.
- Never weaken the scoped-listener allow-list, the grants or the share
  credential checks.
- Never fall back silently to a headless browser or to another profile.
- Never change the machine's setup from a test: Tailscale routes, Windows Run
  keys or scheduled tasks, global installs, the owner's Cloudflare account.

## Notes for whoever ports it

- The package is assembled by `prepublishOnly` (vendors the playwright CLI,
  builds `.js` twins, checks that every shipped import is in the tarball). The
  pipeline runs it as `js-build`.
- rechrome finds its own files through `import.meta.dir` and restarts itself
  through `process.execPath` and `Bun.main`. The hand-back keeps all of that
  working because it runs the same `rechrome.ts` from the same directory.
- Several paths are defined relative to the JavaScript install directory (the
  legacy `.rech` folder, the watched `.env.local`), and the Windows scheduled
  task embeds the bun binary and the script path. Each needs a decision once
  `serve` is native.
- `profile rm` on Linux moves the folder into the Trash with a plain rename
  and writes no `.trashinfo`; a standard trash library would behave
  differently.
