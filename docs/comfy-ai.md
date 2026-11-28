# Comfy-AI

snomiao/Comfy-AI PR #1, read at `9d27de0`.

comfy-ai drives ComfyUI browser tabs from the command line. A daemon
(`comfy-ai serve`) connects browser tabs over WebSockets, and the client
commands pair with a tab and talk to it through the daemon, using wire
protocol v1.

## State

- **Native on Linux, macOS and Windows:** `pair`, `list`, `send`, `eval`,
  `kill`, `logout` and bare `comfy-ai`, with the pairing state file kept as
  the TypeScript keeps it.
- **Still JavaScript:** the daemon (`serve`), `tail`, `attach`, `--help` and
  `--version`.
- **Proof:** 479 parity cases, with the TypeScript daemon as the stand-in, a
  scripted browser tab on its `/spa` side, and the frames each side sends
  compared.
  - Linux and macOS: 358 answered by the binary, 121 handed back.
  - Windows: 326 answered, 119 handed back, 34 skipped with reasons.
  - On Linux and macOS the whole file runs again on a terminal.
  - CI's parity job passes on all three at `9d27de0`. One case first raced
    there: a 1 ms pairing code that the fast binary could still claim. The
    stand-in now waits it out.
- **Independent verifier:** it added 136 cases and found 12 differences (deep
  nesting, number formatting, eval exit codes, message size, `pair` after a
  claim). Each was repaired or handed back.
- **Ledger:** 23 features: 7 verified, 6 partial, 10 missing.

## What goes back to the JavaScript

- **The built-in daemon address before pairing.** No test may connect where
  a real daemon may run.
- **Connections the port does not make:** https and wss (the crate has no
  TLS), daemons other than localhost or 127.x, and proxy variables.
- **Anything that changes what bun prints:** `.env*` and config files bun
  warns about, `BUN_*` and `NODE_*` variables, `NO_COLOR` together with
  `FORCE_COLOR`, and a terminal on Windows.
- **After a read-only request, answers no comfy-ai daemon gives.**

## For the owner

- `eval` through a pipe: bun loses output that is unwritten at
  `process.exit` (65,536 to 196,608 of 3,000,000 bytes arrived). The binary
  delivers all of it.
- The binary prints a message of its own (`…; run the command with
  COMFY_AI_NO_NATIVE=1`), reachable only after a request that cannot be taken
  back. Bless it or have it removed.
- The daemon accepts `/spa` connections from any origin, and any `/ctl`
  client, with or without a token, may drive any session. The state file
  holds the token in clear text, with mode 0644 under the default umask.
