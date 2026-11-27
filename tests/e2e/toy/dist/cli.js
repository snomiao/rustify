#!/usr/bin/env bun
// Stands for the JavaScript a hybrid package still ships. It prints its
// arguments; the word `homedir` is replaced by the home directory it sees.
import os from "node:os";
console.log("js cli:", process.argv.slice(2).map((arg) => (arg === "homedir" ? os.homedir() : arg)).join(" "));
