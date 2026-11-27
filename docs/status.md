# Rustify status

| Project | Port | `bun i -g` gives | Next step |
|---|---|---|---|
| agent-yes | 1 verified, 8 ported, 125 partial, 201 missing of 335 | JavaScript | port the missing features |
| slack-hub | 6 verified, 0 ported, 14 partial, 132 missing of 152 | JavaScript | port the missing features |
| rechrome | 0 verified, 0 ported, 0 partial, 328 missing of 328 | JavaScript | reconcile the parity ledger |
| otoji | started, not measured | JavaScript | write the parity ledger |
| codehost | 0 verified, 0 ported, 0 partial, 192 missing of 192 | JavaScript | port the missing features |
| fbi-proxy | started, not measured | JavaScript | write the parity ledger |
| onenote-cli | 6 verified, 0 ported, 3 partial, 46 missing of 55 | JavaScript | port the missing features |
| dotenvdotenc | not started | JavaScript | write the parity ledger |
| qqdocs | 20 verified, 2 ported, 2 partial, 27 missing of 51 | JavaScript | port the missing features |
| winrpc | not started | nothing (not on npm) | write the parity ledger |
| chatwork-cli | not started | nothing (not on npm) | write the parity ledger |
| genvx | 18 verified, 1 ported, 4 partial, 4 missing of 27 | JavaScript | port the missing features |
| rustdesk.skill | not started | nothing (not on npm) | write the parity ledger |
| wtx | not started | JavaScript | write the parity ledger |
| gchat-cli | 12 verified, 1 ported, 1 partial, 2 missing of 16 | JavaScript | reconcile the parity ledger |
| Comfy-AI | not started | JavaScript | write the parity ledger |
| bunto | not started | JavaScript | write the parity ledger |
| snocommit | not started | JavaScript | write the parity ledger |

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

- `info` 152 features: 6 verified, 0 ported but unproven, 14 partial, 132 missing, 0 dropped
- `warn` `news`: rs path `rs/src/news.rs` does not exist
- `warn` `news`: rs path `rs/src/msgfmt.rs` does not exist
- `warn` `news`: rs path `rs/src/cli.rs` does not exist
- `warn` `search <query>`: rs path `rs/src/search.rs` does not exist
- `warn` `search <query>`: rs path `rs/src/msgfmt.rs` does not exist
- `warn` `search <query>`: rs path `rs/src/config.rs` does not exist
- `warn` `search <query>`: rs path `rs/src/api.rs` does not exist
- `warn` `search --json`: rs path `rs/src/search.rs` does not exist
- `warn` `search --json`: rs path `rs/src/js.rs` does not exist
- `warn` `search: bot token falls back to a user-token profile of the same workspace`: rs path `rs/src/search.rs` does not exist
- `warn` `search: bot token falls back to a user-token profile of the same workspace`: rs path `rs/src/config.rs` does not exist
- `warn` `message line format (timestamps, author, multi-line text)`: rs path `rs/src/msgfmt.rs` does not exist
- `warn` `reactions, files and forwarded messages in read output`: rs path `rs/src/msgfmt.rs` does not exist
- `warn` `<@U…> mentions shown as @name`: rs path `rs/src/msgfmt.rs` does not exist
- `warn` `<!date^…> markup shown as a date`: rs path `rs/src/msgfmt.rs` does not exist
- `warn` `line breaks restored in messages Slack stored flattened`: rs path `rs/src/newlines.rs` does not exist
- `warn` `token resolution order`: rs path `rs/src/config.rs` does not exist
- `warn` `dotenv files`: rs path `rs/src/config.rs` does not exist
- `warn` `-w / --workspace`: rs path `rs/src/search.rs` does not exist
- `warn` `-w / --workspace`: rs path `rs/src/config.rs` does not exist
- `warn` `profiles.json (several workspaces; one cookie shared per identity; mode 0600)`: rs path `rs/src/config.rs` does not exist
- `warn` `desktop session tokens (xoxc-) with the xoxd cookie`: rs path `rs/src/api.rs` does not exist
- `warn` `desktop session tokens (xoxc-) with the xoxd cookie`: rs path `rs/src/config.rs` does not exist
- `warn` `SLACK_API_BASE`: rs path `rs/src/api.rs` does not exist
- `warn` `rate-limit waiting (HTTP 429 / ratelimited; SLACK_RATELIMIT_WAIT_SEC)`: rs path `rs/src/api.rs` does not exist
- `warn` `error messages and exit codes`: rs path `rs/src/api.rs` does not exist
- `warn` `error messages and exit codes`: rs path `rs/src/search.rs` does not exist
- `warn` `complete output on a pipe; exit 141 when the reader goes away`: rs path `rs/src/out.rs` does not exist
- `warn` `lookup cache (~/.config/slack-cli/cache.json; --no-cache on todo / mytodo)`: rs path `rs/src/cache.rs` does not exist
- `warn` `legacy slack-term names still read (SLACK_TERM_* variables, .slack-term/ and slack-term config dirs)`: rs path `rs/src/config.rs` does not exist
- `ok  ` ledger is current (reconciled at `e315b19`, no TypeScript changed since)
- `todo` 146 feature(s) not fully ported

**Delivery**

- `info` crate `slack-cli` 0.2.0 builds: `slack`
- `todo` crate is named `slack-cli`; it should be `slack-hub`
- `warn` `publishConfig.bin` differs from `bin`, and npm does not apply it when publishing: the published command is what `bin` names. The hand-back must go there too
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

