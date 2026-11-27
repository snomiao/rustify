# Porting a project, command by command

How a TypeScript CLI becomes a Rust one here without ever shipping a
behaviour change. Read [purpose.md](purpose.md) first.

Six projects have been through it: genvx, gchat-cli, slack-hub (`search` and
`news`), dotenvdotenc, qqdocs and onenote-cli, between 300 and 800 cases
each. What they ran into is written into the steps below.

## The model

1. **The Rust binary becomes the command, and hands everything back.** From
   the first release on, `bun i -g <package>` installs the native binary. It
   passes every invocation to the JavaScript the package still ships, so users
   notice nothing.
2. **A command moves to Rust when a test proves it behaves the same.** Not
   before, and one at a time. The proof runs in CI against the binary that is
   about to be published.
3. **When everything has moved, the JavaScript goes.** `mode` becomes
   `native` and the hand-back is deleted.

At every step the published package is correct. Progress is the number of
`verified` entries in the project's ledger (`parity/<project>.toml`).

## What "the TypeScript" means

The thing to match is the published command as its runtime runs it, not the
source file read in isolation. Check first which file that is: `npm view
<package> bin`. npm ignores `publishConfig.bin`, so a package that sets it
still runs what `bin` names (slack-hub and gchat-cli run `ts/cli.ts`, not the
`dist/cli.js` they also ship). That file is what the binary hands back to.

Then find out what the runtime does around the program. Every item below was
found by a port or by the verification of one, and each was visible to a user.

**Before the first line of the program, bun**

- loads `.env`, `.env.local`, `.env.development` and `.env.development.local`
  from the current directory into the environment (other names under another
  `NODE_ENV`), with its own syntax (`$VAR` expansion, `export`, quoting,
  multi-line values). A project's own tests often run with `--no-env-file`
  and never see this;
- reads `bunfig.toml` from the directory and from the user's configuration,
  and takes options from `BUN_OPTIONS` and `NODE_OPTIONS`;
- reads `package.json`, `tsconfig.json` and `jsconfig.json` from the current
  directory and every directory above it, and reports one it cannot parse on
  stderr;
- writes to stderr when a variable meant for it is set: `NODE_DEBUG`,
  `BUN_JSC_*`, `MIMALLOC_VERBOSE`. The rule the ports ended up with: any
  `BUN_*` (except `BUN_INSTALL`, which the installer sets for nearly
  everyone), `NODE_*`, `MIMALLOC_*` or `ICU_*` variable goes back;
