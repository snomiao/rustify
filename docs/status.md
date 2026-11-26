# Rustify status

| Project | Port | `bun i -g` gives | Next step |
|---|---|---|---|
| agent-yes | 1 verified, 8 ported, 125 partial, 201 missing of 335 | JavaScript | port the missing features |
| slack-hub | 0 verified, 1 ported, 19 partial, 132 missing of 152 | JavaScript | port the missing features |
| rechrome | not started | JavaScript | write the parity ledger |
| otoji | started, not measured | JavaScript | write the parity ledger |
| codehost | not started | JavaScript | write the parity ledger |
| fbi-proxy | started, not measured | JavaScript | write the parity ledger |
| onenote-cli | not started | JavaScript | write the parity ledger |
| dotenvdotenc | not started | JavaScript | write the parity ledger |
| qqdocs | not started | JavaScript | write the parity ledger |
| winrpc | unknown | unknown | clone the repository |
| chatwork-cli | unknown | unknown | clone the repository |
| genvx | not started | JavaScript | write the parity ledger |
| rustdesk.skill | unknown | unknown | clone the repository |
| wtx | unknown | unknown | clone the repository |
| gchat-cli | not started | JavaScript | write the parity ledger |
| Comfy-AI | not started | JavaScript | write the parity ledger |
| bunto | unknown | unknown | clone the repository |
| snocommit | not started | JavaScript | write the parity ledger |
| comfy-codesearch-cli | unknown | unknown | clone the repository |

## agent-yes

**Checkout**

- `info` `/code/snomiao/agent-yes/tree/main` on `fix/resume-by-session-id` at `fbbd727`
- `warn` 17 uncommitted change(s) — someone is working here; use a separate worktree

**Code**

- `info` TypeScript/JS to replace: 44,153 lines in 145 files; its tests: 43,746 lines, about 3,218 cases
- `info` Rust: 30,920 lines in 62 files, 519 tests
- `info` by file name, 122 of 145 TypeScript modules have no Rust module of the same name (38,659 lines). A rough signal only: Rust code is often organised differently. Largest: `ts/subcommands.ts` (8,342), `ts/serve.ts` (5,484), `ts/index.ts` (1,601), `ts/todoStore.ts` (896), `ts/todoCli.ts` (856), `ts/notifyDaemon.ts` (773), `ts/terminal/browser.ts` (745), `ts/channels.ts` (740)

**Parity ledger**

- `info` 335 features: 1 verified, 8 ported but unproven, 125 partial, 201 missing, 0 dropped
- `warn` `--stream (Claude stream-json session runner)`: ts path `ts/stream/runner.ts` does not exist
- `warn` `--stream (Claude stream-json session runner)`: ts path `ts/stream/launch.ts` does not exist
- `warn` `stream mode chosen automatically for claude --output-format stream-json`: ts path `ts/stream/launch.ts` does not exist
- `warn` `stream mode chosen automatically for claude --output-format stream-json`: ts path `ts/stream/launch.ts` does not exist
- `warn` `stream mode: Claude event parsing and transcript output`: ts path `ts/stream/claude.ts` does not exist
- `warn` `stream mode: Claude event parsing and transcript output`: ts path `ts/stream/transcript.ts` does not exist
- `warn` `stream mode: Claude event parsing and transcript output`: ts path `ts/stream/output.ts` does not exist
- `warn` `stream mode: stdin forwarding`: ts path `ts/stream/input.ts` does not exist
- `warn` `stream mode: stdin forwarding`: ts path `ts/stream/jsonInput.ts` does not exist
- `warn` `stream mode with --detach`: ts path `ts/stream/detach.ts` does not exist
- `warn` `stream session state, cost and send (read by ay ls / status / send)`: ts path `ts/stream/state.ts` does not exist
- `warn` `stream session state, cost and send (read by ay ls / status / send)`: ts path `ts/stream/cost.ts` does not exist
- `warn` `stream session state, cost and send (read by ay ls / status / send)`: ts path `ts/stream/send.ts` does not exist
- `warn` `ConPTY mode filter (Windows, DECSET 9001)`: ts path `ts/conptyModeFilter.ts` does not exist
- `warn` `ConPTY mode filter (Windows, DECSET 9001)`: rs path `rs/src/conpty_mode_filter.rs` does not exist
- `warn` `state files written only by TypeScript subcommands and daemons`: ts path `ts/schedules.ts` does not exist
- `warn` `variables read only by TS subcommands`: ts path `ts/schedules.ts` does not exist
- `warn` `send --interrupt`: ts path `ts/interruptSend.ts` does not exist
- `warn` `cron <cron> <target> <message> (add a reminder)`: ts path `ts/schedulesCli.ts` does not exist
- `warn` `cron <cron> <target> <message> (add a reminder)`: ts path `ts/schedules.ts` does not exist
- `warn` `cron ls`: ts path `ts/schedulesCli.ts` does not exist
- `warn` `cron ls`: ts path `ts/schedulesCli.ts` does not exist
- `warn` `cron rm`: ts path `ts/schedulesCli.ts` does not exist
- `warn` `schedules ls`: ts path `ts/schedulesCli.ts` does not exist
- `warn` `scheduler daemon loop (schedules daemon run)`: ts path `ts/schedulesCli.ts` does not exist
- `warn` `scheduler daemon loop (schedules daemon run)`: ts path `ts/schedules.ts` does not exist
- `warn` `scheduler daemon loop (schedules daemon run)`: ts path `ts/schedulesCli.ts` does not exist
- `warn` `schedules daemon install`: ts path `ts/schedulesCli.ts` does not exist
- `warn` `schedules daemon install`: ts path `ts/schedules.ts` does not exist
- `warn` `schedules daemon status`: ts path `ts/schedulesCli.ts` does not exist
- `warn` `schedule store, run state and run log files`: ts path `ts/schedules.ts` does not exist
- `warn` `schedule store, run state and run log files`: ts path `ts/schedules.ts` does not exist
- `warn` `schedule store, run state and run log files`: ts path `ts/schedules.ts` does not exist
- `warn` `schedule store, run state and run log files`: ts path `ts/schedules.ts` does not exist
- `warn` ledger was reconciled at `30116f1`, which this checkout does not have
- `todo` 326 feature(s) not fully ported

