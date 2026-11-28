# winrpc

snomiao/winrpc PR #4, read at `bdd5d63`.

winrpc is a Windows remote-control server (AutoHotkey, PowerShell,
screenshots, OCR, a UI lock shared with other programs) with a client for
it. The server runs on Windows. The client runs anywhere and talks to it over
HTTP.

## State

- **Native on Linux, macOS and Windows:**
  - `winrpc lock` (`lock show`): a GET of `/lock` from plain http to an
    IPv4 address or `localhost`, with every answer printed as the
    TypeScript prints it (the JSON, the 423 lease-held line with exit 75,
    `HTTP <status> <reason> on /lock` with exit 1);
  - every client refusal made before anything is sent;
  - the `--help` pages of the program and of `serve`, `lock`, `ahk-repl`
    and `tray`.
- **`localhost`** is native on macOS and Windows, which try `::1` first and
  then `127.0.0.1` as bun does. On Linux it goes back before anything is
  sent. bun 1.4.0 asks the system resolver, while bun 1.4.1 and later answer
  `[::1, 127.0.0.1]` themselves. CI's first run, with bun 1.4.5, showed the
  difference.
- **Still JavaScript:**
  - `serve` and `tray`;
  - the commands that change something (`lock acquire`, `lock renew`,
    `lock release`, `ahk-repl`), because a hand-back after sending would
    send twice;
  - a client that cannot connect;
  - host names, https and IPv6.
- **Proof:** 389 parity cases, each behind a stand-in winrpc server on
  127.0.0.1 (some on ::1 too). No case reaches a real server or runs
  AutoHotkey.
  - Linux: 256 answered by the binary, 133 handed back.
  - macOS: 267 answered, 122 handed back.
  - Windows: 260 answered, 119 handed back, 10 skipped with reasons.
  - On Linux and macOS the whole file runs again on a terminal.
  - Run locally with bun 1.4.5 (CI's) on all three systems, and with each
    machine's own bun. CI passes all 17 checks at `bdd5d63`.
- **Independent verifier:** it added 70 cases and found two differences,
  `localhost` on macOS and Windows and output bun loses through pipes. Both
  are repaired.
- **Ledger:** 45 features: 4 verified, 6 partial, 35 missing.

## Output bun loses

When a program ends, bun drops output that a pipe has no room for. On Linux
(bun 1.4.0) this hits every write: `winrpc lock | wc -c` gets exactly 65,536
bytes of a larger answer, and a full pipe gets nothing, not even `--help`. On
macOS and Windows it hits only the 423 line (`process.stderr.write` followed
by `process.exit`). The binary checks the room a pipe or socket has and
hands those runs back, so users see the same thing. For `lock show` that
happens after its GET, so the server is asked twice. GET `/lock` is
read-only.

## For the owner

- Fix the TypeScript's lost output (await the writes, no `process.exit`
  right after `process.stderr.write`), or have the binary copy the loss.
- Request headers only the binary sends: `Accept: */*` and
  `Connection: close`, with no User-Agent and no Accept-Encoding. Bless or
  remove them.
- A `/lock` answer slower than 30 s: the TypeScript makes 1 request and
  takes 32 s; the binary makes 2 and takes 64 s.
- `postJson` awaits `res.text()` outside its try/catch, and `printLeaseHeld`
  calls `String()` on what the server sent: both end in yargs's help and a
  stack trace on answers no winrpc server gives.
- A server whose own environment or `.env.local` holds a client's
  `WINRPC_URL` forwards every AutoHotkey script there.
