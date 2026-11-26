# agent-yes

Survey of `/code/snomiao/agent-yes/tree/main` on 2026-11-26 (v1.303.1). Based
on reading the tree — line counts, module lists and command names. Nothing was
built or run, so the gaps below are leads to confirm, not verified facts.

## Size

| | Lines | Where |
|---|---|---|
| TS source (no specs) | ~44k, 126 top-level modules | `ts/` |
| TS specs | ~44k | `ts/*.spec.ts`, `ts/*.bun.spec.ts` |
| Rust | ~32k | `rs/` |

Biggest TS files: `subcommands.ts` (8.3k), `serve.ts` (5.5k), `index.ts` (1.6k).

## What Rust already has

- The core agent loop: PTY spawn, ready/enter/fatal pattern matching, config
  loading, pid store, run lock, FIFO IPC, codex session resume, webhooks, file
  logging.
- A serve daemon as a separate binary, `ayrs` (`rs/src/serve/`): HTTP API,
  WebSocket, WebRTC share, rooms, expose, host and process stats. It is a
  separate binary so it can run beside the TS `ay serve` during the migration.
- `ay-spawn-hidden`, a Windows-only launcher with no TS equivalent.
- An optional libp2p swarm mode (`--features swarm`); the TS side is a stub.

## What looks missing in Rust

Most of the `ay` subcommand surface. `ts/subcommands.ts` dispatches about 80
subcommand names. No Rust module was found for these stores and the commands
built on them:

- todo (`todoStore.ts`, `todoCli.ts`)
- notify (`notifyStore.ts`, `notifyDaemon.ts`, `notifyInbox.ts`, `notifyRouter.ts`)
- history (`histStore.ts`), message log (`messageLog.ts`)
- channels (`channels.ts`, `channels/`)
- remotes (`remotes.ts`, `webrtcRemote.ts`)
- ask (`askCli.ts`, `askApi.ts`)
- `ps`, `tail`, `attach`, `spawn`, `schedule`, key-sending commands

The CLI entry point itself is still TS: `ts/cli.ts` parses arguments, handles
subcommands, then hands a real agent launch to the Rust binary.

## Open decisions

- `ROADMAP.md` in the repo tracks parity for the core loop only and marks
  auto-update, `--use-skills` and `--install` as "not planned". Under an exact
  parity goal these need an explicit in-or-out decision.
- The npm entry point has to stop being TS for the port to finish. See
  [npm-distribution.md](npm-distribution.md).

## Parity ledger

`parity/agent-yes.toml`, written on 2026-11-27 by the agents that maintain
agent-yes, read at `30116f1` (v1.308.4): 335 features — 1 verified, 8 ported,
125 partial, 201 missing. Status means what the Rust binaries (`agent-yes`,
`ayrs`) do on their own; a Rust code path that re-executes the JavaScript
counts as missing.

| Area | Features | verified | ported | partial | missing |
|---|---:|---:|---:|---:|---:|
| Launching an agent run (`ts/cli.ts`, flags) | 44 | | | 22 | 22 |
| The agent loop | 37 | 1 | 2 | 29 | 5 |
| Config, env vars, state files | 31 | | 3 | 15 | 13 |
| Subcommands in `ts/subcommands.ts` | 59 | | | | 59 |
| Subcommands in their own modules, package exports | 69 | | | 1 | 68 |
| `ay serve`: daemon, service, rooms, expose, remotes | 51 | | | 25 | 26 |
| `ay serve`: HTTP / WebRTC API | 44 | | 3 | 33 | 8 |

How the two fit together today: `ts/cli.ts` is what every npm command runs.
It handles the management subcommands itself and, for an agent run, starts the
Rust runner by default. The Rust `agent-yes` binary implements no management
subcommand: given one, it re-executes the JavaScript launcher.

The largest missing areas, in order: the commands in `ts/subcommands.ts`
(`ls`, `ps`, `status`, `tail`, `send`, `spawn`, `attach`, `stop`, … about
14,000 lines); the parts of `ay serve` that `ayrs` has no counterpart for;
everything the launcher does before it hands a run to Rust (auto-update, spawn
gate, `--detach`, `--stream`, …); the `todo` tracker; `ask`/`answer`, `term`,
`widget`, `tray`, `setup`, `ws`; `ay ch` channels; cron and schedules.

Only one comparison test runs in CI (`ts/tests/shared-e2e.spec.ts`, each case
under `--no-rust` and `--rust`), and its assertions are coarse. No workflow
runs `cargo test`.

### For the owner to decide

Candidates to stay TypeScript or to leave the port:

- auto-update (may be moot once npm installs the native binary), and the
  launcher's Rust lookup/download/cache, which certainly is;
- `--use-skills` — Rust accepts the flag and silently ignores it: port it or
  reject it;
- `--stream`, the legacy systray (`--tray`), `dsh-legacy`, the `liagent`
  command and exports;
- the browser-side code (`channels`, `terminal`, `widget` bundles, the web
  console) and the programmatic API (`import from "agent-yes"`);
- `/api/asks` and its answer route, which the Rust source says are
  deliberately not ported.

Rust-only behaviour that exact parity has to bless or remove: the swarm mode
(compiled out of release builds), `ayrs serve --join` and `join-secret`, the
runner's stall and wedge watchdogs, `--no-tty`/`--force-tty`, native
launchd/systemd/Task Scheduler units, `ay-spawn-hidden`, `rs-tray/`.

### Found by reading, not yet confirmed by running

- Rust matches patterns against the whole rendered screen without multi-line
  mode, so `^`-anchored patterns in `default.config.yaml` only match the first
  row.
- `ayrs` never percent-decodes query values, and its `/api/tail` never sends
  the 15 s keep-alive on Unix.
- The two runtimes interfere: a Rust agent start drops the `exited` records
  TypeScript wrote to `pids.jsonl`; their `--queue` locks live in different
  files; the codex session store is at a different path on macOS and Windows.
- `ayrs serve` prints the room link, secret included, to stdout under a
  supervisor, so it lands in the service log; TypeScript withholds it.
- `ay serve install` and `ayrs serve install` register different services, and
  the TypeScript install on Windows deletes Rust's Task Scheduler entry.
- In the TypeScript: with Ctrl+Y off it keeps auto-answering; `ay todo verify`
  cannot succeed from the CLI; `ay --robust claude` becomes a usage error
  under the default runtime.
- `ROADMAP.md` in the repo is stale (`--install` exists in Rust).

The full report is in the description of rustify PR #7.

## Working notes

- The checkout was on branch `fix/resume-by-session-id` with uncommitted
  changes under `rs/src/`. Port work should use a separate worktree.
- `rs/default.config.yaml` is embedded in the binary at compile time, so config
  changes need a Rust rebuild.
