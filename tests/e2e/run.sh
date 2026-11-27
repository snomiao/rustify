#!/usr/bin/env bash
# End-to-end rehearsal of the npm delivery in templates/npm, on this machine:
#
#   build a toy Rust binary → pack it → publish to a throwaway local registry
#   → install it globally with bun and with npm → check that the installed
#   command is the native binary, that it survives an upgrade, and how fast
#   it starts. Then the same for a package that still ships JavaScript: what
#   the binary hands back, what it answers itself, and what smoke.mjs makes
#   of both.
#
# Nothing touches the real registry or your real global installs: every
# install goes to a temp directory that is removed at the end.
#
#   tests/e2e/run.sh            launchers use bun (the default)
#   RUNTIME=node tests/e2e/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PACK="$REPO/templates/npm/pack.mjs"
RUNTIME="${RUNTIME:-bun}"
NAME="rustify-e2e-toy"
# Resolved, because macOS hands out temp directories behind a symlink.
WORK="$(cd "$(mktemp -d)" && pwd -P)"
REG_PID=""
cleanup() {
  [ -n "${KEEP:-}" ] && { echo "kept: $WORK"; [ -n "$REG_PID" ] && kill "$REG_PID" 2>/dev/null; return; }
  [ -n "$REG_PID" ] && kill "$REG_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

pass() { printf '  ok    %s\n' "$1"; }
die() { printf '  FAIL  %s\n' "$1"; exit 1; }
is_script() { [ "$(head -c 2 "$1")" = '#!' ]; }
# Milliseconds per run, averaged over 30 runs.
bench() {
  local start end i
  start=$(date +%s%N)
  for i in $(seq 30); do "$@" >/dev/null; done
  end=$(date +%s%N)
  awk -v ns=$((end - start)) 'BEGIN { printf "%.1f", ns / 30 / 1000000 }'
}

KEY="$(node -p '(process.platform === "android" ? "linux" : process.platform) + "-" + process.arch')"
case "$KEY" in
  linux-x64) FOREIGN=darwin-arm64 ;;
  *) FOREIGN=linux-x64 ;;
esac
EXT=""; case "$KEY" in win32-*) EXT=".exe" ;; esac

echo "== build (host platform: $KEY, launcher runtime: $RUNTIME)"
build() { # $1 = version
  TOY_VERSION="$1" cargo build --release --quiet --manifest-path "$HERE/toy/Cargo.toml" --target-dir "$WORK/target"
  mkdir -p "$WORK/artifacts-$1/$KEY" "$WORK/artifacts-$1/$FOREIGN"
  cp "$WORK/target/release/toy$EXT" "$WORK/artifacts-$1/$KEY/toy$EXT"
  # A second binary, without the hand-back helper.
  cp "$WORK/target/release/toy-helper$EXT" "$WORK/artifacts-$1/$KEY/toy-helper$EXT"
  # A build for some other platform, to prove it is NOT installed here.
  FEXT=""; case "$FOREIGN" in win32-*) FEXT=".exe" ;; esac
  echo "not for this machine" > "$WORK/artifacts-$1/$FOREIGN/toy$FEXT"
}

mkdir -p "$WORK/project"
cat > "$WORK/project/package.json" <<EOF
{
  "name": "$NAME",
  "version": "0.0.0",
  "description": "rustify end-to-end fixture",
  "license": "MIT",
  "rustify": {
    "bins": { "toy": "toy", "toy-alias": "toy" },
    "runtime": "$RUNTIME"
  }
}
EOF

echo "== local registry"
node "$REPO/templates/npm/registry.mjs" "$WORK/registry" > "$WORK/registry.url" &
REG_PID=$!
for _ in $(seq 50); do [ -s "$WORK/registry.url" ] && break; sleep 0.1; done
REGISTRY="$(cat "$WORK/registry.url")"
[ -n "$REGISTRY" ] || die "registry did not start"
echo "//${REGISTRY#http://}/:_authToken=e2e" > "$WORK/npmrc"
export NPM_CONFIG_USERCONFIG="$WORK/npmrc" NPM_CONFIG_TOKEN=e2e

