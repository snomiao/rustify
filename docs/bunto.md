# bunto

snomiao/bunto PR #1, read at `4e4f613`.

bunto installs and removes packages from what the source files import: it
finds the imports, works out which `package.json` manages each file, and runs
`bun install` / `bun remove` (with `@types` where needed), once or in watch
mode.

## State

- **Native on Linux, macOS and Windows:** `--help` (and `-h` or `help` as the
  last word, for every command), `--version` and usage errors, in about 6 ms
  instead of about 100 ms.
- **Every command line that reaches a command's handler is handed back to
  `bin/cli.js`.** On main (`dec02fd`) every handler throws
  `ReferenceError: getDeps is not defined` (index.tsx:50), so `bunto`,
  `install` and `remove` end in bun's error report. A binary cannot port
  that.
- **Proof:** 920 parity cases, plus 1,500 generated command lines checked
  against yargs itself.
  - Linux: 691 answered by the binary, 226 handed back.
  - macOS: 690 answered, 229 handed back.
  - Windows: 668 answered, 207 handed back, 45 skipped with reasons.
  - On Linux and macOS the whole file runs again on a terminal.
  - CI's parity job passes on Linux and Windows. On macOS, in one of three
    runs, one case differed in the terminal run, in bun's own error report
    (`LANG of 5000 letters, the handler`). That case ends in that report on
    both sides, since the binary hands it back. It was not reproduced in 65
    runs on a Mac, with bun 1.4.4 and with 1.4.5 under load. A further run
    is checking how often it happens.
- **Independent verifier:** it added 92 cases and found 5 differences
  (locales, `SIMDUTF_*`, loader variables, a bun that fails or is of another
  version). All are now handed back.
- **Ledger:** 19 features: 3 verified, 3 partial, 13 missing.

## What goes back to the JavaScript

- **Argument spellings the binary does not model:** `--no-x`, `--x=v`,
  groups like `-wd`, `--`, non-ASCII arguments.
- **Anything that changes what bun or the bundle prints:**
  - `.env*` files and `bunfig.toml`;
  - the variables of the runtime (`BUN_*`, `NODE_*`, `YARGS_*`, `SIMDUTF_*`)
    and of the loader and allocator (`LD_*`, `DYLD_*`, `Malloc*`);
  - an odd locale, or a `locales` directory beside the package (y18n would
    translate);
  - a narrow terminal, colours, and any console on Windows;
  - a bun outside 1.1.13 to 2.0.0.

## For the owner

- The handlers are broken on main (`getDeps`, `config` undefined), and
  main has never been published.
- The binary runs `bun --version` once before each native answer, which
  takes a few milliseconds.
- On macOS, `DYLD_PRINT_LIBRARIES` and `MallocScribble` make the loader print
  in the binary's name before it runs. Handing back cannot avoid that.
