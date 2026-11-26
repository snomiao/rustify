// rustify native-binary lookup v1 — copy into a package whose commands are
// still JavaScript but whose native binaries ship in the platform packages
// (`"rustify": { "bins": {}, "extra": ["mytool"] }`).
//
//   import { nativeBinary } from "./native-binary.mjs";
//   const exe = nativeBinary("my-package", "mytool", import.meta.url);
//   if (exe) spawn(exe, args, { stdio: "inherit" });
//
// Returns the absolute path of the binary the package manager installed for
// this machine, or null when there is none (optional dependencies skipped, or
// no build for this platform) — fall back to whatever the package did before.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export function nativeBinary(packageName, binary, from) {
  const os = process.platform === "android" ? "linux" : process.platform;
  const key = `${os}-${process.arch}`;
  try {
    const manifest = createRequire(from).resolve(`${packageName}-${key}/package.json`);
    const file = path.join(path.dirname(manifest), "bin", binary + (process.platform === "win32" ? ".exe" : ""));
    return fs.existsSync(file) ? file : null;
  } catch {
    return null;
  }
}