- `info` 328 features: 0 verified, 0 ported but unproven, 0 partial, 328 missing, 0 dropped
- `warn` `rech fill-secret | read-secret | read-storage | read-cookie | read-headers | upload | audio --help / -h (fixed usage texts)`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio: usage text, one JSON result line, or one fixed failure line with exit 1`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio: usage text, one JSON result line, or one fixed failure line with exit 1`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio: usage text, one JSON result line, or one fixed failure line with exit 1`: ts path `audio-bridge-client.ts` does not exist
- `warn` `audio argument grammar and the path-free wire form`: ts path `audio-bridge.ts` does not exist
- `warn` `audio argument grammar and the path-free wire form`: ts path `audio-bridge.ts` does not exist
- `warn` `audio argument grammar and the path-free wire form`: ts path `audio-bridge.ts` does not exist
- `warn` `audio argument grammar and the path-free wire form`: ts path `audio-bridge.ts` does not exist
- `warn` `audio argument grammar and the path-free wire form`: ts path `audio-bridge.ts` does not exist
- `warn` `audio argument grammar and the path-free wire form`: ts path `audio-bridge.ts` does not exist
- `warn` `audio argument grammar and the path-free wire form`: ts path `audio-bridge-client.ts` does not exist
- `warn` `audio argument grammar and the path-free wire form`: ts path `audio-bridge-server.ts` does not exist
- `warn` `rech audio install <url> [--capture] [--max-seconds 1..60]`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio install <url> [--capture] [--max-seconds 1..60]`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio install <url> [--capture] [--max-seconds 1..60]`: ts path `audio-bridge-server.ts` does not exist
- `warn` `rech audio install <url> [--capture] [--max-seconds 1..60]`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `audio install URL rule: https, or http on exact loopback`: ts path `audio-bridge.ts` does not exist
- `warn` `audio install URL rule: https, or http on exact loopback`: ts path `audio-bridge.ts` does not exist
- `warn` `audio install URL rule: https, or http on exact loopback`: ts path `audio-bridge.ts` does not exist
- `warn` `audio install URL rule: https, or http on exact loopback`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio status`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio status`: ts path `audio-bridge-server.ts` does not exist
- `warn` `rech audio status`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio status`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio status`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `audio status fields and the 14 `unsupported` codes`: ts path `audio-bridge.ts` does not exist
- `warn` `audio status fields and the 14 `unsupported` codes`: ts path `audio-bridge.ts` does not exist
- `warn` `audio status fields and the 14 `unsupported` codes`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `audio status fields and the 14 `unsupported` codes`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `audio status fields and the 14 `unsupported` codes`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `rech audio feed <wav-file>`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio feed <wav-file>`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio feed <wav-file>`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio feed <wav-file>`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio feed <wav-file>`: ts path `audio-bridge-server.ts` does not exist
- `warn` `rech audio feed <wav-file>`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `PCM WAV admission (client and daemon)`: ts path `audio-bridge.ts` does not exist
- `warn` `PCM WAV admission (client and daemon)`: ts path `audio-bridge.ts` does not exist
- `warn` `PCM WAV admission (client and daemon)`: ts path `audio-bridge.ts` does not exist
- `warn` `PCM WAV admission (client and daemon)`: ts path `audio-bridge-client.ts` does not exist
- `warn` `PCM WAV admission (client and daemon)`: ts path `audio-bridge-server.ts` does not exist
- `warn` `PCM WAV admission (client and daemon)`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio capture start`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio capture start`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio capture start`: ts path `audio-bridge-server.ts` does not exist
- `warn` `rech audio capture start`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `rech audio drain --dir <client-dir>`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio drain --dir <client-dir>`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio drain --dir <client-dir>`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio drain --dir <client-dir>`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio drain --dir <client-dir>`: ts path `audio-bridge-server.ts` does not exist
- `warn` `rech audio drain --dir <client-dir>`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `rech audio drain --dir <client-dir>`: ts path `audio-bridge-files.ts` does not exist
- `warn` `rech audio stop [--dir <client-dir>]`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio stop [--dir <client-dir>]`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio stop [--dir <client-dir>]`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio stop [--dir <client-dir>]`: ts path `audio-bridge-client.ts` does not exist
- `warn` `rech audio stop [--dir <client-dir>]`: ts path `audio-bridge-server.ts` does not exist
- `warn` `rech audio stop [--dir <client-dir>]`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `rech audio stop [--dir <client-dir>]`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `captured audio files: <dir>/<bridge id>/s-<n>.webm, manifest.json, .write-lock`: ts path `audio-bridge-files.ts` does not exist
- `warn` `captured audio files: <dir>/<bridge id>/s-<n>.webm, manifest.json, .write-lock`: ts path `audio-bridge-files.ts` does not exist
- `warn` `captured audio files: <dir>/<bridge id>/s-<n>.webm, manifest.json, .write-lock`: ts path `audio-bridge-files.ts` does not exist
- `warn` `captured audio files: <dir>/<bridge id>/s-<n>.webm, manifest.json, .write-lock`: ts path `audio-bridge-files.ts` does not exist
- `warn` `captured audio files: <dir>/<bridge id>/s-<n>.webm, manifest.json, .write-lock`: ts path `audio-bridge-files.ts` does not exist
- `warn` `captured audio files: <dir>/<bridge id>/s-<n>.webm, manifest.json, .write-lock`: ts path `audio-bridge-files.ts` does not exist
- `warn` `saving captured audio is retryable: receipt digest, sequence check, partial-write recovery, single writer`: ts path `audio-bridge-files.ts` does not exist
- `warn` `saving captured audio is retryable: receipt digest, sequence check, partial-write recovery, single writer`: ts path `audio-bridge-files.ts` does not exist
- `warn` `saving captured audio is retryable: receipt digest, sequence check, partial-write recovery, single writer`: ts path `audio-bridge-files.ts` does not exist
- `warn` `saving captured audio is retryable: receipt digest, sequence check, partial-write recovery, single writer`: ts path `audio-bridge-files.ts` does not exist
- `warn` `saving captured audio is retryable: receipt digest, sequence check, partial-write recovery, single writer`: ts path `audio-bridge-files.ts` does not exist
- `warn` `saving captured audio is retryable: receipt digest, sequence check, partial-write recovery, single writer`: ts path `audio-bridge-files.ts` does not exist
- `warn` `saving captured audio is retryable: receipt digest, sequence check, partial-write recovery, single writer`: ts path `audio-bridge-files.ts` does not exist
- `warn` `audio privacy rule: no path, URL, audio byte or page text in arguments, logs, stdout or error messages`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio privacy rule: no path, URL, audio byte or page text in arguments, logs, stdout or error messages`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio privacy rule: no path, URL, audio byte or page text in arguments, logs, stdout or error messages`: ts path `audio-bridge-client.ts` does not exist
- `warn` `audio privacy rule: no path, URL, audio byte or page text in arguments, logs, stdout or error messages`: ts path `audio-bridge-client.ts` does not exist
- `warn` `audio privacy rule: no path, URL, audio byte or page text in arguments, logs, stdout or error messages`: ts path `audio-bridge.ts` does not exist
- `warn` `audio privacy rule: no path, URL, audio byte or page text in arguments, logs, stdout or error messages`: ts path `audio-bridge.ts` does not exist
- `warn` `audio on the wire: `upload` in the /run body, `audioOut` in the reply, and the wire-only `audio ack <receipt>``: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the wire: `upload` in the /run body, `audioOut` in the reply, and the wire-only `audio ack <receipt>``: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the wire: `upload` in the /run body, `audioOut` in the reply, and the wire-only `audio ack <receipt>``: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the wire: `upload` in the /run body, `audioOut` in the reply, and the wire-only `audio ack <receipt>``: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the wire: `upload` in the /run body, `audioOut` in the reply, and the wire-only `audio ack <receipt>``: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the wire: `upload` in the /run body, `audioOut` in the reply, and the wire-only `audio ack <receipt>``: ts path `audio-bridge-client.ts` does not exist
- `warn` `audio on the wire: `upload` in the /run body, `audioOut` in the reply, and the wire-only `audio ack <receipt>``: ts path `audio-bridge-client.ts` does not exist
- `warn` `audio on the wire: `upload` in the /run body, `audioOut` in the reply, and the wire-only `audio ack <receipt>``: ts path `audio-bridge-client.ts` does not exist
- `warn` `audio on the daemon: one bridge per session, generation and origin fencing, retirement, 8 sessions, serialized requests`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the daemon: one bridge per session, generation and origin fencing, retirement, 8 sessions, serialized requests`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the daemon: one bridge per session, generation and origin fencing, retirement, 8 sessions, serialized requests`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the daemon: one bridge per session, generation and origin fencing, retirement, 8 sessions, serialized requests`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the daemon: one bridge per session, generation and origin fencing, retirement, 8 sessions, serialized requests`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the daemon: one bridge per session, generation and origin fencing, retirement, 8 sessions, serialized requests`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio on the daemon: one bridge per session, generation and origin fencing, retirement, 8 sessions, serialized requests`: ts path `docs/audio-duplex.md` does not exist
- `warn` `drained audio is kept on the daemon until the client acknowledges its receipt`: ts path `audio-bridge-server.ts` does not exist
- `warn` `drained audio is kept on the daemon until the client acknowledges its receipt`: ts path `audio-bridge-server.ts` does not exist
- `warn` `drained audio is kept on the daemon until the client acknowledges its receipt`: ts path `audio-bridge-server.ts` does not exist
- `warn` `bounded browser results: how the daemon reads what the page returned`: ts path `audio-bridge.ts` does not exist
- `warn` `bounded browser results: how the daemon reads what the page returned`: ts path `audio-bridge.ts` does not exist
- `warn` `bounded browser results: how the daemon reads what the page returned`: ts path `audio-bridge.ts` does not exist
- `warn` `bounded browser results: how the daemon reads what the page returned`: ts path `audio-bridge.ts` does not exist
- `warn` `bounded browser results: how the daemon reads what the page returned`: ts path `audio-bridge.ts` does not exist
- `warn` `bounded browser results: how the daemon reads what the page returned`: ts path `audio-bridge-server.ts` does not exist
- `warn` `bounded browser results: how the daemon reads what the page returned`: ts path `audio-bridge-files.ts` does not exist
- `warn` `the two fixed run-code programs the daemon sends to the browser for audio (install, action)`: ts path `audio-bridge.ts` does not exist
- `warn` `the two fixed run-code programs the daemon sends to the browser for audio (install, action)`: ts path `audio-bridge.ts` does not exist
- `warn` `the two fixed run-code programs the daemon sends to the browser for audio (install, action)`: ts path `audio-bridge.ts` does not exist
- `warn` `the two fixed run-code programs the daemon sends to the browser for audio (install, action)`: ts path `audio-bridge-server.ts` does not exist
- `warn` `the two fixed run-code programs the daemon sends to the browser for audio (install, action)`: ts path `audio-bridge-server.ts` does not exist
- `warn` `rech audio stream --source <id> --destination <id> [--rate 16000|48000] [--channels 1|2] [--max-seconds 1..300]`: ts path `audio-stream-client.ts` does not exist
- `warn` `rech audio stream --source <id> --destination <id> [--rate 16000|48000] [--channels 1|2] [--max-seconds 1..300]`: ts path `audio-stream-client.ts` does not exist
- `warn` `rech audio stream --source <id> --destination <id> [--rate 16000|48000] [--channels 1|2] [--max-seconds 1..300]`: ts path `audio-stream.ts` does not exist
- `warn` `rech audio stream --source <id> --destination <id> [--rate 16000|48000] [--channels 1|2] [--max-seconds 1..300]`: ts path `audio-bridge.ts` does not exist
- `warn` `audio stream stdin/stdout contract (raw s16le frames, one stderr line, exit codes)`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream stdin/stdout contract (raw s16le frames, one stderr line, exit codes)`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream stdin/stdout contract (raw s16le frames, one stderr line, exit codes)`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream stdin/stdout contract (raw s16le frames, one stderr line, exit codes)`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream stdin/stdout contract (raw s16le frames, one stderr line, exit codes)`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream stdin/stdout contract (raw s16le frames, one stderr line, exit codes)`: ts path `docs/audio-duplex.md` does not exist
- `warn` `rech audio stream ticket --source <id> --destination <id> [--client-origin <origin>] --ticket-file <path>`: ts path `audio-stream-client.ts` does not exist
- `warn` `rech audio stream ticket --source <id> --destination <id> [--client-origin <origin>] --ticket-file <path>`: ts path `audio-stream-client.ts` does not exist
- `warn` `rech audio stream ticket --source <id> --destination <id> [--client-origin <origin>] --ticket-file <path>`: ts path `audio-stream-client.ts` does not exist
- `warn` `rech audio stream ticket --source <id> --destination <id> [--client-origin <origin>] --ticket-file <path>`: ts path `audio-stream-client.ts` does not exist
- `warn` `rech audio stream ticket --source <id> --destination <id> [--client-origin <origin>] --ticket-file <path>`: ts path `audio-stream.ts` does not exist
- `warn` `rech audio stream ticket --source <id> --destination <id> [--client-origin <origin>] --ticket-file <path>`: ts path `audio-bridge.ts` does not exist
- `warn` `rech audio stream ticket --source <id> --destination <id> [--client-origin <origin>] --ticket-file <path>`: ts path `docs/audio-duplex.md` does not exist
- `warn` `rech audio stream stop`: ts path `audio-stream-client.ts` does not exist
- `warn` `rech audio stream stop`: ts path `audio-bridge-server.ts` does not exist
- `warn` `rech audio stream stop`: ts path `audio-bridge.ts` does not exist
- `warn` `audio stream options and the `audio stream open` wire command (checked on the client and again on the daemon)`: ts path `audio-stream.ts` does not exist
- `warn` `audio stream options and the `audio stream open` wire command (checked on the client and again on the daemon)`: ts path `audio-stream.ts` does not exist
- `warn` `audio stream options and the `audio stream open` wire command (checked on the client and again on the daemon)`: ts path `audio-stream.ts` does not exist
- `warn` `audio stream options and the `audio stream open` wire command (checked on the client and again on the daemon)`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream options and the `audio stream open` wire command (checked on the client and again on the daemon)`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio stream ticket JSON (version 1) and the `audioStream` field of the /run reply`: ts path `audio-stream.ts` does not exist
- `warn` `audio stream ticket JSON (version 1) and the `audioStream` field of the /run reply`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream ticket JSON (version 1) and the `audioStream` field of the /run reply`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio stream ticket JSON (version 1) and the `audioStream` field of the /run reply`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream ticket JSON (version 1) and the `audioStream` field of the /run reply`: ts path `docs/audio-duplex.md` does not exist
- `warn` `audio stream client on the socket (connectPcmStream): hello, credit, ordered output acknowledgement, end reasons`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream client on the socket (connectPcmStream): hello, credit, ordered output acknowledgement, end reasons`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream client on the socket (connectPcmStream): hello, credit, ordered output acknowledgement, end reasons`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream client on the socket (connectPcmStream): hello, credit, ordered output acknowledgement, end reasons`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream client on the socket (connectPcmStream): hello, credit, ordered output acknowledgement, end reasons`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream client on the socket (connectPcmStream): hello, credit, ordered output acknowledgement, end reasons`: ts path `audio-stream-client.ts` does not exist
- `warn` `audio stream on the daemon: `audio stream open` and `audio stream stop` on /run, admitted against the bridge's state`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio stream on the daemon: `audio stream open` and `audio stream stop` on /run, admitted against the bridge's state`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio stream on the daemon: `audio stream open` and `audio stream stop` on /run, admitted against the bridge's state`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio stream on the daemon: `audio stream open` and `audio stream stop` on /run, admitted against the bridge's state`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio stream on the daemon: `audio stream open` and `audio stream stop` on /run, admitted against the bridge's state`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio stream on the daemon: `audio stream open` and `audio stream stop` on /run, admitted against the bridge's state`: ts path `audio-bridge-server.ts` does not exist
- `warn` `audio stream on the daemon: `audio stream open` and `audio stream stop` on /run, admitted against the bridge's state`: ts path `audio-stream.ts` does not exist
- `warn` `audio stream gateway (a loopback server per stream: one-use capability, time limits, stop reasons)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream gateway (a loopback server per stream: one-use capability, time limits, stop reasons)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream gateway (a loopback server per stream: one-use capability, time limits, stop reasons)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream gateway (a loopback server per stream: one-use capability, time limits, stop reasons)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream gateway (a loopback server per stream: one-use capability, time limits, stop reasons)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream WebSocket endpoint ws://127.0.0.1:<port>/stream (PCM duplex v1, what a client program speaks)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream WebSocket endpoint ws://127.0.0.1:<port>/stream (PCM duplex v1, what a client program speaks)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream WebSocket endpoint ws://127.0.0.1:<port>/stream (PCM duplex v1, what a client program speaks)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream WebSocket endpoint ws://127.0.0.1:<port>/stream (PCM duplex v1, what a client program speaks)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream WebSocket endpoint ws://127.0.0.1:<port>/stream (PCM duplex v1, what a client program speaks)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream WebSocket endpoint ws://127.0.0.1:<port>/stream (PCM duplex v1, what a client program speaks)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream WebSocket endpoint ws://127.0.0.1:<port>/stream (PCM duplex v1, what a client program speaks)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream WebSocket endpoint ws://127.0.0.1:<port>/stream (PCM duplex v1, what a client program speaks)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream WebSocket endpoint ws://127.0.0.1:<port>/stream (PCM duplex v1, what a client program speaks)`: ts path `docs/audio-duplex.md` does not exist
- `warn` `audio stream relay routes on the gateway (/start, /input, /ack, /ended, /output, /close, with the relay key)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream relay routes on the gateway (/start, /input, /ack, /ended, /output, /close, with the relay key)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream relay routes on the gateway (/start, /input, /ack, /ended, /output, /close, with the relay key)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream relay routes on the gateway (/start, /input, /ack, /ended, /output, /close, with the relay key)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream relay routes on the gateway (/start, /input, /ack, /ended, /output, /close, with the relay key)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream relay routes on the gateway (/start, /input, /ack, /ended, /output, /close, with the relay key)`: ts path `audio-stream-server.ts` does not exist
- `warn` `audio stream relay routes on the gateway (/start, /input, /ack, /ended, /output, /close, with the relay key)`: ts path `audio-stream-server.ts` does not exist
- `warn` `page relay for audio stream (generated JavaScript, run in the session through run-code)`: ts path `audio-stream-server.ts` does not exist
- `warn` `page relay for audio stream (generated JavaScript, run in the session through run-code)`: ts path `audio-bridge-server.ts` does not exist
- `warn` `stop confirmation after a stream decides whether the bridge may be installed again`: ts path `audio-stream-server.ts` does not exist
- `warn` `stop confirmation after a stream decides whether the bridge may be installed again`: ts path `audio-bridge-server.ts` does not exist
- `warn` `stop confirmation after a stream decides whether the bridge may be installed again`: ts path `audio-bridge-server.ts` does not exist
- `warn` `in-page audio bridge: `window.__rechAudioBridge`, generation id, origin pin, limits`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `in-page audio bridge: `window.__rechAudioBridge`, generation id, origin pin, limits`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `in-page audio bridge: `window.__rechAudioBridge`, generation id, origin pin, limits`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `in-page audio bridge: `window.__rechAudioBridge`, generation id, origin pin, limits`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `in-page audio bridge: `window.__rechAudioBridge`, generation id, origin pin, limits`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `in-page audio bridge: `window.__rechAudioBridge`, generation id, origin pin, limits`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `in-page audio bridge: `window.__rechAudioBridge`, generation id, origin pin, limits`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `in-page audio bridge: `window.__rechAudioBridge`, generation id, origin pin, limits`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `in-page audio bridge: `window.__rechAudioBridge`, generation id, origin pin, limits`: ts path `audio-bridge.ts` does not exist
- `warn` `virtual microphone: getUserMedia answered with the bridge's own audio track, never the physical microphone`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `virtual microphone: getUserMedia answered with the bridge's own audio track, never the physical microphone`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `virtual microphone: getUserMedia answered with the bridge's own audio track, never the physical microphone`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `virtual microphone: getUserMedia answered with the bridge's own audio track, never the physical microphone`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: Web Audio connections to the speakers are redirected to a capture sink`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: Web Audio connections to the speakers are redirected to a capture sink`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: Web Audio connections to the speakers are redirected to a capture sink`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: audio and video elements are held muted and play() is routed through the capture graph; DRM media refused`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: audio and video elements are held muted and play() is routed through the capture graph; DRM media refused`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: audio and video elements are held muted and play() is routed through the capture graph; DRM media refused`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: audio and video elements are held muted and play() is routed through the capture graph; DRM media refused`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: audio and video elements are held muted and play() is routed through the capture graph; DRM media refused`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: audio and video elements are held muted and play() is routed through the capture graph; DRM media refused`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `silent output: audio and video elements are held muted and play() is routed through the capture graph; DRM media refused`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `capture inside the page: WebM/Opus recorders, 250 ms fragments, a 2 MiB budget, ordered drains, automatic stop`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `capture inside the page: WebM/Opus recorders, 250 ms fragments, a 2 MiB budget, ordered drains, automatic stop`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `capture inside the page: WebM/Opus recorders, 250 ms fragments, a 2 MiB budget, ordered drains, automatic stop`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `capture inside the page: WebM/Opus recorders, 250 ms fragments, a 2 MiB budget, ordered drains, automatic stop`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `input inside the page: WAV decode and gapless queue into the virtual microphone`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `input inside the page: WAV decode and gapless queue into the virtual microphone`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `input inside the page: WAV decode and gapless queue into the virtual microphone`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `stop and failure inside the page: fail closed, final data kept, guards stay`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `stop and failure inside the page: fail closed, final data kept, guards stay`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `stop and failure inside the page: fail closed, final data kept, guards stay`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `PCM hooks of the in-page bridge (used by `rech audio stream`): startPcm, feedPcm, endPcmInput, readPcm`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `PCM hooks of the in-page bridge (used by `rech audio stream`): startPcm, feedPcm, endPcmInput, readPcm`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `PCM hooks of the in-page bridge (used by `rech audio stream`): startPcm, feedPcm, endPcmInput, readPcm`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `PCM hooks of the in-page bridge (used by `rech audio stream`): startPcm, feedPcm, endPcmInput, readPcm`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `PCM hooks of the in-page bridge (used by `rech audio stream`): startPcm, feedPcm, endPcmInput, readPcm`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `PCM hooks of the in-page bridge (used by `rech audio stream`): startPcm, feedPcm, endPcmInput, readPcm`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `PCM hooks of the in-page bridge (used by `rech audio stream`): startPcm, feedPcm, endPcmInput, readPcm`: ts path `audio-bridge-browser.ts` does not exist
- `warn` `PCM hooks of the in-page bridge (used by `rech audio stream`): startPcm, feedPcm, endPcmInput, readPcm`: ts path `audio-stream-server.ts` does not exist
- `warn` `Windows: warning when serve runs outside the user's active desktop session`: ts path `docs/windows-sessions.md` does not exist
- `todo` 16 file(s) of the TypeScript changed since the ledger was reconciled at `c4ef27e`: `audio-bridge-browser.ts`, `audio-bridge-client.ts`, `audio-bridge-files.ts`, `audio-bridge-server.ts`, `audio-bridge.ts`, `audio-stream-client.ts`, `audio-stream-server.ts`, `audio-stream.ts`, `daemon-manager.ts`, `rechrome.ts`
- `todo` 328 feature(s) not fully ported
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

