# Purpose

rustify coordinates the migration of snomiao's TypeScript portfolio to Rust,
with exactly the same features as the TypeScript versions.

Projects in scope: the owner's public command-line projects, listed in
[`projects.toml`](../projects.toml). `agent-yes`, `rechrome`, `slack-hub` and
`otoji` come first.

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

## Where things are

- [Latest status](status.md) — written by `rustify audit --write`
- [Porting a project, command by command](porting.md) — the procedure
- [Delivering Rust through npm](npm-distribution.md) — design and what is verified
- [全平台原生速度方案](native-speed.zh.md) — Windows plan and the public-repo layout (Chinese)
- Parity ledgers: [`parity/`](../parity/README.md)
- Per project: [agent-yes](agent-yes.md), [slack-hub](slack-hub.md), [rechrome](rechrome.md), [otoji](otoji.md), [fbi-proxy](fbi-proxy.md), [genvx](genvx.md), [gchat-cli](gchat-cli.md)

Notes about this migration belong in this directory, not in Claude memory.

## Local layout

Repos are checked out at `/code/snomiao/<repo>/tree/<branch>`.
