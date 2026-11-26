#!/usr/bin/env bash
# End-to-end rehearsal of the npm delivery in templates/npm, on this machine:
#
#   build a toy Rust binary → pack it → publish to a throwaway local registry
#   → install it globally with bun and with npm → check that the installed
#   command is the native binary, that it survives an upgrade, and how fast
#   it starts.
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
WORK="$(mktemp -d)"
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
export NPM_CONFIG_USERCONFIG="$WORK/npmrc"

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
  [[ "$out" == *"exe=$(realpath "$bin")"* ]] && pass "$label: second run is native, from the package's own bin directory" \
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
NPM_PREFIX="$WORK/npm"
npm i -g --prefix "$NPM_PREFIX" "$NAME" --registry "$REGISTRY" >"$WORK/npm-install.log" 2>&1 || { cat "$WORK/npm-install.log"; die "npm i -g failed"; }
check_install npm "$NPM_PREFIX/bin" "$NPM_PREFIX/lib/node_modules/$NAME/node_modules"

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
  "  \"rustify\": { \"mode\": \"hybrid\", \"bins\": { \"toy\": \"toy\" }, \"runtime\": \"$RUNTIME\" }" \
  '}' > "$WORK/hybrid/package.json"
printf '#!/usr/bin/env %s\nconsole.log("js cli:", process.argv.slice(2).join(" "));\n' "$RUNTIME" > "$WORK/hybrid/dist/cli.js"
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

echo "== smoke.mjs (the check that CI runs on every OS)"
node "$REPO/templates/npm/smoke.mjs" --dist "$WORK/npm-dist-1.2.4" --run "toy check" --expect "version=1.2.4" \
  | sed 's/^/  /' || die "smoke.mjs failed"

echo "== startup time (ms per run, 30 runs)"
printf '  %-46s %s\n' "binary run directly" "$(bench "$WORK/target/release/toy$EXT")"
printf '  %-46s %s\n' "installed command after first run" "$(bench "$WORK/bun/bin/toy")"
printf '  %-46s %s\n' "installed command, $RUNTIME launcher every run" "$(RUSTIFY_NO_LINK=1 bench "$WORK/bun-nolink/bin/toy")"
echo "all checks passed"