- `info` `/code/snomiao/codehost/tree/main` on `main` at `cfba919`

**Code**

- `info` TypeScript/JS to replace: 7,230 lines in 57 files; its tests: 1,877 lines, about 164 cases
- `info` Rust: 0 lines in 0 files, 0 tests
- `info` `src/App.tsx` stays TypeScript: legacy web terminal page; runs in a browser
- `info` `src/components` stays TypeScript: legacy web terminal page (xterm.js); runs in a browser
- `info` `src/main.tsx` stays TypeScript: page entry; runs in a browser
- `info` `src/web` stays TypeScript: the codehost.dev page, its Service Worker and SharedWorker; runs in a browser
- `info` `worker` stays TypeScript: Cloudflare Worker (signaling room, /cdn proxy); the daemon only talks to it

**Parity ledger**

- `info` 192 features: 0 verified, 0 ported but unproven, 0 partial, 192 missing, 0 dropped
- `ok  ` ledger is current (reconciled at `cfba919`, no TypeScript changed since)
- `todo` 192 feature(s) not fully ported
- `todo` no Rust port exists yet

**Delivery**

- `warn` `rs/Cargo.toml` is missing or unreadable
- `info` npm has `codehost` 0.40.0
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

- `info` 55 features: 6 verified, 0 ported but unproven, 3 partial, 46 missing, 0 dropped
- `warn` `search <query> (local index, on Linux)`: proof `rs/parity.json` does not exist
- `warn` `search <query> (local index, on Linux)`: rs path `rs/src/search.rs` does not exist
- `warn` `search <query> (local index, on Linux)`: rs path `rs/src/main.rs` does not exist
- `warn` `search on macOS and Windows`: rs path `rs/src/main.rs` does not exist
- `warn` `search query language (#tag, tag:name, AND / OR / NOT, quotes)`: proof `rs/parity.json` does not exist
- `warn` `search query language (#tag, tag:name, AND / OR / NOT, quotes)`: rs path `rs/src/query.rs` does not exist
- `warn` `search query language (#tag, tag:name, AND / OR / NOT, quotes)`: rs path `rs/src/search.rs` does not exist
- `warn` `search output on a terminal (colours, clickable titles)`: proof `rs/parity.json` does not exist
- `warn` `search output on a terminal (colours, clickable titles)`: proof `rs/parity/terminal.py` does not exist
- `warn` `search output on a terminal (colours, clickable titles)`: rs path `rs/src/search.rs` does not exist
- `warn` `search output on a terminal (colours, clickable titles)`: rs path `rs/src/main.rs` does not exist
- `warn` `search index: reading .onenote/search.db`: proof `rs/parity.json` does not exist
- `warn` `search index: reading .onenote/search.db`: rs path `rs/src/search.rs` does not exist
- `warn` `search: the time of the last sync, and --since (time zone named in TZ)`: proof `rs/src/time.rs` does not exist
- `warn` `search: the time of the last sync, and --since (time zone named in TZ)`: proof `rs/parity.json` does not exist
- `warn` `search: the time of the last sync, and --since (time zone named in TZ)`: rs path `rs/src/time.rs` does not exist
- `warn` `search: the system's time zone (no TZ in the environment)`: rs path `rs/src/time.rs` does not exist
- `warn` `auth setup`: proof `rs/parity.json` does not exist
- `warn` `auth setup`: rs path `rs/src/main.rs` does not exist
- `warn` `auth setup`: rs path `rs/src/auth_setup.txt` does not exist
- `warn` `search: rows a sync does not write`: rs path `rs/src/search.rs` does not exist
- `warn` `search: rows a sync does not write`: rs path `rs/src/time.rs` does not exist
- `warn` `search: machine states that go back`: rs path `rs/src/runtime.rs` does not exist
- `warn` `search: machine states that go back`: rs path `rs/src/time.rs` does not exist
- `warn` `search: machine states that go back`: rs path `rs/src/main.rs` does not exist
- `ok  ` ledger is current (reconciled at `9af05e1`, no TypeScript changed since)
- `todo` 49 feature(s) not fully ported
- `todo` no Rust port exists yet

