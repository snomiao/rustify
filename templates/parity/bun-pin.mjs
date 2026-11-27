#!/usr/bin/env node
// rustify bun pin v1 — zero dependencies, runs on node.
//
// Says which file of the project in the current directory pins the version
// of bun, for the parity job of rust-npm-build.yml. That job installs bun
// with oven-sh/setup-bun, which by itself reads only package.json
// (`packageManager`, then `engines.bun`) and otherwise takes the latest bun.
// A project that pins bun in .bun-version or .tool-versions instead is to be
// proven against the bun it pins, so the file is passed to setup-bun's
// `bun-version-file` input:
//
//   .bun-version     when it names a version
//   .tool-versions   otherwise, when it has a `bun <version>` line
//   nothing          otherwise: setup-bun decides as it always has
//
//   node bun-pin.mjs >> "$GITHUB_OUTPUT"
//       prints `file=<name>` and `version=<the version the file names>`, both
//       empty when nothing pins bun, and says on stderr what it found
//   node bun-pin.mjs --check
//       after setup-bun: prints the version of the bun in PATH, and fails when
//       the file pins one exact version and that is not it

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

// The first line that is not blank.
const bunVersion = read(".bun-version")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find(Boolean);
// `bun 1.4.2`, possibly followed by fallback versions or a comment.
const toolVersions = read(".tool-versions").match(/^[ \t]*bun[ \t]+([^\s#]+)/m)?.[1];
const [file, version] = bunVersion ? [".bun-version", bunVersion] : toolVersions ? [".tool-versions", toolVersions] : ["", ""];

if (process.argv.includes("--check")) {
  const asked = spawnSync("bun", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  const installed = asked.status === 0 ? String(asked.stdout).trim() : "";
  if (!installed) {
    console.log("::error::bun does not start");
    process.exit(1);
  }
  console.log(`bun ${installed}${file ? `, pinned in ${file} as ${version}` : ", not pinned"}`);
  // A range ("1.4.x") or a channel ("latest") is setup-bun's to resolve.
  const exact = version.replace(/^v/, "");
  if (/^\d+\.\d+\.\d+$/.test(exact) && installed !== exact) {
    console.log(`::error::${file} pins bun ${version}, but bun ${installed} is installed`);
    process.exit(1);
  }
} else {
  console.log(`file=${file}`);
  console.log(`version=${version}`);
  console.error(
    file
      ? `bun ${version} is pinned in ${file} of ${process.cwd()}`
      : `${process.cwd()} has no .bun-version, and no .tool-versions that names bun: setup-bun reads package.json, or takes the latest bun`,
  );
}
