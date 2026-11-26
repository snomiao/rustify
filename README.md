# rustify

Tracks the migration of a set of TypeScript projects to Rust, at exact feature
parity, and the delivery of the resulting binaries through npm so that
`bun i -g <package>` gives every user the native binary.

This is a helper repo. The ported code lives in each project's own repo, and
each project builds and publishes its own binaries from its own workflow runs.
What lives here is the tracking, the tooling, and the release pipeline those
workflows call; this repo's CI only ever builds a toy binary to test that
pipeline. Start with [docs/purpose.md](docs/purpose.md).

## Check progress

```bash
cargo run -q --release -- audit            # all projects
cargo run -q --release -- audit slack-hub  # one project
```

The audit only reads: local checkouts, the ledgers in `parity/`, and the public
npm and crates.io registries. In Claude Code, `/rustify` runs it and then works
on what it finds.

## Use the release pipeline in a project

```yaml
# .github/workflows/rust-npm-release.yml
jobs:
  build:
    uses: snomiao/rustify/.github/workflows/rust-npm-build.yml@releases/v1
    with:
      manifest: rs/Cargo.toml
      bins: mycli
      smoke: mycli --version
```

plus, in `package.json`, `"rustify": { "bins": { "mycli": "mycli" } }`.
`rustify vendor <project>` writes the full file, including the publish job.
How it works: [docs/npm-distribution.md](docs/npm-distribution.md).

## Layout

| Path | What it is |
|---|---|
| `projects.toml` | The projects being migrated |
| `parity/` | One ledger per project: every TypeScript feature and how far Rust has it |
| `src/` | The `rustify` tool (`audit`, `vendor`) |
| `.github/workflows/rust-npm-build.yml` | Reusable workflow projects call: six platforms built, packed, install-tested on Linux, macOS and Windows |
| `.github/workflows/rust-npm-verify.yml` | Reusable workflow: the same install test against the real registry, after publishing |
| `actions/publish/` | Action a project's own job uses to publish what was built |
| `templates/npm/` | Packer, launcher, smoke test and the one platform list |
| `templates/github/` | The small workflow a project adds to use all of the above |
| `templates/rust/` | Helper for binaries that still hand some commands to JavaScript |
| `tests/e2e/run.sh`, `tests/unit/` | Local rehearsal of the npm delivery; unit tests of the launcher |
| `.claude/skills/rustify/` | The `/rustify` skill |
| `docs/` | Purpose, design, per-project surveys, latest status |