**Delivery**

- `warn` `rs/Cargo.toml` is missing or unreadable
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

- `warn` `rs/Cargo.toml` is missing or unreadable
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

- `info` 51 features: 20 verified, 2 ported but unproven, 2 partial, 27 missing, 0 dropped
- `warn` `tools [pattern]`: proof `rs/parity.json` does not exist
- `warn` `tools [pattern]`: rs path `rs/src/commands/tools.rs` does not exist
- `warn` `raw <tool> [--json], for the tools that read`: proof `rs/parity.json` does not exist
- `warn` `raw <tool> [--json], for the tools that read`: rs path `rs/src/commands/raw.rs` does not exist
- `warn` `ls / list [folder], in a pipe or a file`: proof `rs/parity.json` does not exist
- `warn` `ls / list [folder], in a pipe or a file`: rs path `rs/src/commands/ls.rs` does not exist
- `warn` `search <query>`: proof `rs/parity.json` does not exist
- `warn` `search <query>`: rs path `rs/src/commands/search.rs` does not exist
- `warn` `read <ref>, with the five-minute document cache`: proof `rs/parity.json` does not exist
- `warn` `read <ref>, with the five-minute document cache`: rs path `rs/src/commands/read.rs` does not exist
- `warn` `info <ref>`: proof `rs/parity.json` does not exist
- `warn` `info <ref>`: rs path `rs/src/commands/info.rs` does not exist
- `warn` `info <ref>`: rs path `rs/src/commands/mod.rs` does not exist
- `warn` `perm get <ref>`: proof `rs/parity.json` does not exist
- `warn` `perm get <ref>`: rs path `rs/src/commands/perm.rs` does not exist
- `warn` `space list`: proof `rs/parity.json` does not exist
- `warn` `space list`: rs path `rs/src/commands/space.rs` does not exist
- `warn` `space ls <space>`: proof `rs/parity.json` does not exist
- `warn` `space ls <space>`: rs path `rs/src/commands/space.rs` does not exist
- `warn` `canvas read <ref>`: proof `rs/parity.json` does not exist
- `warn` `canvas read <ref>`: rs path `rs/src/commands/canvas.rs` does not exist
- `warn` `canvas find <ref> <query>`: proof `rs/parity.json` does not exist
- `warn` `canvas find <ref> <query>`: rs path `rs/src/commands/canvas.rs` does not exist
- `warn` `sync`: proof `rs/parity.json` does not exist
- `warn` `sync`: rs path `rs/src/commands/sync.rs` does not exist
- `warn` `usage [--tier]`: proof `rs/parity.json` does not exist
- `warn` `usage [--tier]`: rs path `rs/src/commands/usage.rs` does not exist
- `warn` `usage [--tier]`: rs path `rs/src/usage.rs` does not exist
- `warn` `usage calibrate`: proof `rs/parity.json` does not exist
- `warn` `usage calibrate`: rs path `rs/src/commands/usage.rs` does not exist
- `warn` `usage calibrate`: rs path `rs/src/usage.rs` does not exist
- `warn` `--help, --version, completion, usage errors, and the word `help``: rs path `rs/src/args.rs` does not exist
- `warn` `--help, --version, completion, usage errors, and the word `help``: rs path `rs/src/commands/mod.rs` does not exist
- `warn` `the MCP call: one JSON-RPC POST per call, the answer from structuredContent or content[0].text`: proof `rs/parity.json` does not exist
- `warn` `the MCP call: one JSON-RPC POST per call, the answer from structuredContent or content[0].text`: rs path `rs/src/mcp.rs` does not exist
- `warn` `errors from the service, and trying again with a back-off`: rs path `rs/src/mcp.rs` does not exist
- `warn` `answers of another shape than the TypeScript was written for`: rs path `rs/src/commands/mod.rs` does not exist
- `warn` `answers of another shape than the TypeScript was written for`: rs path `rs/src/json.rs` does not exist
- `warn` `the token: TENCENT_DOCS_TOKEN, .env files in the current directory, ~/.qqdocs/.env.local`: proof `rs/parity.json` does not exist
- `warn` `the token: TENCENT_DOCS_TOKEN, .env files in the current directory, ~/.qqdocs/.env.local`: rs path `rs/src/env.rs` does not exist
- `warn` `a .env file in syntax bun interprets, or one that steers bun`: rs path `rs/src/env.rs` does not exist
- `warn` `a token in .env.local beside the package or in the two directories above it`: rs path `rs/src/env.rs` does not exist
- `warn` `a directory inside a JavaScript project: package.json, tsconfig.json, jsconfig.json here or above`: rs path `rs/src/env.rs` does not exist
- `warn` `config.yaml: the tier`: proof `rs/parity.json` does not exist
- `warn` `config.yaml: the tier`: rs path `rs/src/env.rs` does not exist
- `warn` `config.yaml beyond plain `key: value` lines`: rs path `rs/src/env.rs` does not exist
- `warn` `the call counter: ~/.qqdocs/usage.json, its lock, the inferred tier`: proof `rs/parity.json` does not exist
- `warn` `the call counter: ~/.qqdocs/usage.json, its lock, the inferred tier`: rs path `rs/src/usage.rs` does not exist
- `warn` `the call counter: ~/.qqdocs/usage.json, its lock, the inferred tier`: rs path `rs/src/clock.rs` does not exist
- `warn` `the call counter: ~/.qqdocs/usage.json, its lock, the inferred tier`: rs path `rs/src/env.rs` does not exist
- `warn` `the local day in a zone that is not UTC: every zone named after a place`: rs path `rs/src/env.rs` does not exist
- `warn` `the quota warning after a command`: proof `rs/parity.json` does not exist
- `warn` `the quota warning after a command`: rs path `rs/src/usage.rs` does not exist
- `warn` `the quota warning after a command`: rs path `rs/src/main.rs` does not exist
- `warn` `JSON the JavaScript way: --json output, request bodies, the files under ~/.qqdocs`: proof `rs/parity.json` does not exist
- `warn` `JSON the JavaScript way: --json output, request bodies, the files under ~/.qqdocs`: rs path `rs/src/json.rs` does not exist
- `warn` `output on a terminal: links, colours, dimmed text`: rs path `rs/src/env.rs` does not exist
- `warn` `proxy and certificate variables, NODE_* and BUN_* variables, bunfig.toml`: rs path `rs/src/env.rs` does not exist
- `warn` `the second command name: qqdoc`: rs path `rs/src/main.rs` does not exist
- `warn` `macOS`: rs path `rs/src/env.rs` does not exist
- `warn` `Windows`: rs path `rs/src/env.rs` does not exist
- `ok  ` ledger is current (reconciled at `ea064c4`, no TypeScript changed since)
- `todo` 29 feature(s) not fully ported
- `todo` no Rust port exists yet