**Delivery**

- `info` crate `agent-yes` 1.303.1 builds: `agent-yes`, `ayrs`, `ay-spawn-hidden`
- `todo` no workflow uses the shared build pipeline (`snomiao/rustify/.github/workflows/rust-npm-build.yml`)
- `todo` `package.json` has no `rustify.bins` (which npm command runs which cargo bin)
- `info` crate `agent-yes` is not on crates.io (the name is free)
- `info` npm has `agent-yes` 1.308.4
- `warn` the newest release tag in this checkout is `v1.303.1-beta.794.1` — it is behind npm; fetch before trusting the code counts
- `info` Cargo.toml says 1.303.1 and package.json says 1.303.1; at release the workflow stamps one version into the binary and the package
- `todo` `bun i -g agent-yes` installs JavaScript, not the Rust binary (`agent-yes` → `dist/agent-yes.js`, `amp-yes` → `dist/amp-yes.js`, `auggie-yes` → `dist/auggie-yes.js`, … (21 commands))

## slack-hub

**Checkout**

- `info` `/code/snomiao/slack-hub/tree/main` on `main` at `e315b19`

**Code**

- `info` TypeScript/JS to replace: 20,388 lines in 41 files; its tests: 22,360 lines, about 1,440 cases
- `info` Rust: 826 lines in 2 files, 0 tests
- `info` `worker` stays TypeScript: Cloudflare Worker; undecided whether it moves to Rust
- `info` by file name, 40 of 41 TypeScript modules have no Rust module of the same name (19,031 lines). A rough signal only: Rust code is often organised differently. Largest: `ts/cli.ts` (8,919), `ts/stream.ts` (1,095), `ts/ask.ts` (870), `ts/auth.ts` (849), `ts/slack-app.ts` (572), `ts/todo.ts` (565), `ts/sentlog.ts` (494), `ts/format.ts` (480)

**Parity ledger**

- `info` 152 features: 0 verified, 1 ported but unproven, 19 partial, 132 missing, 0 dropped
- `ok  ` ledger is current (reconciled at `e315b19`, no TypeScript changed since)
- `todo` 151 feature(s) not fully ported

**Delivery**

- `info` crate `slack-cli` 0.2.0 builds: `slack`
- `todo` crate is named `slack-cli`; it should be `slack-hub`
- `todo` no workflow uses the shared build pipeline (`snomiao/rustify/.github/workflows/rust-npm-build.yml`)
- `todo` `package.json` has no `rustify.bins` (which npm command runs which cargo bin)
- `info` crate `slack-hub` is not on crates.io (the name is free)
- `info` npm has `slack-hub` 1.57.1
- `info` Cargo.toml says 0.2.0 and package.json says 1.8.0; at release the workflow stamps one version into the binary and the package
- `todo` `bun i -g slack-hub` installs JavaScript, not the Rust binary (`slack` → `ts/cli.ts`)

