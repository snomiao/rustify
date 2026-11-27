// Unit tests for what templates/npm/pack.mjs puts into the main package of a
// "hybrid" project, which ships the project's own files: with --manifest the
// crate's directory stays out of a package that has no `files` list.
//
// Each test packs a small project in a temp directory. Listing a package's
// files asks npm (or bun), so one of the two has to be installed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACK = fileURLToPath(new URL("../../templates/npm/pack.mjs", import.meta.url));
const key = `${process.platform}-${process.arch}`;
const exe = process.platform === "win32" ? ".exe" : "";

// A project with its JavaScript in src/ and a crate in rs/, packed with the
// given package.json fields and arguments. Returns the files of the main
// package, relative and with forward slashes, and what the packer printed.
function packed({ fields = {}, args = [], extraFiles = {} } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-unit-pack-"));
  try {
    const project = path.join(work, "project");
    const files = {
      "package.json": JSON.stringify({
        name: "rustify-unit-pack",
        version: "1.0.0",
        license: "MIT",
        bin: { legacy: "src/cli.js" },
        rustify: { mode: "hybrid", bins: { toy: "toy" } },
        ...fields,
      }),
      "src/cli.js": "#!/usr/bin/env node\n",
      "rs/Cargo.toml": '[package]\nname = "toy"\nversion = "1.0.0"\n',
      "rs/src/main.rs": "fn main() {}\n",
      "rs/parity.json": '{ "cases": [] }\n',
      // A neighbour whose name only begins like the crate's directory.
      "rs-notes/readme.txt": "kept\n",
      [`artifacts/${key}/toy${exe}`]: "binary",
      ...extraFiles,
    };
    for (const [file, content] of Object.entries(files)) {
      // The binaries are kept beside the project, as a download step would.
      const target = path.join(file.startsWith("artifacts/") ? work : project, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const out = path.join(work, "npm-dist");
    const log = execFileSync(
      process.execPath,
      [PACK, "pack", "--artifacts", path.join(work, "artifacts"), "--out", out, "--allow-missing", ...args],
      { cwd: project, encoding: "utf8" },
    );
    const main = path.join(out, "main");
    const list = fs
      .readdirSync(main, { recursive: true })
      .map((file) => String(file).split(path.sep).join("/"))
      .filter((file) => fs.statSync(path.join(main, file)).isFile())
      .sort();
    return { list, log };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const CRATE = ["rs/Cargo.toml", "rs/parity.json", "rs/src/main.rs"];
const REST = ["package.json", "rs-notes/readme.txt", "rustify/package.json", "rustify/toy", "src/cli.js"];

test("without --manifest the crate is shipped, as before", () => {
  const { list, log } = packed();
  assert.deepEqual(list, [...CRATE, ...REST].sort());
  assert.doesNotMatch(log, /left out/);
});

test("--manifest leaves the crate's directory out of a package without a files list", () => {
  const { list, log } = packed({ args: ["--manifest", "rs/Cargo.toml"] });
  assert.deepEqual(list, REST);
  assert.match(log, /left out: rs\/ \(the crate, 3 files\)/);
});

test("a package with a files list is not affected", () => {
  const { list, log } = packed({ fields: { files: ["src", "rs"] }, args: ["--manifest", "rs/Cargo.toml"] });
  assert.deepEqual(list, [...CRATE, "package.json", "rustify/package.json", "rustify/toy", "src/cli.js"].sort());
  assert.doesNotMatch(log, /left out/);
});

test("a crate in the package's own directory leaves nothing out", () => {
  const { list, log } = packed({
    args: ["--manifest", "Cargo.toml"],
    extraFiles: { "Cargo.toml": '[package]\nname = "toy"\nversion = "1.0.0"\n' },
  });
  assert.deepEqual(list, ["Cargo.toml", ...CRATE, ...REST].sort());
  assert.doesNotMatch(log, /left out/);
});

test("a crate outside the package's directory leaves nothing out", () => {
  const { list, log } = packed({ args: ["--manifest", path.join("..", "elsewhere", "Cargo.toml")] });
  assert.deepEqual(list, [...CRATE, ...REST].sort());
  assert.doesNotMatch(log, /left out/);
});
