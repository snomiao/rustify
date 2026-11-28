# snocommit

snomiao/snocommit PR #4, read at `570b0ec`.

snocommit writes a conventional commit for what is staged: `feat <scope>
<description…>` (and `chore`, `docs`, `fix`, `refactor`, `styles`) stages by
scope, sends the staged diff and recent commits to OpenAI for a message,
then commits, pulls and pushes. About 300 lines of TypeScript.

## State

- **Native on Linux and macOS:** the six commit commands, end to end. That
  covers staging by `-`, `.`, `@` or a path, the diffs and recent commits, the
  key from `~/.snocommitrc.json` or `OPENAI_API_KEY`, the chat completion
  (the request body byte for byte), the commit, pull and push, and the echo
  of each git command. **Windows** hands everything back: node's `exec` runs
  cmd.exe there, with other quoting.
- **Proof:** 269 parity cases run against a stand-in for the OpenAI API
  that records every request, with local bare repositories as remotes. They
  run plain and again on a terminal.
  - Linux: 174 answered by the binary, 95 handed back.
  - macOS: 161 answered, 107 handed back.
  - Windows: all 134 that run there handed back.
  - CI's parity job passes on all three at `570b0ec`.
- **Independent verifier:** it added 108 cases and found five differences and
  a security issue. Each was repaired or handed back.
- **Ledger:** 21 features: 10 verified, 1 ported, 10 missing.

## What goes back to the JavaScript

- **The TypeScript's shell-injection hole is never copied.** Any scope,
  directory, status line or model message the shell would not take
  literally goes back, and so does every staged rename.
- **Errors the TypeScript reports through the runtime:** no description, or
  no key (the TypeScript then asks on the terminal).
- **Answers the SDK would throw at:** these go back after the binary's one
  request.
- **Settings through which git would run the user's programs:** filters,
  textconv, fsmonitor, hooks in git's configuration, submodules. So a
  machine with `git lfs install` gets no speed-up.
- **Where `node` is really bun:** `.env*` files, `bunfig.toml`, a
  `tsconfig.json` or a repository with a hook.

## For the owner

- `src/index.tsx:155` passes the model's message into a shell command line.
  Text in the diff can steer the model, so this is command injection from
  untrusted content.
- The `snocommit` command itself is never built (`dist/cli-snocommit.js`), so
  npm installs no such command.
- The binary runs one more `git config --get-regexp` and one
  `git ls-files --stage -z` per run.
