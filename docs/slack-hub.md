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

- npm: published as `slack-hub` by semantic-release. The `slack` command is
  `ts/cli.ts`, run by bun: `package.json` names `dist/cli.js` in
  `publishConfig.bin`, but npm does not apply that when publishing, so the
  bundle ships unused. An npm install gets no Rust at all.
- Rust: no CI build, no release artifacts, not found on crates.io. The crate is
  named `slack-cli` (v0.2.0), a name already taken on crates.io by another
  project, so it needs renaming before it can be published.

## Pipeline and port

Four pull requests in snomiao/slack-hub, none merged yet:

| PR | What | State |
|---|---|---|
| #117 | The Rust `slack` built and install-tested on six platforms; hands every command back to `ts/cli.ts`. Renames the crate to `slack-hub`, makes it compile on Windows. | green (the red `TypeScript` check fails on `main` too; #112 fixes it) |
| #119 | `search` answered natively. `tests/parity.test.ts`: 164 cases, comparing stdout, stderr, exit code, every request the mock received and every file left in `HOME`. | green, parity job included |
| #120 | `news` answered natively: 209 cases. | green |
| #118 | Release wiring: build, install-test, then tag and publish the native package. Rehearsed from the branch with nothing published. | merging it turns native publishing on |

#119 and #120 are stacked on #117; #118 is stacked on #117 as well and does
not yet pass `parity:` to the build, which it should before it is switched on.

`search` against a local mock: 13 ms native, against 108 ms for `bun
ts/cli.ts`, which is what users run today.

What still goes to the JavaScript besides unported commands: any machine with
a `settings.yml` in `~/.config/slack-hub/` or the nearest `.slack-hub/` (bun's
YAML parser reads identities from it on every command, and no Rust crate
parses exactly like it), `.env` files bun itself loads, proxy and certificate
variables. The first of these is the common case for configured machines, so
most of them see no speed-up yet. `SLACK_HUB_NO_NATIVE=1` hands everything
back.

Found in the TypeScript on the way and left as it is, for the owner:

- the bundle `dist/cli.js` starts with `// @bun`; bun then reads it as
  Latin-1 and prints its non-ASCII text as mojibake. Users are not affected,
  because nothing runs the bundle, but it would bite if the package ever
  switched to it;
- a server that keeps answering 429 with `Retry-After: 0` makes the retry
  loop spin forever;
- `./.slack-cli/.env.local` is meant to win over the global files, but the
  first value wins, so the global ones do;
- the bot-token fallback is chosen by searching the error text, so a query
  containing `not_allowed_token_type` triggers it on any error;
- `news` never passes the `-w` workspace's cookie, and "Yesterday" means now
  minus 24 hours.

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
