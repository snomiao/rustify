# rustdesk.skill

snomiao/rustdesk.skill PR #8, read at `9bbba53`.

rustdesk-skill (also `rds`) drives a RustDesk web client through
playwright-cli. It connects to a remote machine, finds the password field
with OCR, types, clicks and takes screenshots, and keeps a password store and
a recents list.

## State

- **Native on Linux and macOS:** every command in its plain spellings:
  - `list`, `scroll`, `key`, `type`, `move`, `click-xy`, `screenshot`/`ss`,
    `disconnect`, `status`, `ocr`, `click`, `paste` and `connect`/`c`;
  - with the password and recents stores, the session name, `.env` files
    and project files.
- **On Windows** the binary hands every invocation back.
- **Still JavaScript:**
  - what yargs answers: help, version, usage errors and unusual spellings;
  - every command but `list` on a terminal, where the TypeScript asks for
    the session name;
  - data that needs JavaScript's own coercion before the first act on the
    page.
- **Proof:** 553 parity cases, with stand-ins for playwright-cli, python3,
  xclip and pbcopy that log every call, alongside a logging git.
  - Linux: 423 answered by the binary, 130 handed back.
  - macOS: 422 answered, 129 handed back, 2 skipped (no `/dev/full`).
  - Windows: 301 handed back, 252 skipped with reasons.
  - On Linux and macOS the whole file runs again on a terminal.
  - CI passes all 16 checks at `9bbba53`.
  - `cargo test` also compares the argument gate with the project's own
    yargs chain over 134,123 lines.
- **Independent verifier:** it added 67 cases and found 7 differences:
  - output limits, and output that never ends;
  - programs that cannot start;
  - stdout that cannot be written;
  - a capital sigma on screen;
  - odd viewports and OCR output after the first act;
  - `-0` in the password field.

  Each is repaired. The binary now copies, among other things, bun's
  one-mebibyte output limit and JavaScriptCore's own sort.
- **CI's first run** found two more things, both repaired:
  - The binary took its lower case from Rust's own tables, which follow the
    toolchain. Built with Rust 1.100 (Unicode 18), it lowercased 18 code
    points that bun 1.4 (Unicode 17) keeps. It now answers from a table
    recorded from bun, and text with code points bun's Unicode does not
    assign goes back.
  - A race in the test harness on macOS: a stdout "whose reader has gone"
    was made with a FIFO and a background reader. It now never waits.
- **Ledger:** 30 features: 23 verified, 5 partial, 2 missing.

## After the first act

`connect` acts on the page: it clicks and types. After that, a hand-back would
repeat those steps. So whatever the binary does not handle after that point
ends with its own message, exit 1 and no further step:
`[rustdesk-skill] stopped: this build does not handle what it met after acting on the page; nothing further was done`.
The ledger lists the inputs that still reach it. None is anything the real
OCR scripts or playwright-cli print.

## For the owner

- Bless or remove the Rust-only behaviour: `RUSTDESK_SKILL_NO_NATIVE=1`,
  `RUSTDESK_SKILL_PACKAGE_ROOT`, and the stop after the first act.
- One residual: when `connect`'s stdout stops taking output after it has
  acted, bun crashes with a stack trace, while the binary prints only its
  first five lines. Making `printJson` catch its own write errors would fix
  both.
- The open pull requests #3 and #5 change `connect`, `type` and `paste`.
  Whichever lands first, the other needs a follow-up.