**Delivery**

- `warn` `rs/Cargo.toml` is missing or unreadable
- `info` npm has `qqdocs` 1.26.0
- `todo` `bun i -g qqdocs` installs JavaScript, not the Rust binary (`qqdoc` → `bin/qqdocs.ts`, `qqdocs` → `bin/qqdocs.ts`)

## winrpc

**Checkout**

- `info` `/code/snomiao/winrpc/tree/main` on `main` at `91cda75`

**Code**

- `info` TypeScript/JS to replace: 1,802 lines in 11 files; its tests: 457 lines, about 34 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/winrpc.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `todo` `winrpc` is not on npm

## chatwork-cli

**Checkout**

- `info` `/code/snomiao/chatwork-cli/tree/main` on `main` at `5e79a99`

**Code**

- `info` TypeScript/JS to replace: 1,534 lines in 15 files; its tests: 0 lines, about 0 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/chatwork-cli.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `warn` `rs/Cargo.toml` is missing or unreadable
- `todo` `chatwork-cli` is not on npm

## genvx

**Checkout**

- `info` `/code/snomiao/genvx/tree/main` on `main` at `8809766`

**Code**

- `info` TypeScript/JS to replace: 1,512 lines in 3 files; its tests: 431 lines, about 12 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `info` 27 features: 18 verified, 1 ported but unproven, 4 partial, 4 missing, 0 dropped
- `warn` `branch / b`: proof `rs/parity.json` does not exist
- `warn` `branch / b`: rs path `rs/src/main.rs` does not exist
- `warn` `branch / b`: rs path `rs/src/project.rs` does not exist
- `warn` `push / p / save, when nothing is asked (--yes, or no terminal on stdin)`: proof `rs/parity.json` does not exist
- `warn` `push / p / save, when nothing is asked (--yes, or no terminal on stdin)`: proof `rs/cross-compat.sh` does not exist
- `warn` `push / p / save, when nothing is asked (--yes, or no terminal on stdin)`: rs path `rs/src/main.rs` does not exist
- `warn` `push / p / save, when nothing is asked (--yes, or no terminal on stdin)`: rs path `rs/src/sync.rs` does not exist
- `warn` `pull / load, when nothing is asked`: proof `rs/parity.json` does not exist
- `warn` `pull / load, when nothing is asked`: proof `rs/cross-compat.sh` does not exist
- `warn` `pull / load, when nothing is asked`: rs path `rs/src/main.rs` does not exist
- `warn` `pull / load, when nothing is asked`: rs path `rs/src/sync.rs` does not exist
- `warn` `diff / d`: proof `rs/parity.json` does not exist
- `warn` `diff / d`: proof `rs/cross-compat.sh` does not exist
- `warn` `diff / d`: rs path `rs/src/main.rs` does not exist
- `warn` `diff / d`: rs path `rs/src/sync.rs` does not exist
- `warn` `setup / init, when nothing is asked (--yes, or no terminal on stdin)`: proof `rs/parity.json` does not exist
- `warn` `setup / init, when nothing is asked (--yes, or no terminal on stdin)`: rs path `rs/src/main.rs` does not exist
- `warn` `setup / init, when nothing is asked (--yes, or no terminal on stdin)`: rs path `rs/src/setup.rs` does not exist
- `warn` `hooks install, local mode (.git/hooks)`: proof `rs/parity.json` does not exist
- `warn` `hooks install, local mode (.git/hooks)`: rs path `rs/src/hooks.rs` does not exist
- `warn` `hooks install, shared mode (.githooks, or .husky under husky)`: rs path `rs/src/hooks.rs` does not exist
- `warn` `hooks install, shared mode (.githooks, or .husky under husky)`: rs path `rs/src/hooks.rs` does not exist
- `warn` `hooks install, lefthook mode (lefthook-local.yml)`: rs path `rs/src/hooks.rs` does not exist
- `warn` `hooks install, lefthook mode (lefthook-local.yml)`: rs path `rs/src/hooks.rs` does not exist
- `warn` `hooks uninstall`: proof `rs/parity.json` does not exist
- `warn` `hooks uninstall`: rs path `rs/src/hooks.rs` does not exist
- `warn` `hooks status`: proof `rs/parity.json` does not exist
- `warn` `hooks status`: rs path `rs/src/hooks.rs` does not exist
- `warn` `hooks run [event] (what the installed hooks call)`: proof `rs/parity.json` does not exist
- `warn` `hooks run [event] (what the installed hooks call)`: proof `rs/cross-compat.sh` does not exist
- `warn` `hooks run [event] (what the installed hooks call)`: rs path `rs/src/main.rs` does not exist
- `warn` `hooks run [event] (what the installed hooks call)`: rs path `rs/src/hooks.rs` does not exist
- `warn` `where store and key come from (--gitstore, GENVX_STORE, GENVX_KEY, GENVX_CONFIG_DIR, ./.env.local, ./.env, ~/.genvx)`: proof `rs/parity.json` does not exist
- `warn` `where store and key come from (--gitstore, GENVX_STORE, GENVX_KEY, GENVX_CONFIG_DIR, ./.env.local, ./.env, ~/.genvx)`: rs path `rs/src/env.rs` does not exist
- `warn` `.env files bun loads by itself before the program starts`: rs path `rs/src/env.rs` does not exist
- `warn` `.env files bun loads by itself before the program starts`: rs path `rs/src/env.rs` does not exist
- `warn` `encrypted files, format v2 (written and read)`: proof `rs/parity.json` does not exist
- `warn` `encrypted files, format v2 (written and read)`: proof `rs/cross-compat.sh` does not exist
- `warn` `encrypted files, format v2 (written and read)`: proof `rs/src/crypto.rs` does not exist
- `warn` `encrypted files, format v2 (written and read)`: rs path `rs/src/crypto.rs` does not exist
- `warn` `encrypted files, old format v1 (read only)`: proof `rs/parity.json` does not exist
- `warn` `encrypted files, old format v1 (read only)`: proof `rs/src/crypto.rs` does not exist
- `warn` `encrypted files, old format v1 (read only)`: rs path `rs/src/crypto.rs` does not exist
- `warn` `plaintext store (--no-encrypt)`: rs path `rs/src/sync.rs` does not exist
- `warn` `plaintext store (--no-encrypt)`: rs path `rs/src/args.rs` does not exist
- `warn` `which files are synced (.env* in every directory except skipped ones and nested repositories)`: proof `rs/parity.json` does not exist
- `warn` `which files are synced (.env* in every directory except skipped ones and nested repositories)`: rs path `rs/src/sync.rs` does not exist
- `warn` `the list of changes (New, + KEY, (Updated), - KEY, formatting changes)`: proof `rs/parity.json` does not exist
- `warn` `the list of changes (New, + KEY, (Updated), - KEY, formatting changes)`: rs path `rs/src/sync.rs` does not exist
- `warn` `working copy in .genvx/ (node_modules/.genvx/ if node_modules exists): clone, first branch, reuse, clean-up`: proof `rs/parity.json` does not exist
- `warn` `working copy in .genvx/ (node_modules/.genvx/ if node_modules exists): clone, first branch, reuse, clean-up`: rs path `rs/src/sync.rs` does not exist
- `warn` `working copy in .genvx/ (node_modules/.genvx/ if node_modules exists): clone, first branch, reuse, clean-up`: rs path `rs/src/sync.rs` does not exist
- `warn` `refusing to run in the gitstore`: proof `rs/parity.json` does not exist
- `warn` `refusing to run in the gitstore`: proof `rs/cross-compat.sh` does not exist
- `warn` `refusing to run in the gitstore`: rs path `rs/src/main.rs` does not exist
- `warn` `refusing to run in the gitstore`: rs path `rs/src/project.rs` does not exist
- `warn` `refusing to run in the gitstore`: rs path `rs/src/sync.rs` does not exist
- `warn` `file modes (600 on env files that were written or pushed, 755 on hooks)`: proof `rs/parity.json` does not exist
- `warn` `file modes (600 on env files that were written or pushed, 755 on hooks)`: rs path `rs/src/sync.rs` does not exist
- `warn` `file modes (600 on env files that were written or pushed, 755 on hooks)`: rs path `rs/src/hooks.rs` does not exist
- `warn` `backup of a file a hook is about to overwrite (.genvx/backups/<time>/)`: proof `rs/parity.json` does not exist
- `warn` `backup of a file a hook is about to overwrite (.genvx/backups/<time>/)`: proof `rs/src/sync.rs` does not exist
- `warn` `backup of a file a hook is about to overwrite (.genvx/backups/<time>/)`: rs path `rs/src/sync.rs` does not exist
- `warn` `backup of a file a hook is about to overwrite (.genvx/backups/<time>/)`: rs path `rs/src/sync.rs` does not exist
- `warn` `Windows`: rs path `rs/src/sync.rs` does not exist
- `warn` `Windows`: rs path `rs/src/env.rs` does not exist
- `warn` `Windows`: rs path `rs/src/setup.rs` does not exist
- `ok  ` ledger is current (reconciled at `8809766`, no TypeScript changed since)
- `todo` 8 feature(s) not fully ported
- `todo` no Rust port exists yet