- cannot load a program from a path with `?` or `\` in it.

**While it runs, bun**

- prints `console.error` in red whenever stdout *or* stderr is a terminal,
  reads `NO_COLOR` and `FORCE_COLOR` in its own way, and decides this before
  it loads `.env`;
- formats dates with `toLocaleString()` as en-US on Linux whatever `LANG` and
  `LC_*` say. What it does on macOS and Windows has to be tried there;
- takes local time from the time zone data it carries (ICU's), not from the
  system's. A Rust binary reads the system's zone files or a database
  compiled into it, and the three editions disagree wherever a country
  changed its rules recently: in late 2026, bun 1.4.0 against tzdb 2026f
  differed for Western Canada, Cuba and Morocco. Compare every zone name the
  binary accepts against the runtime, keep the comparison as a test, and hand
  back where they differ;
- cuts the output of a child started with `spawnSync` off near 1 MiB and
  reports a failure;
- can lose output: once the program has read `process.stdout.isTTY`, lines
  written with `console.log` to a pipe that is read slowly are dropped (bun
  1.4.0; 1,896 of 6,014 lines arrived in one measurement). The TypeScript is
  then not deterministic for large output, no case can compare it, and
  whether the binary should copy the loss is the owner's decision.

**JavaScript itself**

- writes a number in the shortest form that reads back the same, and where
  two such forms are equally near it takes the even digit
  (`1459077941253781.25` is written `…781.2`); Rust's formatting takes the
  other;
- finds `constructor`, `toString` and `__proto__` in every plain object, so a
  lookup by a user's key (`obj[name]`) answers for those names too;
- parses dates leniently: `2026-02-30` is March 2nd.

**The argument parser**

- yargs prints `unknown` for `--version` when the package was installed
  globally with bun (it looks for the package relative to its own location,
  which in bun's flat `node_modules` is not the package), and the version
  when installed with npm;
- yargs prints the command's help when the last word is `help` (`mycli search
  help`), in the user's language;
- without a `.fail()` handler, yargs answers every error a command throws
  with the command's whole help text followed by the runtime's error report:
  source excerpt, stack trace, paths of the installed files. That cannot be
  reproduced, so such errors are handed back, and a command that writes
  cannot be ported at all until the project reports its errors itself (see
  "What to hand back").

Find out which of these the project's users can observe before deciding what
a case has to cover. It is the largest part of the work.

## 1. Start the crate

Run the tool from the rustify checkout and point it at a clean worktree of the
project, on a new branch:

```bash
cd <rustify checkout>
cargo run -q --release -- scaffold <project> --at <worktree>   # rs/Cargo.toml, rs/src/main.rs, rs/src/js_fallback.rs
cargo run -q --release -- vendor <project> --at <worktree>     # .github/workflows/rust-npm-release.yml
```

Then add the `rustify` block the scaffold prints to `package.json`, build once
and commit `Cargo.lock`. Add `manifest = "rs/Cargo.toml"` and `rust =
["rs/src"]` for the project in `projects.toml`, or the audit keeps reporting
that it has no Rust. The pull request's run builds six platforms and
install-tests them.

A project whose TypeScript lies at the repository root is `ts = ["."]`, and
the audit then counts every script in the repository as TypeScript to
replace. Only the scripts inside the `rust` directories of a crate that has a
directory of its own (`rs/src` for `rs/Cargo.toml`) are taken for the port's
own; a case generator elsewhere in `rs/` is not, so add `ignore = ["rs"]`.
The Rust is still counted: a directory listed under `rust` counts even when
an `ignore` entry holds it.

```toml
manifest = "rs/Cargo.toml"
ts = ["."]
rust = ["rs/src"]
ignore = ["rs", "skills"]
```

A crate at the repository root (`manifest = "Cargo.toml"`) shares its `src`
with the TypeScript, so there the file extension alone tells the two apart:
with `ts = ["."]` and `rust = ["src"]`, `src/index.ts` is TypeScript to
replace and `src/main.rs` is Rust. For such a crate the scaffold adds
`/target` to the project's own `.gitignore` and keeps everything else in it.

If `package.json` has no `files` list, the package ships its whole directory,
the crate included: add `rs/.npmignore` containing `*`, and check with `npm
pack --dry-run`.

Use `build:`, `test:` or `ci:` commit types for all of this, and for every
port commit after it: the project's users get nothing new until the owner
switches publishing on, so no release should be cut.

A package with several commands (`ay`, `claude-yes`, …) still needs only one
cargo bin: map every command to it in `rustify.bins`. The binary learns which
command it was started as from its own name, and the scaffold writes the
lookup from command to JavaScript file when the commands run different files.

One thing the hand-back cannot keep: under node, a script started through a
command's symlink sees that symlink's path in `process.argv[1]`; handed back,
it sees its own real path. (Under bun it always saw the real path.) A package
that runs on node, shares one file between several commands and tells them
apart by `argv[1]` needs its own answer, such as one small file per command.

`templates/rust/js_fallback.rs` carries a version in its first line. When the
template moves on, copy the new file over the crate's.

## 2. Write the cases before the code

Pick one command. Write down how it must behave as parity cases — the command
lines, the inputs, and what to look at afterwards — and run them **TypeScript
against TypeScript** first:

```bash
node <rustify>/templates/parity/parity.mjs --cases rs/parity.json \
  --ts "bun ts/cli.ts" --rs "bun ts/cli.ts"
