# qqdocs

snomiao/qqdocs PR #2 (the crate and the pipeline) and PR #3 (the ported
commands), read at `ea064c4`.

qqdocs is a CLI for Tencent Docs: about 2,300 lines of TypeScript, a yargs
CLI that talks to one MCP endpoint over HTTPS and keeps a call counter and a
document cache under `~/.qqdocs`.

## State

- Native: every command that only reads — `tools`, `ls`, `search`, `read`,
  `info`, `usage`, `usage calibrate`, `perm get`, `space list`, `space ls`,
  `canvas read`, `canvas find`, `sync`, and `raw` for the tools the
  TypeScript itself reads with.
- **But only on some machines.** The binary answers when no terminal is
  attached, the time zone is UTC by name, there is no `package.json`,
  `tsconfig.json` or `jsconfig.json` in the current directory or above it,
  and the machine is not Windows. So CI jobs, containers and servers get the
  binary; a developer's own computer, or an agent working inside a project,
  still gets the JavaScript.
- Proof: 910 parity cases against a stand-in server on 127.0.0.1 that records
  every request; all the same on both sides, requests included; 567 answered
  by the binary, 343 handed back on purpose. The real service was never
  contacted.
- After the port an independent verifier added 304 cases and fuzzed the
  argument gate against the project's own yargs chain (about 220,000 command
  lines). It found five differences: the word `help` as an argument, numbers
  that round two ways, unparsable project files above the current directory,
  zone data, and requests repeated after a hand-back. Two were made to behave
  the same, three are handed back.
- Ledger: 51 features, 20 verified, 2 ported, 2 partial, 27 missing.

## Why the commands that write stay JavaScript

Without a `.fail()` handler, yargs answers every error a command throws with
the command's whole help followed by bun's error report and stack trace. That
cannot be reproduced, and a write cannot be handed back after its request was
sent. A one-line error handler in the TypeScript would unlock them.

## For the owner

- `QQDOCS_PARITY_MCP_URL` is compiled into the release binary so that the
  parity cases run against the binary that ships. It accepts only
  `http://127.0.0.1:<port>/…`; when set, native commands send the real token
  in clear text to that port. Bless it or have it removed.
- The binary's request headers differ (`User-Agent: qqdocs/<version>`, fewer
  encodings); method, address, `Authorization` and body are the same.
- Widening where the binary answers needs decisions: the local day from the
  system's zone files (or a tested list of zones where they differ from
  bun's), and a proven rule for ordinary `package.json` files.
- Defects found in the TypeScript and copied: a 2-second wait on the very
  first call; counts lost when parallel calls fail or with about 1,000 calls
  at once; `qqdocs search help` prints help; any argument `usage` silences the
  quota warning. The full list is in PR #3.