**Delivery**

- `warn` `rs/Cargo.toml` is missing or unreadable
- `info` npm has `genvx` 1.1.0
- `todo` `bun i -g genvx` installs JavaScript, not the Rust binary (`genvx` → `src/cli.ts`)

## rustdesk.skill

**Checkout**

- `info` `/code/snomiao/rustdesk.skill/tree/main` on `main` at `c759994`

**Code**

- `info` TypeScript/JS to replace: 1,317 lines in 8 files; its tests: 389 lines, about 45 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/rustdesk.skill.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `todo` `rustdesk-skill` is not on npm

## wtx

**Checkout**

- `info` `/code/snomiao/wtx/tree/main` on `main` at `2c1b22f`

**Code**

- `info` TypeScript/JS to replace: 984 lines in 4 files; its tests: 103 lines, about 5 cases
- `info` Rust: 0 lines in 0 files, 0 tests
- `info` `lib` stays TypeScript: React component library, runs in the browser

**Parity ledger**

- `todo` no ledger at `parity/wtx.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `warn` `wtx` on crates.io belongs to another project (https://github.com/c410-f3r/wtx) — pick a different crate name
- `info` npm has `@snomiao/wtx` 0.3.4
- `todo` `bun i -g @snomiao/wtx` installs JavaScript, not the Rust binary (`wtx` → `wtx.mjs`)

## gchat-cli

**Checkout**

- `info` `/code/snomiao/gchat-cli/tree/main` on `main` at `fd70e59`

**Code**

- `info` TypeScript/JS to replace: 868 lines in 11 files; its tests: 178 lines, about 18 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `info` 16 features: 12 verified, 1 ported but unproven, 1 partial, 2 missing, 0 dropped
- `warn` `spaces / rooms / ls`: proof `rs/parity.json` does not exist
- `warn` `spaces / rooms / ls`: rs path `rs/src/commands/spaces.rs` does not exist
- `warn` `read <space>`: proof `rs/parity.json` does not exist
- `warn` `read <space>`: rs path `rs/src/commands/read.rs` does not exist
- `warn` `send <space[:thread]> <message> (first call: context, confirm code, pending file)`: proof `rs/parity.json` does not exist
- `warn` `send <space[:thread]> <message> (first call: context, confirm code, pending file)`: rs path `rs/src/commands/send.rs` does not exist
- `warn` `send --code (second call: post, --dry-run, refusals)`: proof `rs/parity.json` does not exist
- `warn` `send --code (second call: post, --dry-run, refusals)`: rs path `rs/src/commands/send.rs` does not exist
- `warn` `send --code (second call: post, --dry-run, refusals)`: rs path `rs/src/gws.rs` does not exist
- `warn` `tail <space> (backlog, then polling)`: proof `rs/parity.json` does not exist
- `warn` `tail <space> (backlog, then polling)`: rs path `rs/src/commands/tail.rs` does not exist
- `warn` `tail --exit-on-message / --timeout (wait for a reply)`: proof `rs/parity.json` does not exist
- `warn` `tail --exit-on-message / --timeout (wait for a reply)`: rs path `rs/src/commands/tail.rs` does not exist
- `warn` `tail --exit-on-message / --timeout (wait for a reply)`: rs path `rs/src/gws.rs` does not exist
- `warn` `watch <spaces..>`: proof `rs/parity.json` does not exist
- `warn` `watch <spaces..>`: rs path `rs/src/commands/watch.rs` does not exist
- `warn` `watch <spaces..>`: rs path `rs/src/rt.rs` does not exist
- `warn` `auth`: proof `rs/parity.json` does not exist
- `warn` `auth`: rs path `rs/src/commands/auth.rs` does not exist
- `warn` `gws backend: GCHAT_GWS_BIN / PATH, arguments, results and errors`: proof `rs/parity.json` does not exist
- `warn` `gws backend: GCHAT_GWS_BIN / PATH, arguments, results and errors`: rs path `rs/src/gws.rs` does not exist
- `warn` `gws backend: GCHAT_GWS_BIN / PATH, arguments, results and errors`: rs path `rs/src/rt.rs` does not exist
- `warn` `a gws that cannot be started`: rs path `rs/src/gws.rs` does not exist
- `warn` `gws on Windows (.exe or .cmd), TEMP and USERPROFILE`: rs path `rs/src/gws.rs` does not exist
- `warn` `gws on Windows (.exe or .cmd), TEMP and USERPROFILE`: rs path `rs/src/config.rs` does not exist
- `warn` `space arguments (id, spaces/<id>, display name) and the space cache`: proof `rs/parity.json` does not exist
- `warn` `space arguments (id, spaces/<id>, display name) and the space cache`: rs path `rs/src/resolver.rs` does not exist
- `warn` `space arguments (id, spaces/<id>, display name) and the space cache`: rs path `rs/src/config.rs` does not exist
- `warn` `message and table rendering`: proof `rs/parity.json` does not exist
- `warn` `message and table rendering`: rs path `rs/src/format.rs` does not exist
- `warn` `--format json output`: proof `rs/parity.json` does not exist
- `warn` `--format json output`: rs path `rs/src/json.rs` does not exist
- `warn` `answers from gws the TypeScript was not written for`: rs path `rs/src/rt.rs` does not exist
- `warn` `answers from gws the TypeScript was not written for`: rs path `rs/src/format.rs` does not exist
- `todo` 3 file(s) of the TypeScript changed since the ledger was reconciled at `4ced1d2`: `ts/cli.ts`, `ts/commands/tail.ts`, `ts/gws.ts`
- `todo` 3 feature(s) not fully ported
- `todo` no Rust port exists yet

**Delivery**

- `warn` `rs/Cargo.toml` is missing or unreadable
- `warn` `publishConfig.bin` differs from `bin`, and npm does not apply it when publishing: the published command is what `bin` names. The hand-back must go there too
- `info` npm has `gchat-cli` 1.2.0
- `warn` the newest release tag in this checkout is `v1.0.0` — it is behind npm; fetch before trusting the code counts
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

**Checkout**

- `info` `/code/snomiao/bunto/tree/main` on `main` at `dec02fd`

**Code**

- `info` TypeScript/JS to replace: 784 lines in 18 files; its tests: 0 lines, about 0 cases
- `info` Rust: 0 lines in 0 files, 0 tests

**Parity ledger**

- `todo` no ledger at `parity/bunto.toml`, so progress cannot be measured
- `todo` no Rust port exists yet

**Delivery**

- `info` npm has `bunto` 1.4.18
- `todo` `bun i -g bunto` installs JavaScript, not the Rust binary (`bunto` → `bin/cli.js`)

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