release() { # $1 = version
  build "$1"
  node "$PACK" pack --package "$WORK/project/package.json" --artifacts "$WORK/artifacts-$1" \
    --version "$1" --out "$WORK/npm-dist-$1" --allow-missing >/dev/null
  node "$PACK" publish --out "$WORK/npm-dist-$1" --registry "$REGISTRY" >/dev/null
}
release 1.2.3
pass "packed and published $NAME@1.2.3 (+ $KEY and $FOREIGN builds)"
node "$PACK" publish --out "$WORK/npm-dist-1.2.3" --registry "$REGISTRY" | grep -q "already published" \
  && pass "publishing the same release again is a no-op" || die "re-publish was not tolerated"

check_install() { # $1 = label, $2 = bin dir, $3 = node_modules dir
  local label="$1" bin="$2/toy" mods="$3" out
  [ -e "$bin" ] || die "$label: no toy command in $2"
  [ ! -e "$mods/$NAME-$FOREIGN" ] && pass "$label: $FOREIGN build was not installed" \
    || die "$label: installed a build for another platform"
  is_script "$bin" && pass "$label: fresh install starts through the launcher" \
    || die "$label: expected a launcher before the first run"
  out="$("$bin" hello)"
  [[ "$out" == *"version=1.2.3"* && "$out" == *'args=["hello"]'* ]] && pass "$label: first run works ($RUNTIME launcher)" \
    || die "$label: first run printed: $out"
  if is_script "$bin"; then die "$label: the command is still a script after the first run"; fi
  pass "$label: after the first run the command is the native binary"
  out="$("$bin" again)"
  # Linux reports the resolved file; macOS reports the path it was started through.
  [[ "$out" == *"exe=$(realpath "$bin") "* || "$out" == *"exe=$bin "* ]] \
    && pass "$label: second run is native, with no launcher in between" \
    || die "$label: second run printed: $out"
  is_script "$2/toy-alias" && die "$label: the second command was not linked" || true
  out="$("$2/toy-alias")"
  [[ "$out" == *"/toy-alias "* ]] && pass "$label: a second command of the same binary keeps its own name" \
    || die "$label: alias printed: $out"
  set +e; "$bin" exit 7 >/dev/null; local code=$?; set -e
  [ "$code" = 7 ] && pass "$label: exit code is passed through" || die "$label: exit code was $code"
}

echo "== bun i -g"
export BUN_INSTALL="$WORK/bun" BUN_INSTALL_CACHE_DIR="$WORK/bun-cache"
BUN_MODS="$BUN_INSTALL/install/global/node_modules"
bun i -g "$NAME" --registry "$REGISTRY" >"$WORK/bun-install.log" 2>&1 || { cat "$WORK/bun-install.log"; die "bun i -g failed"; }
grep -qi "blocked" "$WORK/bun-install.log" && die "bun reported a blocked install script" \
  || pass "bun: no install script involved"
check_install bun "$BUN_INSTALL/bin" "$BUN_MODS"

echo "== npm i -g"
if command -v npm >/dev/null 2>&1; then
  NPM_PREFIX="$WORK/npm"
  npm i -g --prefix "$NPM_PREFIX" "$NAME" --registry "$REGISTRY" >"$WORK/npm-install.log" 2>&1 || { cat "$WORK/npm-install.log"; die "npm i -g failed"; }
  check_install npm "$NPM_PREFIX/bin" "$NPM_PREFIX/lib/node_modules/$NAME/node_modules"
else
  echo "  skip  npm is not installed on this machine"
fi

