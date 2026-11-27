# dotenvdotenc

snomiao/dotenvdotenc PR #6, read at `6a3f40c`. The owner's replacement for
genvx.

dotenvdotenc (`dede`) keeps each gitignored plaintext `.env*` file in sync
with a committed dotenvx-encrypted `.env*.enc` twin: one file of TypeScript
(`dede.ts`, about 1,100 lines) on top of `@dotenvx/primitives`.

## State

- Every command is native on Linux and macOS: `get`, `status`, `diff`,
  `keys`, `keys link`, `dec`, `enc` (with `-y` or without a terminal on
  stdin), `guard`, `health`, `setup`, help and usage errors. Windows hands
  everything back. `dede get` takes about 9 ms against about 180 ms.
- Proof, on Linux x64, macOS arm64 and Windows 11 x64, each with its own
  bun, with 1.4.2 (the pinned one) and with 1.4.5: 1,180 parity cases, all
  the same as the TypeScript. On Linux 999 are answered by the binary and 181
  handed back on purpose; on macOS 997 and 182, with one skipped (a 70 KB
  value into a socket, where bun's own output varies from run to run); on
  Windows all 1,100 that run there are handed back, and 80 that cannot mean
  the same there (most need a symbolic link) are skipped.
  `rs/parity/proof.sh` runs it all, and the parity job runs that on the
  three systems: green in CI on all three at `6a3f40c`.
- Encryption interoperates both ways with `@dotenvx/primitives` and dotenvx,
  checked by a script that lets the two implementations take turns on the
  same files; further scripts cover a terminal, slow pipes and file
  permissions, on Linux and macOS. Two rounds of independent verification
  each found differences; all are fixed or handed back.
- Ledger: 36 features, 22 verified, 1 partial, 13 missing. macOS is verified;
  Windows stays missing, since it hands everything back.
- linux-arm64 and darwin-x64 answer natively with only the install test's
  smoke lines run on them.

## What still goes to the JavaScript

`enc` asking its question on a terminal; glob arguments; `.env*` files in
syntax bun interprets; huge values near bun's regular-expression limits;
`health` beyond the README's `.dede.yaml`; any situation in which the
TypeScript ends in bun's uncaught-error report; `get` of a value that may not
fit the pipe it goes into (on macOS, any `get` with a value into a pipe or a
socket); everything on Windows.

## For the owner

- `dede guard` does not scan a staged file over about 1 MiB for private keys
  (bun's `spawnSync` cuts git's output off), so it lets a key through. The
  binary hands that situation back, so nothing changes yet; it is worth a fix
  in the TypeScript.
- `dede get` truncates a value written into a slow pipe (it calls
  `process.exit()` right after `process.stdout.write`), on Linux and macOS.
- On macOS, `$(dede get X)` could be native too: fstat of a pipe's writing
  end gives the bytes waiting and the buffer size there. Not implemented.
- `dede enc --env-keys-file=` leaves a temp file holding a new private key.
- bun loads `.env` files before dede runs, so their plaintext values are in
  the environment of every git command and hook dede starts.