```

That run has to pass. If it does not, a case is not deterministic (a
timestamp, a random id, a path): fix the case, or add one narrow `normalize`
rule. Every rule is a hole in the proof, so keep them few. `--show` prints
what each case compared; use it to catch a case whose probes fail the same way
on both sides and so prove nothing.

Cover, for the command:

- its plain use, and each flag that changes what it does;
- the ways it fails: missing argument, bad value, missing file, a server
  error. The exit code and the text on stderr are part of the behaviour;
- what it leaves behind (`after`: files, git state, config);
- input on stdin, if it reads any;
- where its settings come from: every file, variable and flag, and which one
  wins.

The runner starts each case in an empty directory with an empty `HOME`, its
own temp directory and no terminal. `<CWD>` and `<HOME>` in a case stand for
those directories and `<REPO>` for the directory the runner was started in,
so the cases file can be committed as it is. A command that talks to a service needs both implementations
pointed at the same stand-in: a mock server the project's tests already have,
a fake of the external program it calls, or recorded responses. Compare what
each implementation *asked* the stand-in for, not only what it printed. A
project that has such a harness can keep its own test instead of
`parity.mjs`; what matters is that one test runs both implementations and
compares everything they print and do.

What the runner cannot express needs its own small test beside it: one
implementation reading what the other wrote, a chosen working directory.

Patterns the ports needed, all built from a wrapper command put in front of
both implementations (`--ts "sh rs/parity/run.sh bun cli.ts" --rs "sh
rs/parity/run.sh rs/target/release/mycli"`):

- **The service's address is a constant in the code.** The wrapper starts a
  stand-in on a free port for this one run and tells the program where it is
  through the environment. `--ts "bun --preload …"` is not enough: it does not
  reach the JavaScript the binary hands back to, and those cases would talk
  to the real service. For the handed-back JavaScript the wrapper puts a
  `bun` shim first on `PATH`. The binary needs to be pointed at the stand-in
  too; a variable that accepts only `http://127.0.0.1:<port>` is the smallest
  way, and it is Rust-only behaviour that the owner has to bless or have
  removed.
- **A case that is handed back after a request** shows every request twice in
  the stand-in's log. Compare the distinct requests, and let the stand-in
  answer by what was asked, not by turn.
- **What the program asks another program** (git): the wrapper puts a shim of
  that program first on `PATH`, which logs its arguments and calls the real
  one; an `after` probe prints the log.
- **The program keeps state in its own install directory** (onenote-cli's
  search index): give each case its own copy of the package. Never point
  `<PROJECT>_PACKAGE_ROOT` at a checkout that can hold a developer's real
  data.
- **A value that must not be in the cases file** (dotenvdotenc refuses to
  commit a file holding a private key): the wrapper computes it.

On a machine other runs share, give the run a temp directory of its own
(`TMPDIR=$(mktemp -d)`), and never delete `rustify-parity-*` by pattern: the
directories of runs in progress are among them, and a run that loses its
directory reports differences that look like bugs in the port.

Never run the project's command by hand, outside the runner, unless `HOME`
points at a throwaway directory: on a signed-in machine a harmless-looking
command can read real credentials or start real work.

## 3. Port the command

Read all of the TypeScript the command runs, including the helpers and the
argument parser's configuration. Then write the Rust so the cases pass.

- **Port what is shared first**: global flags, where configuration and
  credentials come from, how output is formatted. Every later command needs
  them.
- **Byte for byte.** Same text, same order, same blank lines, same exit code.
  Do not improve anything on the way. A bug in the TypeScript is copied and
  reported to the owner; fixes are separate changes made to both sides.
- **When in doubt, hand back.** A handed-back command is merely not faster. A
  wrong native command is a bug in a release.

### Dependencies

Few, well-known crates, and nothing that links a library of the system: the
binary is built for six platforms and shipped as one static file. Crypto and
TLS in pure Rust (rustls). Two things need a C compiler all the same: `ring`
underneath rustls, and SQLite when it is compiled in. The pipeline builds
both for every platform it targets. A development machine usually cannot:
`cargo check --target <another platform>` stops in their build scripts. Put
what needs them behind a cargo feature, or compile it only for the platforms
it is ported for, so that the rest of the crate can still be type-checked
for every target, and take the first run of the pipeline as the test.

