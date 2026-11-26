# otoji

Survey of `/code/snomiao/otoji/tree/main` on 2026-11-26 (crate v0.1.62). Based
on reading the tree; nothing was built or run.

otoji is the reverse of the other projects: the native side is already Rust.
What remains in TypeScript is the browser app and some small pieces around it.

## Size

| Part | Language | Lines | Where |
|---|---|---|---|
| Native CLI, TUI, tray, library | Rust | ~10.6k | `src/` |
| Web app (otoji.org) | TS / React | ~26k | `web/src/` |
| Signaling relay | TS, Cloudflare Worker | ~0.3k | `signal/` |
| npm `otoji` CLI | JS, zero-dep | ~0.4k | `cli/` |
| QA script | TS | ~0.5k | `scripts/` |

## What Rust already has

The `otoji` binary with `listen`, `devices`, `mic`, `kws`, `file`, `server`,
`signal`, `transcribe`, `say`, `ls`, `read`; an `otoji-tray` binary; ASR
(SenseVoice, iFlytek), TTS (Piper, OpenAI, ElevenLabs, Gemini, iFlytek,
Cloudflare), LLM polish, and napi-rs bindings behind the `node` feature.

`src/signal_relay.rs` already exists beside the TS worker in `signal/`.

## What is still TypeScript

- **Web app** — a React graph editor running models in the browser
  (onnxruntime-web, MediaPipe, OCR), WebRTC mesh, a browser extension and a
  userscript. This is the bulk of the remaining TS. A Rust port means
  Rust-to-WASM with a Rust UI framework, a far larger and riskier job than a
  CLI port.
- **Signaling worker** — Durable Objects on `otoji.org/signal`.
- **npm `otoji` CLI** (`cli/otoji-node.mjs`, `otoji-gdoc.mjs`) — `otoji node`
  bridges stdio to a graph over WebSocket; `otoji gdoc` drives headless Chrome
  over CDP.

## Release state

Three published things share the name:

| Package | Registry | What you get |
|---|---|---|
| `otoji` | crates.io | The native Rust CLI (`listen`, `say`, ...) |
| `otoji` | npm | The JS launcher with only `node` and `gdoc` |
| `@otoji/core` | npm | napi-rs bindings, per-platform `.node` packages, bin `otoji-node` |

So `bun i -g otoji` and `cargo install otoji` install two different CLIs with
no commands in common. Releases are automated: release-plz publishes the crate,
then CI builds and publishes the npm packages.

## Plan

The gap is not a port; it is that `bun i -g otoji` and `cargo install otoji`
give two different tools. Closing it means the npm `otoji` package delivers
the native binary:

1. The native build needs its own runners (prebuilt speech libraries, audio
   system libraries), so otoji keeps its build jobs and calls the pipeline with
   `prebuilt: true`. It builds five targets today, not six: it would list them
   in `rustify.platforms`.
2. `otoji node` and `otoji gdoc`, the two commands the JavaScript launcher
   has, are either ported into the binary or handed back to the launcher's
   scripts (hybrid mode).
3. `@otoji/core`, the napi addon, is a library and stays as it is.

Not started: it changes what the npm package `otoji` is, which is the owner's
call.

## Open decisions

- Is the web app in scope for the Rust migration, or does "otoji" here mean the
  CLI pieces only?
- Should the npm `otoji` package become the native binary, with `node` and
  `gdoc` ported into it, so both installs give the same CLI?
- Does the signaling worker stay TS?
