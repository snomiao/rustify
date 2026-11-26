# fbi-proxy

Survey of `snomiao/fbi-proxy` at `65a6214` (npm 1.18.0) on 2026-11-27.

fbi-proxy already has a Rust core: the proxy itself (`rs/`, about 3,200
lines). The commands `fbi-proxy` and `fbip` are TypeScript (`ts/`, about
3,000 lines without tests) that orchestrates around it: the macOS setup, the
Caddy and auth helpers, `serve`, and the rule commands that talk to a running
proxy.

## Delivery

- 1.18.0 on npm bundles all six binaries into the one package: 18.8 MB for
  every install.
- On macOS the bundled binary is never found: the lookup asks for
  `fbi-proxy-darwin`, the files are `fbi-proxy-macos-arm64` and `-x64`, and
  the CLI falls through to `cargo build`.
- `fbi-proxy --dev --version` prints `unknown` in the installed package.

snomiao/fbi-proxy PR #14 packs the binary per platform ("binaries only": the
commands stay JavaScript, `ts/nativeBinary.ts` finds the binary in the
platform package) and install-tests that on all six platforms; its run was
green. It does not publish. Switching `release.yml` over, and dropping
`release/` and `rs/` from the package's `files`, is the next step and the
owner's call.

## Port

Not started, and no ledger yet. The TypeScript is orchestration with few
users per command; the natural order is the rule commands (`up`, `down`,
`ps`, `config`) first, the macOS setup last.

Note for tests: a plain `fbi-proxy` with no foreground flag starts the macOS
setup. Use `--dev` to reach the argument parser only.