### What to hand back

Rust takes an invocation only when it implements that exact situation. It
hands back, before it has printed or changed anything:

- **Shapes of the command line it does not implement.** Usage errors,
  `--help`, and the argument parser's less common spellings (`-n10`, `--flag
  true`, repeated flags, `--`) belong to yargs or commander; their behaviour
  is hard to reproduce.
- **States of the machine it does not implement.** A configuration file that
  only a JavaScript parser reads the same way, an `.env` file with syntax the
  runtime interprets, proxy and certificate variables that the JavaScript's
  HTTP client honours differently.
- **Failures the JavaScript reports in its runtime's own words** (no
  connection, a response that is not JSON). This hand-back happens at run
  time and is only safe for a command that reads and has not printed yet: the
  JavaScript simply does the work again.

Say in the ledger which situations go back and how common they are. If the
common setup goes back (slack-hub's `settings.yml`, a qqdocs command typed at
a terminal, an onenote-cli search in a time zone where the runtime's data
differs), users get no speed-up yet, and that is worth knowing before
anything is announced.

### Handing back safely

A hand-back starts the whole invocation again in the JavaScript, so it is
correct only while nothing of the first attempt can be seen.

- **Work out the whole answer, then print it.** A ported command returns its
  output, or declines; `main` prints. Nothing reaches stdout or stderr on the
  way.
- **Read everything, then write.** A command that changes files first reads
  all it is going to need (every file, every answer from `git`), so that
  whatever it does not implement shows before the first write. After the
  first write there is no way back: stop with a message that names
  `<PROJECT>_NO_NATIVE=1`, and treat reaching that message as a bug.
- **A panic is a decline.** A bug in the port must not cost users their
  command. While nothing has been printed or changed, a panic hands back,
  silently.
- **A hand-back after a request repeats the request.** The JavaScript does
  all of the work again. For a command that only reads this is safe, and it
  costs: qqdocs sent 62 requests where the TypeScript sends 31, against a
  daily quota, and only half were counted locally. Record the cost in the
  ledger. After a request that creates, changes or deletes, it is never
  acceptable.
- **So a command that writes to a service** can be ported only when every
  failure after the request can be reported natively, in the TypeScript's
  own words. With yargs's default error report it cannot (see "What the
  TypeScript means"); the project first needs an error handler of its own,
  which is a change to the TypeScript for its owner to make.

## 4. Switch the command over

Add one arm for it in `main.rs`, guarded by `native()` so that
`<PROJECT>_NO_NATIVE=1` still hands everything back. That variable is the way
out for a user if a ported command misbehaves; keep it until the JavaScript is
gone. Guard everything the binary answers itself the same way, `--version`
included.

## 5. Prove which cases are native

A handed-back invocation passes its case by construction, so a green parity
run does not show that anything was ported. Mark every case that is *meant*
to reach the JavaScript with `"handback": "<why>"`, and run:

```bash
node <rustify>/templates/parity/parity.mjs --cases rs/parity.json \
  --rs rs/target/release/<bin> --handback <PROJECT>_PACKAGE_ROOT=<js entry>
```

It runs only the binary, with a stand-in package whose JavaScript entry does
nothing but say it was reached, and fails unless exactly the marked cases got
there. On genvx this caught four cases that were believed native.

For the ordinary parity run, the binary built in the repo has to know where
the package is, so that handed-back cases reach the real JavaScript:

```bash
--rs "env <PROJECT>_PACKAGE_ROOT=$PWD rs/target/release/<bin>"
```

(`$GITHUB_WORKSPACE` in CI. The JavaScript entry named in `main.rs` has to
exist there, so build it first if it is a build product.)

## 6. Make CI hold the line

Pass the proof to the pipeline in the project's workflow, in every workflow
that can lead to a release:

```yaml
    with:
      parity: >-
        bun install --frozen-lockfile
        && node "$RUSTIFY_PARITY" --cases rs/parity.json --ts "bun ts/cli.ts"
        --rs "env MYCLI_PACKAGE_ROOT=$GITHUB_WORKSPACE $RUSTIFY_BIN_DIR/mycli"
        && node "$RUSTIFY_PARITY" --cases rs/parity.json
        --rs "$RUSTIFY_BIN_DIR/mycli" --handback MYCLI_PACKAGE_ROOT=dist/cli.js