## rechrome

**Checkout**

- `info` `/code/snomiao/rechrome/tree/main` on `feat/share-allow-eval` at `fbe91bf`

**Code**

- `info` TypeScript/JS to replace: 10,694 lines in 18 files; its tests: 6,233 lines, about 429 cases
- `info` Rust: 0 lines in 0 files, 0 tests
- `info` `extension` stays TypeScript: browser extension; runs in Chrome
- `info` `functions` stays TypeScript: hosted functions; undecided
- `info` `signal` stays TypeScript: signaling worker; undecided

**Parity ledger**

- `todo` no ledger at `parity/rechrome.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `warn` `rs/Cargo.toml` is missing or unreadable
- `info` npm has `rechrome` 1.51.3
- `warn` the newest release tag in this checkout is `v1.50.0` — it is behind npm; fetch before trusting the code counts
- `todo` `bun i -g rechrome` installs JavaScript, not the Rust binary (`rech` → `rechrome.ts`, `rechrome` → `rechrome.ts`)

## otoji

**Checkout**

- `info` `/code/snomiao/otoji/tree/main` on `main` at `9982c23`

**Code**

- `info` TypeScript/JS to replace: 1,234 lines in 4 files; its tests: 0 lines, about 0 cases
- `info` Rust: 10,590 lines in 28 files, 24 tests
- `info` `web` stays TypeScript: browser app; out of scope until decided
- `info` by file name, 4 of 4 TypeScript modules have no Rust module of the same name (1,234 lines). A rough signal only: Rust code is often organised differently. Largest: `scripts/otoji-listen-qa.ts` (534), `signal/src/index.ts` (333), `cli/otoji-gdoc.mjs` (248), `cli/otoji-node.mjs` (119)

**Parity ledger**

- `todo` no ledger at `parity/otoji.toml`, so progress cannot be measured

**Delivery**

- `info` crate `otoji` 0.1.62 builds: `otoji`, `otoji-tray`
- `todo` no workflow uses the shared build pipeline (`snomiao/rustify/.github/workflows/rust-npm-build.yml`)
- `todo` `package.json` has no `rustify.bins` (which npm command runs which cargo bin)
- `ok  ` crates.io has `otoji` 0.1.62
- `info` npm has `otoji` 0.1.62
- `todo` `bun i -g otoji` installs JavaScript, not the Rust binary (`otoji` → `otoji-node.mjs`)

## codehost

**Checkout**

- `info` `/code/snomiao/codehost/tree/main` on `main` at `d3e1033`

**Code**

- `info` TypeScript/JS to replace: 10,512 lines in 68 files; its tests: 1,694 lines, about 147 cases
- `info` Rust: 0 lines in 0 files, 0 tests
- `info` `worker` stays TypeScript: Cloudflare Worker

**Parity ledger**

- `todo` no ledger at `parity/codehost.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `info` npm has `codehost` 0.40.0
- `warn` the newest release tag in this checkout is `v0.34.0` — it is behind npm; fetch before trusting the code counts
- `todo` `bun i -g codehost` installs JavaScript, not the Rust binary (`ch` → `src/cli/index.ts`, `codehost` → `src/cli/index.ts`)

## fbi-proxy

**Checkout**

- `info` `/code/snomiao/fbi-proxy/tree/main` on `main` at `549fd8a`

**Code**

- `info` TypeScript/JS to replace: 229 lines in 4 files; its tests: 0 lines, about 0 cases
- `info` Rust: 484 lines in 1 files, 0 tests
- `info` by file name, 4 of 4 TypeScript modules have no Rust module of the same name (229 lines). A rough signal only: Rust code is often organised differently. Largest: `ts/dSpawn.ts` (113), `ts/cli.ts` (57), `ts/buildFbiProxy.ts` (48), `ts/getProxyFilename.ts` (11)

**Parity ledger**

- `todo` no ledger at `parity/fbi-proxy.toml`, so progress cannot be measured

**Delivery**

- `info` crate `fbi-proxy` 0.1.1 builds: `fbi-proxy`
- `todo` no workflow uses the shared build pipeline (`snomiao/rustify/.github/workflows/rust-npm-build.yml`)
- `todo` `package.json` has no `rustify.bins` (which npm command runs which cargo bin)
- `ok  ` crates.io has `fbi-proxy` 1.18.0
- `info` npm has `fbi-proxy` 1.18.0
- `warn` the newest release tag in this checkout is `v1.7.0` — it is behind npm; fetch before trusting the code counts
- `info` Cargo.toml says 0.1.1 and package.json says 1.7.0; at release the workflow stamps one version into the binary and the package
- `todo` `bun i -g fbi-proxy` installs JavaScript, not the Rust binary (`fbi-proxy` → `dist/cli.js`)

