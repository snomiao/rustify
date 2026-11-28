# Purpose

rustify coordinates the migration of snomiao's TypeScript portfolio to Rust,
with exactly the same features as the TypeScript versions.

Projects in scope: the owner's public command-line projects, listed in
[`projects.toml`](../projects.toml). `agent-yes`, `rechrome`, `slack-hub` and
`otoji` come first.

**Public repositories only.** This repository is public, and so are its pull
requests, commit messages and CI logs. It works on the owner's public
repositories and never names a private one: not in a file here, not in a
commit message or pull request, and not in a pull request it opens in a
project. A project whose repository becomes private leaves `projects.toml`,
its ledger and its pages. CI checks that every repository `projects.toml`
lists is public, and says only the line when one is not.

## Ground rules

- **Rust code stays in each project's own repo**, in an `rs/` directory beside
  `ts/`. rustify holds only the plans, parity tracking and shared tooling for
  the migration — not the ported code.
- **rustify is a helper, not a release channel.** Each project's binaries are
  built and published by that project's own workflow, in its own repository.
  Those workflows call the pipeline defined here; rustify's own CI never
  builds or publishes a project's binaries.
- **Exact feature parity.** A project's TypeScript is removed only once every
  feature has a Rust equivalent that is proven to behave the same.
- **npm installs must get the Rust benefits.** Each project is published both
  as an npm package and as a Rust crate. The usual install is
  `bun i -g <package>`, so the npm package has to deliver the Rust binary; a
  port that only helps `cargo install` users is not done.

## Order

Start with `agent-yes` and `slack-hub`.

### Set aside by the owner

No more porting work goes into these, though they stay in `projects.toml`
and their ledgers stay as a record (2026-11-27):

- `genvx`: deprecated in favour of `dotenvdotenc`, which the owner uses
  instead (deprecation note: snomiao/genvx PR #3). Its Rust port, snomiao/genvx
  PR #2, stays as it is.
- `gchat-cli` and `chatwork-cli`: rarely used. gchat-cli's port (snomiao/gchat-cli
  PR #2) stays as it is; chatwork-cli's was never pushed.

## Where things are

- [Latest status](status.md) — written by `rustify audit --write`
- [Porting a project, command by command](porting.md) — the procedure
- [Delivering Rust through npm](npm-distribution.md) — design and what is verified
- [全平台原生速度方案](native-speed.zh.md) — Windows plan and the public-repo layout (Chinese)
- Parity ledgers: [`parity/`](../parity/README.md)
- Per project: [agent-yes](agent-yes.md), [slack-hub](slack-hub.md), [rechrome](rechrome.md), [otoji](otoji.md), [fbi-proxy](fbi-proxy.md), [qqdocs](qqdocs.md), [onenote-cli](onenote-cli.md), [codehost](codehost.md), [dotenvdotenc](dotenvdotenc.md), [snocommit](snocommit.md), [bunto](bunto.md), [Comfy-AI](comfy-ai.md), [genvx](genvx.md), [gchat-cli](gchat-cli.md)

Notes about this migration belong in this directory, not in Claude memory.

## Local layout

Repos are checked out at `/code/snomiao/<repo>/tree/<branch>`.
