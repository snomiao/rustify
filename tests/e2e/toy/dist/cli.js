#!/usr/bin/env bun
// Stands for the JavaScript a hybrid package still ships. It prints its
// arguments; the word `homedir` is replaced by the home directory it sees, and
// `trace` and `root` by the values of RUSTIFY_HANDBACK_TRACE and
// RUSTIFY_PACKAGE_ROOT, or `unset`.
import os from "node:os";
const answers = {
  homedir: () => os.homedir(),
  trace: () => process.env.RUSTIFY_HANDBACK_TRACE ?? "unset",
  root: () => process.env.RUSTIFY_PACKAGE_ROOT ?? "unset",
};
console.log("js cli:", process.argv.slice(2).map((arg) => (Object.hasOwn(answers, arg) ? answers[arg]() : arg)).join(" "));