## onenote-cli

**Checkout**

- `info` `/code/snomiao/onenote-cli/tree/main` on `main` at `9af05e1`

**Code**

- `info` TypeScript/JS to replace: 6,273 lines in 9 files; its tests: 0 lines, about 0 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/onenote-cli.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `warn` `onenote-cli` on crates.io belongs to another project (https://github.com/rvben/onenote-cli) — pick a different crate name
- `info` npm has `onenote-cli` 0.2.0
- `todo` `bun i -g onenote-cli` installs JavaScript, not the Rust binary (`onenote` → `src/index.ts`, `onenote-cli` → `src/index.ts`)

## dotenvdotenc

**Checkout**

- `info` `/code/snomiao/dotenvdotenc/tree/main` on `main` at `c566a04`

**Code**

- `info` TypeScript/JS to replace: 1,047 lines in 1 files; its tests: 1,271 lines, about 94 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/dotenvdotenc.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `info` npm has `dotenvdotenc` 0.4.0
- `warn` the newest release tag in this checkout is `v0.3.0` — it is behind npm; fetch before trusting the code counts
- `todo` `bun i -g dotenvdotenc` installs JavaScript, not the Rust binary (`dede` → `dede.ts`)

## qqdocs

**Checkout**

- `info` `/code/snomiao/qqdocs/tree/main` on `main` at `ea064c4`

**Code**

- `info` TypeScript/JS to replace: 2,191 lines in 4 files; its tests: 372 lines, about 32 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/qqdocs.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `info` npm has `qqdocs` 1.26.0
- `todo` `bun i -g qqdocs` installs JavaScript, not the Rust binary (`qqdoc` → `bin/qqdocs.ts`, `qqdocs` → `bin/qqdocs.ts`)

## winrpc
- `todo` no checkout found under `/code/snomiao/winrpc`

## chatwork-cli
- `todo` no checkout found under `/code/snomiao/chatwork-cli`

## genvx

**Checkout**

- `info` `/code/snomiao/genvx/tree/main` on `main` at `8809766`

**Code**

- `info` TypeScript/JS to replace: 1,512 lines in 3 files; its tests: 431 lines, about 12 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/genvx.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `info` npm has `genvx` 1.1.0
- `todo` `bun i -g genvx` installs JavaScript, not the Rust binary (`genvx` → `src/cli.ts`)

## rustdesk.skill
- `todo` no checkout found under `/code/snomiao/rustdesk.skill`

## wtx
- `todo` no checkout found under `/code/snomiao/wtx`

## gchat-cli

**Checkout**

- `info` `/code/snomiao/gchat-cli/tree/main` on `main` at `fd70e59`

**Code**

- `info` TypeScript/JS to replace: 868 lines in 11 files; its tests: 178 lines, about 18 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/gchat-cli.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `info` npm has `gchat-cli` 1.2.0
- `todo` `bun i -g gchat-cli` installs JavaScript, not the Rust binary (`gchat` → `ts/cli.ts`)

## Comfy-AI

**Checkout**

- `info` `/code/snomiao/Comfy-AI/tree/main` on `main` at `b677817`

**Code**

- `info` TypeScript/JS to replace: 418 lines in 6 files; its tests: 0 lines, about 0 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/Comfy-AI.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `info` npm has `comfy-ai` 1.2.2
- `warn` the newest release tag in this checkout is `v1.0.0` — it is behind npm; fetch before trusting the code counts
- `todo` `bun i -g comfy-ai` installs JavaScript, not the Rust binary (`comfy-ai` → `dist/cli.js`)

## bunto
- `todo` no checkout found under `/code/snomiao/bunto`

## snocommit

**Checkout**

- `info` `/code/snomiao/snocommit/tree/main` on `main` at `bf7735c`

**Code**

- `info` TypeScript/JS to replace: 136 lines in 5 files; its tests: 0 lines, about 0 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/snocommit.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `info` npm has `snocommit` 0.1.0
- `warn` the newest release tag in this checkout is `v1.0.2` — it is behind npm; fetch before trusting the code counts
- `todo` `bun i -g snocommit` installs JavaScript, not the Rust binary (`chore` → `dist/cli-chore.js`, `docs` → `dist/cli-docs.js`, `feat` → `dist/cli-feat.js`, … (7 commands))

## comfy-codesearch-cli
- `todo` no checkout found under `/code/snomiao/comfy-codesearch-cli`
