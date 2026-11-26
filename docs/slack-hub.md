# slack-hub

Survey of `/code/snomiao/slack-hub/tree/main` on 2026-11-26 (npm v1.8.0).
Based on reading the tree; nothing was built or run.

## Size

| | Lines | Where |
|---|---|---|
| TS source | ~20k, 41 modules | `ts/` |
| TS tests | ~22k | `tests/` |
| Cloudflare Worker | ~0.3k | `worker/` |
| Rust | 826 | `rs/src/main.rs`, `rs/src/slack.rs` |

`ts/cli.ts` alone is 8.9k lines.

## What Rust already has

Six commands: `msgs`, `thread`, `news`, `search`, `send` (with the confirm
hash), `dump`. The last commits under `rs/` are dependency bumps; the port is
stale.

## What is missing in Rust

Nearly everything else, by TS module:

- `ask`, `askPush`, `poll`, `choiceHint` — ask and wait for answers
- `todo`, `slackTodos`, `lists` — task tracking through reactions and lists
- `tail`, `stream`, `rtm` — live streams
- `auth`, `profiles`, `identity`, `chromeCookieWin`, `leveldb` — login and
  multi-workspace profiles
- `relay`, `relayInit`, `slack-app` — relay and Slack app mode
- `pinlog`, `sentlog`, `inbox`, `readback`, `cache`
- `agent`, `botIntent`, `botdoctor` — agent mode
- `format`, `escapes`, `newlines`, `redact`, `urlGuard`, `quietHours`,
  `locales` — output and safety helpers
- `edit` and `delete` with confirm codes

## Release state

- npm: published as `slack-hub` by semantic-release; the `slack` bin is bundled
  TS (`dist/cli.js`). An npm install gets no Rust at all.
- Rust: no CI build, no release artifacts, not found on crates.io. The crate is
  named `slack-cli` (v0.2.0), a name already taken on crates.io by another
  project, so it needs renaming before it can be published.

## Useful starting points

- `tests/parity.test.ts` compares Rust and TS stdout for two commands
  (`news`, `search`) against a mock server, but only when a built Rust binary
  exists, which CI never produces. `tests/parity.sh` just runs the test suite.
  So nothing proves parity today, although the README says the two are
  "verified byte-for-byte".
- `tests/mock.ts` and the recorded fixtures (`bun run record`, `anonymize`) can
  back token-free parity tests.

## Open decisions

- `worker/` is a Cloudflare Worker exported from the npm package as
  `slack-hub/worker`. It either stays TS or becomes Rust compiled to WASM.
- New crate name.
