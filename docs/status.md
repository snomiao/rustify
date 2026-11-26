# Rustify status

| Project | Port | `bun i -g` gives | Next step |
|---|---|---|---|
| agent-yes | started, not measured | JavaScript | write the parity ledger |
| slack-hub | 0 verified, 1 ported, 19 partial, 132 missing of 152 | JavaScript | port the missing features |
| rechrome | not started | JavaScript | write the parity ledger |
| otoji | started, not measured | JavaScript | write the parity ledger |

## agent-yes

**Checkout**

- `info` `/code/snomiao/agent-yes/tree/main` on `fix/resume-by-session-id` at `fbbd727`
- `warn` 17 uncommitted change(s) — someone is working here; use a separate worktree

**Code**

- `info` TypeScript/JS to replace: 44,153 lines in 145 files; its tests: 43,746 lines, about 3,218 cases
- `info` Rust: 30,920 lines in 62 files, 519 tests
- `info` by file name, 122 of 145 TypeScript modules have no Rust module of the same name (38,659 lines). A rough signal only: Rust code is often organised differently. Largest: `ts/subcommands.ts` (8,342), `ts/serve.ts` (5,484), `ts/index.ts` (1,601), `ts/todoStore.ts` (896), `ts/todoCli.ts` (856), `ts/notifyDaemon.ts` (773), `ts/terminal/browser.ts` (745), `ts/channels.ts` (740)

**Parity ledger**

- `todo` no ledger at `parity/agent-yes.toml`, so progress cannot be measured

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