```

It runs on Linux against the freshly built binary and has to pass before
anything can be published. The job installs nothing by itself, hence the
`bun install`. The workflow's `paths:` must list the TypeScript as well as the
Rust, or a change to the TypeScript alone never reruns the comparison.
`rustify vendor` writes those lines from `projects.toml`: one pattern per
script extension for TypeScript at the root, `Cargo.toml`, `Cargo.lock`,
`build.rs` and the `rust` directories for a crate at the root.

Add a line to `smoke-extra` for the command too, so that every platform runs
it once after installing: `<command> [args] => <text>`, with a leading `[2] `
when it is meant to exit 2, a trailing ` !> <text>` for something it must not
print, and `smoke-env` for variables it needs. The parity job runs on Linux
only; the smoke lines are all that Windows and macOS get.

## 7. Record it

In `parity/<project>.toml` set the feature to `verified`, with `proof`
pointing at the cases file, and move `reconciled` forward. `rustify audit
<project>` shows the new count. It asks for a new reconciliation when a file of the
TypeScript has changed since `reconciled`: a script it counts, or any other
file under a named `ts` directory (a shell script the program runs, a
template it writes out). At the repository root only scripts count, so a
change to `package.json`, a workflow or the README does not ask for one.
Nothing under `ignore`, `keep_ts` or the crate counts. See `parity/README.md` for how to record a
command that is native in its plain use and handed back in some situations.

## 8. Have someone else try to break it

The author of a port tests what they thought of. All three ports that were
handed to an independent verifier afterwards passed every proof their author
had written, and all three behaved differently from the TypeScript somewhere:
a time zone table, the word `help`, a number that rounds two ways, a file the
runtime reads from the directories above.

Whoever verifies works on a fresh clone, does not change the port, and:

1. reproduces every proof from the commands the author gives;
2. writes new cases aimed at what the author may have missed (boundary
   values, empty and huge input, unusual but valid orders of flags, non-ASCII
   and CRLF content, files that are missing or unreadable, everything the
   runtime reads before the program starts), and runs them TypeScript against
   TypeScript first, then against the binary, then with `--handback`;
3. compares mechanically wherever the inputs can be generated: the argument
   gate against the project's own yargs chain (about 220,000 command lines
   for qqdocs: the only mismatches had `help` as the last word), the helper
   functions against the JavaScript they replace, every time zone name
   against the runtime;
4. reads every point where the binary hands back: is it before anything was
   printed or changed, and is every native arm behind `<PROJECT>_NO_NATIVE`?
5. reads the ledger against the code: is any status higher than what is
   proven?

Every difference is then repaired in one of two ways: the Rust is made to
behave like the TypeScript, or the situation is handed back. The verifier's
cases go into the committed cases file, the ones now handed back marked so.
A difference that comes from a defect in the TypeScript (output lost on a
slow reader) is not copied silently; it goes to the owner.

## Order of work

Port first what people run most and wait for longest: the commands used in
scripts and prompts, where start time is felt. Leave for last what is rare,
interactive, or tied to a JavaScript-only library (a browser driver, a
vendored SDK). If something cannot reasonably leave JavaScript, say so in the
ledger's `note` and ask the owner; do not mark it `dropped` yourself.

## Ready to publish

A project is ready when:

- its pull requests are green on all six platforms, parity job included;
- its release workflow publishes through the pipeline (see
  [npm-distribution.md](npm-distribution.md)) and passes the same `parity:`,
  rehearsed once with nothing published;
- the owner has decided to switch it on. Publishing is never an agent's call.
