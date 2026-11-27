# codehost

State of `snomiao/codehost` at `cfba919` (v0.40.0, 2026-11-27). The most
downloaded of the owner's CLIs (about 1,800 a month).

codehost serves a machine's VS Code and terminals to the codehost.dev page
over a WebRTC data channel; a Cloudflare Worker relays only the signaling.
The daemon and the CLI are about 10,000 lines of TypeScript run by bun; the
page, its workers and the signaling Worker are TypeScript too and stay so.

## State

- npm: `codehost`, published by semantic-release on every push to main. The
  commands `codehost` and `ch` are `src/cli/index.ts`, run by bun.
- Ledger: `parity/codehost.toml`, 200 features: 7 verified, 15 partial,
  178 missing. Written by four readers who read every tracked file, checked
  by two critics who enumerated commands, options, variables, files, routes,
  messages and test titles mechanically, then updated by the first port.
- Rust: snomiao/codehost PR #10. Native on Linux and macOS: `open --print`, `init`, the
  room-token check of `serve`, `dev` and `expose`, and `dev` registering with
  a running host daemon, answered in 11 to 17 ms against 177 to 259 ms. 440
  parity cases (300 answered by the binary, 140 handed back) on pipes and on
  a terminal, plus 52,358 helper answers and 20,000 command lines compared
  with the TypeScript. An independent verifier found four differences (project
  files bun warns about, `.env` variables that reach git, git output over
  1 MiB); all are handed back now. The parity job runs on Linux x64, macOS
  arm64 and Windows x64 (442 cases; on Windows all handed back as marked).
  Running the cases on the Mac found that the binary started a `git` the
  TypeScript cannot (a script without `#!`, or one naming a missing
  interpreter); the binary now finds and checks `git` the way bun does.
- Still the JavaScript: everything else, everything on Windows, and
  any project with its own `.env` in the current directory (bun loads it and
  git inherits it), so many users see no speed-up yet.

## Why it matters

Every command imports the native WebRTC addon (`node-datachannel`) before it
parses its arguments, and a failed load starts a download. So even
`codehost --help` and `codehost open --print`, which scripts and prompts call
to get a link, pay for the whole daemon's start-up. A native binary answers
those at once.

## What to port first

In this order; each step needs the ones before it.

1. **`codehost open [target]`** with `--print`, `--anon`, `--page`, `-t`, and
   the helpers it uses (deep-link paths, git URL to deep-link path, repository
   identity from git). No daemon, no network; `--print` makes it comparable
   byte for byte. Pinned by `src/shared/repo.test.ts`.
2. **The room-token policy** and its rejection messages, and generated
   tokens. Every serving command runs it first. It has to give the Worker's
   verdict exactly (UTF-16 length, JavaScript's `\s`, the list of weak
   tokens): a more lenient copy shows as a daemon that reconnects for ever
   and never registers.
3. **`codehost init [dir]`** and its three templates (pinned by
   `src/cli/init.test.ts`).
4. **The machine files** `~/.codehost/config.json`, `daemon.json`,
   `workspaces.json`: both implementations will share them while the port is
   partial, so their format and their read-modify-write have to be proven
   before anything native writes them.
5. **`codehost dev` when a host daemon is running**: no networking, one
   append to `workspaces.json`, five lines, exit 0.
6. **The pure helpers that have tests**: daemon names and the stored command
   line, workspace enumeration, provisioning target validation, the
   repository allow-list.
7. **`codehost list`**, against a stand-in service manager.
8. **The tunnel host** over an abstract transport: frame codec, HTTP and
   WebSocket proxy, flow control. `src/tunnel/tunnel.test.ts` drives a host
   with the TypeScript client over an in-memory pair, and the same client can
   drive a Rust host against a loopback server, with no WebRTC.
9. **The daemon's own routes** (plugins, preview, provisioning, `/__codehost/meta`).
10. **Signaling, the WebRTC answering peer, admission**, then foreground
    `serve`, `dev --standalone`, `expose`. Needs a Rust WebRTC stack that
    reports the buffered amount, and a local signaling server.
11. **Last: `-d` and `setup`, `stop`, `update`, the VS Code installer.** They
    register with the system, download and replace binaries, and need the
    owner's decisions first.

## Candidates to stay TypeScript (the owner decides)

- The codehost.dev page, its Service Worker and SharedWorker, the embeddable
  room client, and the signaling Worker.
- The modules the page and the Worker share with the daemon
  (`src/shared/signaling.ts`, `src/tunnel/protocol.ts`, …): they stay
  whatever the daemon is written in, so a Rust daemon carries its own copy
  of its half and has to be kept in step.
- The five package exports (`codehost/provision`, `/tunnel`, …) and the
  provisioning library behind them, which other JavaScript programs import.
- The legacy web terminal (`src/server.ts`, `src/terminal-ws.ts`), which no
  command starts: is it part of the product at all?
- Help and usage-error text, which yargs writes and translates.

## What a port and its tests must never do

- Never connect anything to `wss://signal.codehost.dev`, the default of
  `--signal`: it is live, every message is a billed Durable Object request,
  and a daemon that joins a real room appears on real users' pages. Use a
  local signaling server and throwaway tokens.
- Never read or write the real `~/.codehost`: it holds the room token and the
  remembered root, a corrupt read is silently replaced at the next write, and
  `daemon.json` is a single slot that a test daemon would overwrite and
  delete.
- Never run `setup`, `-d`, `stop` or `list` against the machine's process
  managers (oxmgr, systemd, launchd, Task Scheduler, pm2): they replace and
  delete live daemons, and `stop` kills process trees by pids read from a
  file without checking they are codehost's.
- Set `CODEHOST_NO_SELF_UPDATE=1` everywhere: self-update may run `bun add -g
  codehost@latest` and replace the user's install.
- **Never move or rename `src/cli/index.ts`, nor change how it is called, in
  a release**: the command line `<bun> <…>/src/cli/index.ts serve … --token=…`
  is stored in oxmgr's table, `~/.codehost/daemons.json`, Task Scheduler
  files and pm2 on users' machines, and those daemons would fail at their
  next restart.
- Never record a real room token (it is a bearer secret that gives a full
  terminal on the host) or the output of `git credential fill`.
- Never open the browser (`open` without `--print` does), never start `code
  serve-web` or the legacy server on a real machine.
- Keep the wire protocol additive: role `server`, accept `client` and
  `viewer`, omit absent fields rather than send null, keep the room metadata
  under about 2 KB, keep the 25 s ping, the jittered back-off and the 15 s
  metadata throttle, which limit what the live service is billed.

## Found while reading (not run)

- `codehost update` returns early whenever any `code` is on `PATH`, although
  the daemon may be using the managed VS Code CLI instead, so it can never
  refresh the binary actually in use.
- `serve <dir>` remembers the directory before the confirmation for a risky
  root, so answering no to the warning about `$HOME` still remembers it.
- On Windows the daemon's label is built by splitting the path on `/`, so the
  whole path becomes the label.
- `expose -d` names its daemon after the current directory, not the port, so
  two exposes from one directory replace each other.
- Self-update upgrades an npm global install with `bun add -g`, which installs
  elsewhere; it then repeats on every launch.
- The README lists five of the eleven commands and describes defaults the
  code no longer has.
