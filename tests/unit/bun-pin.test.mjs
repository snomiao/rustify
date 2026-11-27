// Tests of templates/parity/bun-pin.mjs: which file the parity job hands to
// setup-bun, for projects that pin bun and for those that do not.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../templates/parity/bun-pin.mjs", import.meta.url));

// Runs the script in a directory holding `files`; returns its outputs.
function pin(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-unit-bun-pin-"));
  try {
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return { ...Object.fromEntries(result.stdout.trim().split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2))), log: result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Runs `--check` in a directory holding `files`, with a stand-in bun of the
// given version first in PATH. Returns the exit code and what it printed.
function check(files, installed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-unit-bun-pin-"));
  try {
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "bun"), `#!/bin/sh\necho ${installed}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "bun.cmd"), `@echo ${installed}\r\n`);
    const name = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") || "PATH";
    const env = { ...process.env, [name]: `${bin}${path.delimiter}${process.env[name] || ""}` };
    const result = spawnSync(process.execPath, [SCRIPT, "--check"], { cwd: dir, encoding: "utf8", env });
    return { code: result.status, out: result.stdout };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("--check prints the bun in PATH and holds an exact pin to it", () => {
  assert.deepEqual(check({}, "1.4.5"), { code: 0, out: "bun 1.4.5, not pinned\n" });
  assert.deepEqual(check({ ".bun-version": "1.4.2\n" }, "1.4.2"), { code: 0, out: "bun 1.4.2, pinned in .bun-version as 1.4.2\n" });
  assert.equal(check({ ".bun-version": "v1.4.2\n" }, "1.4.2").code, 0);
  const wrong = check({ ".tool-versions": "bun 1.4.0\n" }, "1.4.2");
  assert.equal(wrong.code, 1);
  assert.match(wrong.out, /::error::\.tool-versions pins bun 1\.4\.0, but bun 1\.4\.2 is installed/);
  // A range or a channel is setup-bun's to resolve.
  assert.equal(check({ ".bun-version": "1.4.x\n" }, "1.4.2").code, 0);
  assert.equal(check({ ".bun-version": "latest\n" }, "1.4.2").code, 0);
});

test("a project that pins nothing leaves setup-bun as it was", () => {
  const { file, version, log } = pin({ "package.json": '{ "packageManager": "bun@1.4.2" }' });
  assert.deepEqual([file, version], ["", ""]);
  assert.match(log, /setup-bun reads package\.json/);
  assert.deepEqual(pin({ ".tool-versions": "nodejs 24.1.0\n" }).file, "", "a .tool-versions without bun is not a pin");
  assert.deepEqual(pin({ ".bun-version": "\n  \n" }).file, "", "nor is an empty .bun-version");
});

test(".bun-version is the pin", () => {
  const { file, version, log } = pin({ ".bun-version": "1.4.2\n" });
  assert.deepEqual([file, version], [".bun-version", "1.4.2"]);
  assert.match(log, /^bun 1\.4\.2 is pinned in \.bun-version of /);
  const spaced = pin({ ".bun-version": "\r\n 1.4.2 \r\n" });
  assert.deepEqual([spaced.file, spaced.version], [".bun-version", "1.4.2"]);
});

test(".tool-versions is the pin when it names bun and there is no .bun-version", () => {
  const { file, version } = pin({ ".tool-versions": "# runtimes\nnodejs 24.1.0\nbun 1.4.2 1.3.0 # fallback\n" });
  assert.deepEqual([file, version], [".tool-versions", "1.4.2"]);
  assert.equal(pin({ ".tool-versions": "bunyan 1.0.0\n" }).file, "", "another tool whose name begins with bun is not bun");
  const both = pin({ ".bun-version": "1.4.0\n", ".tool-versions": "bun 1.4.2\n" });
  assert.deepEqual([both.file, both.version], [".bun-version", "1.4.0"], ".bun-version comes first");
});