echo "== upgrade"
release 1.2.4
# bun keeps registry answers for a few minutes; drop them to stand in for time passing.
rm -f "$BUN_INSTALL_CACHE_DIR"/*.npm
bun i -g "$NAME@latest" --registry "$REGISTRY" >"$WORK/bun-upgrade.log" 2>&1 || { cat "$WORK/bun-upgrade.log"; die "bun upgrade failed"; }
out="$("$BUN_INSTALL/bin/toy")"
[[ "$out" == *"version=1.2.4"* ]] && pass "bun: upgrade runs the new binary, not a stale link" || die "after upgrade: $out"
out="$("$BUN_INSTALL/bin/toy")"
[[ "$out" == *"version=1.2.4"* ]] && ! is_script "$BUN_INSTALL/bin/toy" && pass "bun: upgraded command is native again" \
  || die "after upgrade, second run: $out"

echo "== opt out"
export BUN_INSTALL="$WORK/bun-nolink"
bun i -g "$NAME" --registry "$REGISTRY" >/dev/null 2>&1
out="$(RUSTIFY_NO_LINK=1 "$BUN_INSTALL/bin/toy")"
is_script "$BUN_INSTALL/bin/toy" && [[ "$out" == *"root=$BUN_INSTALL/install/global/node_modules/$NAME "* ]] \
  && pass "RUSTIFY_NO_LINK=1 leaves the package untouched and tells the binary where the package is" \
  || die "opt out: $out"

echo "== hybrid: a package that still ships JavaScript"
HYBRID="rustify-e2e-hybrid"
mkdir -p "$WORK/hybrid/dist"
printf '%s\n' \
  '{' \
  "  \"name\": \"$HYBRID\"," \
  '  "version": "2.0.0",' \
  '  "type": "module",' \
  '  "license": "MIT",' \
  '  "bin": { "toy": "dist/cli.js", "legacy": "dist/cli.js" },' \
  '  "files": ["dist"],' \
  '  "scripts": { "prepublishOnly": "exit 1" },' \
  '  "devDependencies": { "typescript": "^5" },' \
  "  \"rustify\": { \"mode\": \"hybrid\", \"bins\": { \"toy\": \"toy\", \"plain\": \"toy-helper\" }, \"runtime\": \"$RUNTIME\" }" \
  '}' > "$WORK/hybrid/package.json"
# The JavaScript prints its arguments. `which-runtime`, `homedir` and `trace`
# are answered with the runtime it runs on, the home directory it sees and
# the value of RUSTIFY_HANDBACK_TRACE.
printf '%s\n' \
  "#!/usr/bin/env $RUNTIME" \
  'import os from "node:os";' \
  'const answers = { "which-runtime": typeof Bun === "undefined" ? "node" : "bun", homedir: os.homedir(), trace: process.env.RUSTIFY_HANDBACK_TRACE ?? "unset" };' \
  'console.log("js cli:", process.argv.slice(2).map((arg) => (Object.hasOwn(answers, arg) ? answers[arg] : arg)).join(" "));' \
  > "$WORK/hybrid/dist/cli.js"
chmod +x "$WORK/hybrid/dist/cli.js"
node "$PACK" pack --package "$WORK/hybrid/package.json" --artifacts "$WORK/artifacts-1.2.4" \
  --out "$WORK/npm-dist-hybrid" --allow-missing >/dev/null
node "$PACK" publish --out "$WORK/npm-dist-hybrid" --registry "$REGISTRY" >/dev/null
export BUN_INSTALL="$WORK/bun-hybrid"
bun i -g "$HYBRID" --registry "$REGISTRY" >/dev/null 2>&1 || die "bun i -g $HYBRID failed"
[ "$("$BUN_INSTALL/bin/legacy" still here)" = "js cli: still here" ] \
  && pass "a command that is still JavaScript keeps working" || die "the JavaScript command broke"
out="$(RUSTIFY_NO_LINK=1 "$BUN_INSTALL/bin/toy" js one)"
[ "$out" = "js cli: js one" ] && pass "native command hands an unported command to the JavaScript (through the launcher)" \
  || die "fallback through the launcher printed: $out"
"$BUN_INSTALL/bin/toy" native >/dev/null
if is_script "$BUN_INSTALL/bin/toy"; then die "hybrid: the command was not linked"; fi
out="$("$BUN_INSTALL/bin/toy" js two)"
[ "$out" = "js cli: js two" ] && pass "and still does once the command is the native binary itself" \
  || die "fallback from the linked binary printed: $out"
out="$("$BUN_INSTALL/bin/toy" js which-runtime)"
[ "$out" = "js cli: js $RUNTIME" ] && pass "the JavaScript runs on the runtime its own first line names ($RUNTIME)" \
  || die "the hand-back ran: $out (expected $RUNTIME)"

echo "== hybrid: a ported command that declines, and one that panics"
TOY="$BUN_INSTALL/bin/toy"
TRACE="rustify: handed back to the JavaScript"
[ "$("$TOY" answer 2>&1)" = "toy answers natively" ] && pass "a ported command prints the answer it worked out" \
  || die "toy answer printed: $("$TOY" answer 2>&1)"
out="$("$TOY" decline politely 2>&1)"
[ "$out" = "js cli: decline politely" ] && pass "a command that declines is handed back" || die "toy decline printed: $out"
out="$("$TOY" panic quietly 2>&1)"
[ "$out" = "js cli: panic quietly" ] && pass "a panic before anything was printed is handed back, and nothing else shows" \
  || die "toy panic printed: $out"
out="$("$TOY" panic-thread 2>&1)"
[ "$out" = "js cli: panic-thread" ] && pass "so is a panic in a worker thread the command started" \
  || die "toy panic-thread printed: $out"
set +e; out="$("$TOY" panic-late 2>&1)"; code=$?; set -e
[[ "$code" = 101 && "$out" == "toy began to answer"* && "$out" == *"a bug after the first output"* && "$out" != *"js cli"* ]] \
  && pass "a panic after commit() is reported and ends the command (exit 101); the JavaScript is not started" \
  || die "toy panic-late exited $code and printed: $out"
out="$(RUSTIFY_HANDBACK_TRACE=1 "$TOY" js trace 2>&1)"
[ "$out" = "$TRACE"$'\n'"js cli: js unset" ] \
  && pass "RUSTIFY_HANDBACK_TRACE=1: the hand-back says so on stderr, before the JavaScript starts, which does not get the variable" \
  || die "traced hand-back printed: $out"
out="$(RUSTIFY_HANDBACK_TRACE=1 "$TOY" check 2>&1)"
[[ "$out" == "toy version="* && "$out" != *"$TRACE"* ]] && pass "and a native answer stays as it is" || die "traced native answer printed: $out"
out="$(RUSTIFY_HANDBACK_TRACE=1 "$TOY" panic loudly 2>&1)"
[[ "$out" == *"a bug in a ported command"*"$TRACE"*"js cli: panic loudly" ]] \
  && pass "with the trace on, a swallowed panic is reported before the hand-back" || die "traced panic printed: $out"

echo "== panic = \"abort\": nothing can be handed back"
cargo build --release --quiet --manifest-path "$HERE/toy/Cargo.toml" --target-dir "$WORK/target-abort" \
  --config 'profile.release.panic="abort"'
ABORT="$WORK/target-abort/release/toy$EXT"
out="$(RUSTIFY_PACKAGE_ROOT="$WORK/hybrid" "$ABORT" decline politely 2>&1)"
[ "$out" = "js cli: decline politely" ] && pass "declining still hands back" || die "abort build, decline: $out"
# No core file, please.
set +e; out="$( (ulimit -c 0; RUSTIFY_PACKAGE_ROOT="$WORK/hybrid" "$ABORT" panic quietly) 2>&1 )"; code=$?; set -e
[[ "$code" != 0 && "$out" == *"a bug in a ported command"* && "$out" != *"js cli"* ]] \
  && pass "a panic ends the process with its message (exit $code); the JavaScript is not started" \
  || die "abort build, panic: exit $code, printed: $out"

echo "== a package without a files list: the crate stays out of it"
NOFILES="rustify-e2e-nofiles"
mkdir -p "$WORK/nofiles/dist" "$WORK/nofiles/rs/src"
printf '%s\n' \
  '{' \
  "  \"name\": \"$NOFILES\"," \
  '  "version": "3.0.0",' \
  '  "type": "module",' \
  '  "license": "MIT",' \
  '  "bin": { "legacy": "dist/cli.js" },' \
  "  \"rustify\": { \"mode\": \"hybrid\", \"bins\": { \"toy\": \"toy\" }, \"runtime\": \"$RUNTIME\" }" \
  '}' > "$WORK/nofiles/package.json"
cp "$WORK/hybrid/dist/cli.js" "$WORK/nofiles/dist/cli.js"
# Stands for the crate a real project keeps beside its package.json.
printf '[package]\nname = "toy"\nversion = "3.0.0"\n' > "$WORK/nofiles/rs/Cargo.toml"
echo 'fn main() {}' > "$WORK/nofiles/rs/src/main.rs"
echo '{ "cases": [] }' > "$WORK/nofiles/rs/parity.json"
node "$PACK" pack --package "$WORK/nofiles/package.json" --artifacts "$WORK/artifacts-1.2.4" \
  --out "$WORK/npm-dist-nofiles-before" --allow-missing >/dev/null
[ -f "$WORK/npm-dist-nofiles-before/main/rs/Cargo.toml" ] && pass "without --manifest the crate is shipped, as before" \
  || die "pack without --manifest left the crate out"
# The paths are relative, as the workflow passes them.
(cd "$WORK/nofiles" && node "$PACK" pack --manifest rs/Cargo.toml --artifacts "$WORK/artifacts-1.2.4" \
  --out "$WORK/npm-dist-nofiles" --allow-missing) | grep -q "left out: rs/ (the crate, 3 files)" \
  || die "pack --manifest did not report the crate"
[ ! -e "$WORK/npm-dist-nofiles/main/rs" ] && [ -f "$WORK/npm-dist-nofiles/main/dist/cli.js" ] \
  && pass "with --manifest the crate's directory is left out and the JavaScript is kept" \
  || die "pack --manifest: $(cd "$WORK/npm-dist-nofiles/main" && find . -type f | tr '\n' ' ')"
node "$PACK" publish --out "$WORK/npm-dist-nofiles" --registry "$REGISTRY" >/dev/null
export BUN_INSTALL="$WORK/bun-nofiles"
bun i -g "$NOFILES" --registry "$REGISTRY" >/dev/null 2>&1 || die "bun i -g $NOFILES failed"
[ ! -e "$BUN_INSTALL/install/global/node_modules/$NOFILES/rs" ] \
  && [ "$("$BUN_INSTALL/bin/legacy" still here)" = "js cli: still here" ] \
  && [ "$("$BUN_INSTALL/bin/toy" js handed back)" = "js cli: js handed back" ] \
  && pass "installed, the package has no crate, and its JavaScript and its hand-back work" \
  || die "the package without a files list is broken after installing"

echo "== smoke.mjs (the check that CI runs on every OS)"
SMOKE="$REPO/templates/npm/smoke.mjs"
# The commands under test get a home directory of their own. XDG_CONFIG_HOME
# stands for a variable that points into the real one.
WHERE="toy where rustify-smoke- HOME USERPROFILE XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME"
XDG_CONFIG_HOME="$WORK/real-config" node "$SMOKE" --dist "$WORK/npm-dist-1.2.4" --run "toy check" --expect "version=1.2.4" \
  --also "$WHERE => HOME:inside USERPROFILE:inside XDG_CONFIG_HOME:unset XDG_DATA_HOME:unset XDG_STATE_HOME:unset XDG_CACHE_HOME:unset" \
  --also "[real-home] toy where rustify-smoke- HOME XDG_CONFIG_HOME => HOME:outside XDG_CONFIG_HOME:outside" \
  | sed 's/^/  /' || die "smoke.mjs failed"

echo "== smoke.mjs: a first command that is meant to fail"
# A program that never exits 0 on its own (a server that runs until stopped)
# can still be the command the launcher starts first: [N] says which exit code.
node "$SMOKE" --dist "$WORK/npm-dist-1.2.4" --run "[3] toy exit 3" --expect "version=1.2.4" --installer bun \
  | sed 's/^/  /' || die "smoke.mjs failed for --run with an exit code"
set +e
out="$(node "$SMOKE" --dist "$WORK/npm-dist-1.2.4" --run "[3] toy exit 4" --expect "version=1.2.4" --installer bun 2>&1)"
code=$?
set -e
[ "$code" = 1 ] && [[ "$out" == *"exited 4"* ]] && pass "--run [3] fails when the command exits 4" \
  || die "smoke.mjs should have failed for exit code 4 against [3]. It exited $code and printed: $out"

echo "== smoke.mjs: who answered, in a package that still ships JavaScript"
# --env wins over the home directory the test hands out. The trace is on where
# the test is started: only the marked lines may see it.
RUSTIFY_HANDBACK_TRACE=1 node "$SMOKE" --dist "$WORK/npm-dist-hybrid" --run "toy check" --expect "version=1.2.4" \
  --env "XDG_CONFIG_HOME=$WORK/chosen-config" \
  --also "toy where chosen-config XDG_CONFIG_HOME HOME => XDG_CONFIG_HOME:inside HOME:outside" \
  --also "[native] toy check => version=1.2.4" \
  --also "[native] toy answer => toy answers natively" \
  --also "[handback] toy js handed back => js cli: js handed back" \
  --also "[handback] toy decline politely => js cli: decline politely" \
  --also "toy where 1 RUSTIFY_HANDBACK_TRACE => RUSTIFY_HANDBACK_TRACE:unset" \
  --also "[handback] toy js trace => js cli: js unset" \
  --also "toy panic quietly => js cli: panic quietly !> panicked" \
  --also "toy panic-thread => js cli: panic-thread !> panicked" \
  --also "[handback] toy panic loudly => a bug in a ported command" \
  --also "[101] toy panic-late => a bug after the first output !> js cli" \
  --also "[native:$KEY] [handback:$FOREIGN] toy check => version=1.2.4" \
  --also "[handback:${KEY%%-*}] [native:$FOREIGN] toy js here => js cli: js here" \
  --also "toy js homedir => rustify-smoke-" \
  --also "legacy homedir => rustify-smoke-" \
  | sed 's/^/  /' || die "smoke.mjs failed on the hybrid package"

echo "== smoke.mjs: a runtime behind a version manager's shim"
# The shim stands for asdf's or mise's: it finds the runtime under the real
# home directory only, so it fails with the one the commands under test get.
REAL_RUNTIME="$(command -v "$RUNTIME")"
mkdir -p "$WORK/shim"
printf '#!/bin/sh\n[ "$HOME" = "%s" ] || { echo "shim: no %s version is set for this home" >&2; exit 126; }\nexec "%s" "$@"\n' \
  "$HOME" "$RUNTIME" "$REAL_RUNTIME" > "$WORK/shim/$RUNTIME"
chmod +x "$WORK/shim/$RUNTIME"
[ "$(HOME="$WORK" PATH="$WORK/shim:$PATH" "$RUNTIME" --version 2>&1)" = "shim: no $RUNTIME version is set for this home" ] \
  || die "the stand-in shim does not fail without the real home directory"
out="$(PATH="$WORK/shim:$PATH" node "$SMOKE" --dist "$WORK/npm-dist-hybrid" --run "toy check" --expect "version=1.2.4" --installer bun \
  --also "[handback] toy js shimmed => js cli: js shimmed" --also "legacy shimmed => js cli: shimmed" 2>&1)" \
  || die "smoke.mjs failed with a shim in PATH: $out"
[[ "$out" == *"note  $RUNTIME does not start with the home directory the commands under test get; they get $(dirname "$REAL_RUNTIME") first in PATH"* ]] \
  && pass "a $RUNTIME the shim cannot start there is found where it really is, and the launcher, the hand-back and the JavaScript command work" \
  || die "smoke.mjs did not say where it found $RUNTIME: $out"

echo "== smoke.mjs: what it must refuse"
set +e
out="$(node "$SMOKE" --dist "$WORK/npm-dist-hybrid" --run "toy check" --expect "version=1.2.4" --installer bun --real-home \
  --also "toy where rustify-smoke- HOME => HOME:outside" \
  --also "[native] toy js handed back => js cli: js handed back" \
  --also "[handback] toy check => version=1.2.4" \
  --also "[native] legacy hello => js cli: hello" \
  --also "[native] plain => toy-helper" \
  --also "[handback] plain => toy-helper" \
  --also "[natvie] toy check => version=1.2.4" \
  --also "[native:windows] toy check => version=1.2.4" 2>&1)"
code=$?
set -e
said() { [[ "$out" == *"$1"* ]] && pass "$2" || die "smoke.mjs did not say \"$1\". It exited $code and printed: $out"; }
[ "$code" = 1 ] || die "smoke.mjs should have failed. It exited $code and printed: $out"
said "ok    bun: \`toy where rustify-smoke- HOME\` works" "--real-home leaves the commands their real home directory"
said "\`toy js handed back\` is marked [native], but the binary handed it back" "[native] fails for a command that was handed back"
said "\`toy check\` is marked [handback], but the binary answered it itself" "[handback] fails for a command the binary answered"
said "\`legacy\` is a JavaScript command of this package" "[native] fails for a command that is JavaScript"
said "\`plain\` is marked [native], but who answered it cannot be seen: the binary behind \`plain\` never says when it hands back" \
  "[native] fails for a binary without the helper v5: its silence is not taken for a native answer"
said "\`plain\` is marked [handback], but who answered it cannot be seen" "and so does [handback]"
said "unknown marker [natvie]" "a misspelt marker is an error"
said "[native:windows] in" "so is a platform that does not exist"
said "7 check(s) failed" "seven lines failed, and nothing else"

echo "== startup time (ms per run, 30 runs)"
printf '  %-46s %s\n' "binary run directly" "$(bench "$WORK/target/release/toy$EXT")"
printf '  %-46s %s\n' "installed command after first run" "$(bench "$WORK/bun/bin/toy")"
printf '  %-46s %s\n' "installed command, $RUNTIME launcher every run" "$(RUSTIFY_NO_LINK=1 bench "$WORK/bun-nolink/bin/toy")"
echo "all checks passed"
