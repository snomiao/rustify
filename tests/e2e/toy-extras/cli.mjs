#!/usr/bin/env node
// Stands for a JavaScript command that starts a native binary of its package.
import { spawnSync } from "node:child_process";
import { nativeBinary } from "./native-binary.mjs";

const exe = nativeBinary("rustify-e2e-toy-extras", "toy", import.meta.url);
if (!exe) {
  console.error("toyjs: no native binary found for this machine");
  process.exit(1);
}
const result = spawnSync(exe, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
