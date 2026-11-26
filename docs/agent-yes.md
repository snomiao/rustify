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

## Working notes

- The checkout was on branch `fix/resume-by-session-id` with uncommitted
  changes under `rs/src/`. Port work should use a separate worktree.
- `rs/default.config.yaml` is embedded in the binary at compile time, so config
  changes need a Rust rebuild.
