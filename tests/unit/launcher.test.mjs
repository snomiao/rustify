// Unit tests for the shim rewriting in templates/npm/launcher.cjs.
//
// The `.bunx` samples are built by an encoder written from bun's
// `BinLinkingShim::encode_into`, independently of the code under test. These
// tests catch offset mistakes; whether bun's real shim accepts the result is
// checked by smoke.mjs on Windows runners.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const launcher = require("../../templates/npm/launcher.cjs");
const { directBunx, bunxTarget, retargetBun, retargetNpm, BUNX_VERSION } = launcher;

function u16(...values) {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
}
function u32(...values) {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32LE(v, i * 4));
  return b;
}
// bun's encoder: [bin_path]["][0]([launcher][space][u32 path bytes][u32 launcher bytes incl. space])[flags]
function encode(binPath, launcherName, { absolute = false, version = BUNX_VERSION } = {}) {
  const isNode = launcherName === "node";
  const isNodeOrBun = isNode || launcherName === "bun" || launcherName === "bun run";
  const flags =
    (launcherName && isNodeOrBun ? 1 : 0) |
    (isNode ? 2 : 0) |
    (launcherName ? 4 : 0) |
    (absolute ? 8 : 0) |
    (version << 4);
  const parts = [Buffer.from(binPath, "utf16le"), u16(0x22, 0)];
  if (launcherName) {
    parts.push(Buffer.from(launcherName, "utf16le"), u16(0x20));
    parts.push(u32(binPath.length * 2, launcherName.length * 2 + 2));
  }
  parts.push(u16(flags));
  return Buffer.concat(parts);
}

const TARGET = "install\\global\\node_modules\\pkg\\bin\\toy";

test("a shebang .bunx becomes the direct form with the suffix added", () => {
  for (const name of ["bun", "node", "bun run"]) {
    assert.deepEqual(directBunx(encode(TARGET, name), ".exe"), encode(`${TARGET}.exe`, null));
  }
});

test("the absolute-target flag survives", () => {
  const abs = "C:\\Users\\me\\AppData\\Roaming\\pkg\\bin\\toy";
  assert.deepEqual(
    directBunx(encode(abs, "bun", { absolute: true }), ".exe"),
    encode(`${abs}.exe`, null, { absolute: true }),
  );
});

test("non-ASCII paths keep their bytes", () => {
  const p = "install\\global\\node_modules\\包\\bin\\工具";
  assert.deepEqual(directBunx(encode(p, "bun"), ".exe"), encode(`${p}.exe`, null));
});

test("anything unfamiliar is left alone", () => {
  const good = encode(TARGET, "bun");
  assert.equal(directBunx(encode(TARGET, null), ".exe"), null, "already direct");
  assert.equal(directBunx(encode(TARGET, "bun", { version: BUNX_VERSION + 1 }), ".exe"), null, "newer format");
  assert.equal(directBunx(good.subarray(0, good.length - 2), ".exe"), null, "truncated");
  assert.equal(directBunx(good.subarray(1), ".exe"), null, "odd length");
  assert.equal(directBunx(Buffer.concat([u16(0x41), good]), ".exe"), null, "length fields do not add up");
  assert.equal(directBunx(Buffer.alloc(0), ".exe"), null, "empty");
  assert.equal(directBunx("text", ".exe"), null, "not a buffer");
});

test("the target can be read back from both forms", () => {
  assert.deepEqual(bunxTarget(encode(TARGET, "bun")), { path: TARGET, absolute: false });
  assert.deepEqual(bunxTarget(encode(`${TARGET}.exe`, null)), { path: `${TARGET}.exe`, absolute: false });
  assert.equal(bunxTarget(encode(TARGET, "bun", { version: 1 })), null);
});

test("retargetBun rewrites only a shim that starts this launcher", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-unit-"));
  try {
    const shimDir = path.join(home, "bin");
    const rel = path.join("install", "global", "node_modules", "pkg", "bin", "toy");
    const launcherPath = path.join(home, rel);
    fs.mkdirSync(shimDir, { recursive: true });
    const file = path.join(shimDir, "toy.bunx");

    fs.writeFileSync(file, encode(rel, "bun"));
    assert.equal(retargetBun(shimDir, "toy", path.join(home, "elsewhere", "toy")), false);
    assert.deepEqual(fs.readFileSync(file), encode(rel, "bun"), "a foreign shim is not touched");

    assert.equal(retargetBun(shimDir, "toy", launcherPath), true);
    assert.deepEqual(fs.readFileSync(file), encode(`${rel}.exe`, null));
    assert.equal(retargetBun(shimDir, "toy", launcherPath), false, "second call has nothing to do");
    assert.equal(retargetBun(shimDir, "missing", launcherPath), false);
    assert.deepEqual(fs.readdirSync(shimDir), ["toy.bunx"], "no temp files left behind");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("retargetNpm rewrites the three shims of this launcher and no others", () => {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-unit-"));
  try {
    const rel = path.join("node_modules", "pkg", "bin", "toy");
    const launcherPath = path.join(prefix, rel);
    const native = `${launcherPath}.exe`;
    const posix = rel.split(path.sep).join("/");
    // Shaped like cmd-shim's output.
    fs.writeFileSync(path.join(prefix, "toy.cmd"), `@ECHO off\r\n"%_prog%"  "%dp0%${path.sep}${rel}" %*\r\n`);
    fs.writeFileSync(path.join(prefix, "toy.ps1"), `& "$basedir/node$exe"  "$basedir/${posix}" $args\n`);
    fs.writeFileSync(path.join(prefix, "toy"), `exec node  "$basedir/${posix}" "$@"\n`);
    fs.writeFileSync(path.join(prefix, "other.cmd"), `"%dp0%${path.sep}node_modules${path.sep}other${path.sep}cli.js" %*\r\n`);

    assert.equal(retargetNpm(prefix, "other", launcherPath, native), false);
    assert.equal(retargetNpm(prefix, "toy", launcherPath, native), true);
    const cmd = fs.readFileSync(path.join(prefix, "toy.cmd"), "utf8");
    assert.equal(cmd, `@ECHO off\r\n"%~dp0${rel}.exe" %*\r\n`);
    assert.match(fs.readFileSync(path.join(prefix, "toy.ps1"), "utf8"), /Join-Path \$PSScriptRoot "node_modules\/pkg\/bin\/toy\.exe"/);
    assert.match(fs.readFileSync(path.join(prefix, "toy"), "utf8"), /exec "\$basedir\/node_modules\/pkg\/bin\/toy\.exe" "\$@"/);
    assert.match(fs.readFileSync(path.join(prefix, "other.cmd"), "utf8"), /other/);
    assert.equal(retargetNpm(prefix, "toy", launcherPath, native), false, "second call has nothing to do");
  } finally {
    fs.rmSync(prefix, { recursive: true, force: true });
  }
});
