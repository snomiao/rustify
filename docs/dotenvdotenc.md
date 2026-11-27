# dotenvdotenc

snomiao/dotenvdotenc PR #6, read at `18f80ca`. The owner's replacement for
genvx.

dotenvdotenc (`dede`) keeps each gitignored plaintext `.env*` file in sync
with a committed dotenvx-encrypted `.env*.enc` twin: one file of TypeScript
(`dede.ts`, about 1,100 lines) on top of `@dotenvx/primitives`.

## State

- Every command is native on Linux and macOS: `get`, `status`, `diff`,
  `keys`, `keys link`, `dec`, `enc` (with `-y` or without a terminal on
  stdin), `guard`, `health`, `setup`, help and usage errors. Windows hands
  everything back. `dede get` takes about 9 ms against about 180 ms.
- Proof: 1,176 parity cases, all the same against the glibc binary and the
  static musl binary; 995 answered by the binary, 181 handed back on purpose.
  Encryption interoperates both ways with `@dotenvx/primitives` and dotenvx,
  checked by a script that lets the two implementations take turns on the
  same files; further scripts cover a terminal, slow pipes and file
  permissions. Two rounds of independent verification each found
  differences; all are fixed or handed back.
- Ledger: 36 features, 21 verified, 1 ported, 1 partial, 13 missing.
- macOS is native but not yet compared there: the next step runs the cases
  on macOS in CI (`parity-platforms`).

## What still goes to the JavaScript

`enc` asking its question on a terminal; glob arguments; `.env*` files in
syntax bun interprets; huge values near bun's regular-expression limits;
`health` beyond the README's `.dede.yaml`; any situation in which the
TypeScript ends in bun's uncaught-error report; `get` of a value that may not
fit the pipe it goes into; everything on Windows.

## For the owner

- `dede guard` does not scan a staged file over about 1 MiB for private keys
  (bun's `spawnSync` cuts git's output off), so it lets a key through. The
  binary hands that situation back, so nothing changes yet; it is worth a fix
  in the TypeScript.
- `dede get` truncates a value written into a slow pipe (it calls
  `process.exit()` right after `process.stdout.write`).
- `dede enc --env-keys-file=` leaves a temp file holding a new private key.
- bun loads `.env` files before dede runs, so their plaintext values are in
  the environment of every git command and hook dede starts.
