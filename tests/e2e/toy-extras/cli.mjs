#!/usr/bin/env node
// Stands for a JavaScript command that starts a native binary of its package.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nativeBinary } from "./native-binary.mjs";

// `toyjs package-files` lists what was installed as this package, so that a
// test can see what the packer left out.
if (process.argv[2] === "package-files") {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const files = fs
    .readdirSync(root, { recursive: true })
    .map((file) => String(file).split(path.sep).join("/"))
    .filter((file) => !file.split("/").includes("node_modules"))
    .sort();
  console.log(`package files: ${files.join(" ")}`);
  process.exit(0);
}

const exe = nativeBinary("rustify-e2e-toy-extras", "toy", import.meta.url);
if (!exe) {
  console.error("toyjs: no native binary found for this machine");
  process.exit(1);
}
const result = spawnSync(exe, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
