#!/usr/bin/env node
// rustify npm packer v3 — zero dependencies, runs on node or bun.
//
// Turns prebuilt native binaries into npm packages that install with
// `bun i -g <name>` or `npm i -g <name>` on any supported machine:
//
//   <name>@<version>              the package users install: launchers only
//   <name>@<version>-linux-x64    one per platform: the binaries, with os/cpu set
//   ...
//
// Every platform build is published under the SAME package name with a
// suffixed version, and the main package depends on it through an npm alias
// ("<name>-linux-x64": "npm:<name>@<version>-linux-x64"). One package name
// means one npm trusted-publisher setup and no per-platform names to create.
//
// Usage:
//   pack.mjs pack    --artifacts <dir> [--package <package.json>] [--version <v>]
//                    [--tag <dist-tag>] [--out <dir>] [--allow-missing]
//   pack.mjs publish [--out <dir>] [--registry <url>] [--provenance] [--dry-run]
//
// <artifacts> holds one directory per platform key (linux-x64, darwin-arm64,
// win32-x64, ...) containing the built binaries.
//
// Configuration lives in the project's package.json:
//   "rustify": {
//     "bins":    { "<npm command>": "<cargo bin name>", ... },  // may be empty:
//                // then the commands stay JavaScript, the binaries in "extra"
//                // ride along in the platform packages, and the JavaScript
//                // finds them with templates/npm/native-binary.mjs
//     "mode":    "native" | "hybrid",   // hybrid keeps the package's JS files
//     "runtime": "bun" | "node",        // shebang of the launcher
//     "extra":   ["<cargo bin shipped beside the others, without a command>"],
//     "platforms": ["linux-x64", ...]   // only if the project cannot build all;
//                                       // default: every platform in platforms.json
//   }

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// platforms.json is the one list of supported platforms. Projects and users
// never list platforms themselves.
export const PLATFORMS = JSON.parse(fs.readFileSync(path.join(HERE, "platforms.json"), "utf8"));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) out._.push(a);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

function fail(message) {
  console.error(`pack.mjs: ${message}`);
  process.exit(1);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function copyIfExists(from, to) {
  if (fs.existsSync(from)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

// Where the main package keeps its launchers. Its own directory, so that it
// cannot collide with a `bin/` the project already ships.
const LAUNCHER_DIR = "rustify";

const SHARED_FIELDS = ["description", "license", "author", "homepage", "repository", "bugs", "keywords"];

// The files the package manager would put in the tarball of the package in
// `dir`, by asking it. npm is what CI has; bun is enough on a bun-only machine.
function packedFiles(dir) {
  const shell = process.platform === "win32";
  const options = { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell };
  try {
    const listed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], options));
    return listed[0].files.map((f) => f.path);
  } catch (npmError) {
    try {
      const text = execFileSync("bun", ["pm", "pack", "--dry-run", "--ignore-scripts"], options);
      const files = [...text.matchAll(/^packed \S+ (.+)$/gm)].map((m) => m[1].trim());
      if (files.length) return files;
    } catch {}
    fail(`cannot list the files of ${dir}: ${npmError.message.split("\n")[0]}`);
  }
}

function pack(opts) {
  const pkgPath = path.resolve(opts.package || "package.json");
  const projectDir = path.dirname(pkgPath);
  const project = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const cfg = project.rustify;
  if (!cfg) fail(`${pkgPath} has no "rustify" block.`);
  cfg.bins = cfg.bins || {};
  cfg.extra = cfg.extra || [];
  if (!Object.keys(cfg.bins).length && !cfg.extra.length) {
    fail(`${pkgPath}: "rustify" names no binary. Map npm commands to cargo bins in "bins", or list binaries to ship without a command in "extra".`);
  }
  if (project.private) fail(`${pkgPath} is marked "private", so npm would refuse to publish it.`);
  if (!opts.artifacts) fail("--artifacts <dir> is required");
  const artifacts = path.resolve(opts.artifacts);
  const version = opts.version || project.version;
  if (!/^\d+\.\d+\.\d+/.test(version)) fail(`"${version}" is not a publishable version`);
  const tag = opts.tag || "latest";
  const out = path.resolve(opts.out || "npm-dist");
  const mode = cfg.mode || "native";
  const runtime = cfg.runtime || "bun";
  const cargoBins = [...new Set([...Object.values(cfg.bins), ...(cfg.extra || [])])];

  fs.rmSync(out, { recursive: true, force: true });
  const publish = [];
  const optionalDependencies = {};
  const missing = [];

  const wanted = cfg.platforms || Object.keys(PLATFORMS);
  const unknown = wanted.filter((key) => !PLATFORMS[key]);
  if (unknown.length) fail(`rustify.platforms names unknown platforms: ${unknown.join(", ")}. Known: ${Object.keys(PLATFORMS).join(", ")}`);
  for (const key of wanted) {
    const platform = PLATFORMS[key];
    const src = path.join(artifacts, key);
    const ext = key.startsWith("win32") ? ".exe" : "";
    // What a command starts must be there. Binaries shipped without a command
    // may exist on some platforms only, unless they are all the package ships.
    const needed = Object.keys(cfg.bins).length ? Object.values(cfg.bins) : cfg.extra;
    const required = needed.map((b) => path.join(src, b + ext));
    if (!required.every((f) => fs.existsSync(f))) {
      missing.push(key);
      continue;
    }
    const dir = path.join(out, key);
    for (const bin of cargoBins) {
      const from = path.join(src, bin + ext);
      // Extras may exist on some platforms only (a Windows-only helper).
      if (!fs.existsSync(from)) continue;
      const to = path.join(dir, "bin", bin + ext);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      fs.chmodSync(to, 0o755);
    }
    const manifest = { name: project.name, version: `${version}-${key}` };
    for (const f of SHARED_FIELDS) if (project[f] !== undefined) manifest[f] = project[f];
    manifest.description = `${project.name} native binaries for ${key}`;
    manifest.os = platform.os;
    manifest.cpu = platform.cpu;
    manifest.files = ["bin"];
    writeJson(path.join(dir, "package.json"), manifest);
    copyIfExists(path.join(projectDir, "LICENSE"), path.join(dir, "LICENSE"));
    optionalDependencies[`${project.name}-${key}`] = `npm:${project.name}@${version}-${key}`;
    publish.push({ dir: key, tag: tag === "latest" ? key : `${tag}-${key}` });
  }

  if (missing.length && !opts["allow-missing"]) {
    fail(
      `no binaries for ${missing.join(", ")} under ${artifacts}.\n` +
        `Every platform the project supports must be built before a release. Pass --allow-missing only for local tests.`,
    );
  }
  if (!publish.length) fail(`no platform binaries found under ${artifacts}`);

  const main = path.join(out, "main");
  let manifest;
  if (mode === "hybrid") {
    // Ship what the project ships today and swap the listed commands for
    // native launchers. The project must already be built (its dist exists).
    for (const file of packedFiles(projectDir)) {
      const to = path.join(main, file);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(projectDir, file), to);
    }
    manifest = { ...project };
    delete manifest.devDependencies;
    delete manifest.publishConfig;
    const scripts = { ...(project.scripts || {}) };
    for (const s of ["prepare", "prepack", "postpack", "prepublishOnly", "prepublish", "publish", "postpublish"]) {
      delete scripts[s];
    }
    manifest.scripts = scripts;
    const ownBin = (project.publishConfig || {}).bin || project.bin || {};
    manifest.bin = typeof ownBin === "string" ? { [project.name]: ownBin } : { ...ownBin };
    if (Object.keys(cfg.bins).length && Array.isArray(manifest.files) && !manifest.files.includes(LAUNCHER_DIR)) {
      manifest.files = [...manifest.files, LAUNCHER_DIR];
    }
    manifest.optionalDependencies = { ...(project.optionalDependencies || {}), ...optionalDependencies };
  } else if (mode === "native") {
    if (!Object.keys(cfg.bins).length) fail(`"native" mode needs commands in rustify.bins; a package that only ships binaries beside its JavaScript is "hybrid".`);
    manifest = { name: project.name };
    for (const f of SHARED_FIELDS) if (project[f] !== undefined) manifest[f] = project[f];
    manifest.bin = {};
    manifest.files = [LAUNCHER_DIR];
    manifest.optionalDependencies = optionalDependencies;
    for (const f of ["README.md", "LICENSE"]) copyIfExists(path.join(projectDir, f), path.join(main, f));
  } else {
    fail(`unknown rustify.mode "${mode}" (use "native" or "hybrid")`);
  }
  manifest.version = version;
  manifest.rustify = { bins: cfg.bins, extra: cfg.extra, launcher: 3 };
  if (cfg.rootEnv) manifest.rustify.rootEnv = cfg.rootEnv;

  const launcher = fs
    .readFileSync(path.join(HERE, "launcher.cjs"), "utf8")
    .replace("__RUNTIME__", runtime);
  for (const npmBin of Object.keys(cfg.bins)) {
    if (!/^[A-Za-z0-9._-]+$/.test(npmBin)) fail(`"${npmBin}" is not a usable command name`);
    manifest.bin[npmBin] = `${LAUNCHER_DIR}/${npmBin}`;
    const file = path.join(main, LAUNCHER_DIR, npmBin);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, launcher, { mode: 0o755 });
  }
  // Launchers have no extension. This keeps them CommonJS even when the
  // package itself is "type": "module". The binary also recognises its
  // package by this file.
  if (Object.keys(cfg.bins).length) {
    writeJson(path.join(main, LAUNCHER_DIR, "package.json"), { type: "commonjs" });
  }
  writeJson(path.join(main, "package.json"), manifest);
  publish.push({ dir: "main", tag });

  writeJson(path.join(out, "publish.json"), {
    name: project.name,
    version,
    publish,
    unsupported: Object.keys(PLATFORMS).filter((k) => !wanted.includes(k)),
    commands: Object.keys(cfg.bins),
    extra: cfg.extra,
    launcherDir: LAUNCHER_DIR,
  });
  console.log(`packed ${project.name}@${version} (${mode}) → ${out}`);
  for (const p of publish) console.log(`  ${p.dir.padEnd(13)} dist-tag ${p.tag}`);
  if (missing.length) console.log(`  not included: ${missing.join(", ")}`);
}

function publish(opts) {
  const out = path.resolve(opts.out || "npm-dist");
  const plan = JSON.parse(fs.readFileSync(path.join(out, "publish.json"), "utf8"));
  const shell = process.platform === "win32";
  const has = (tool) => {
    try {
      execFileSync(tool, ["--version"], { stdio: "ignore", shell });
      return true;
    } catch {
      return false;
    }
  };
  // npm is what CI uses. A machine that only has bun can still publish, which
  // is enough for local rehearsals; provenance needs npm.
  const tool = has("npm") ? "npm" : has("bun") ? "bun" : null;
  if (!tool) fail("neither npm nor bun is installed");
  if (tool === "bun" && opts.provenance) fail("--provenance needs npm");
  let failed = false;
  // Platform builds go first and the main package last, so the version users
  // install never points at binaries that are not on the registry yet.
  for (const step of plan.publish) {
    if (failed && step.dir === "main") {
      console.error(`skipped ${plan.name}@${plan.version}: a platform build failed to publish`);
      break;
    }
    const dir = path.join(out, step.dir);
    const args = ["publish", "--tag", step.tag, "--access", "public", "--ignore-scripts"];
    if (tool === "npm") args.splice(1, 0, dir);
    if (opts.registry) args.push("--registry", opts.registry);
    if (opts.provenance) args.push("--provenance");
    if (opts["dry-run"]) args.push("--dry-run");
    let output = "";
    let ok = true;
    try {
      output = execFileSync(tool, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell });
    } catch (err) {
      ok = false;
      output = `${err.stdout || ""}${err.stderr || ""}`;
    }
    const label = `${plan.name}@${step.dir === "main" ? plan.version : `${plan.version}-${step.dir}`}`;
    if (ok) {
      console.log(`published ${label} (${step.tag})`);
    } else if (/cannot publish over|previously published|EPUBLISHCONFLICT|already exists/i.test(output)) {
      // Re-running a release that half finished must be safe.
      console.log(`already published ${label}`);
    } else {
      failed = true;
      console.error(`FAILED ${label}\n${output}`);
    }
  }
  if (failed) process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));
const command = opts._[0];
if (command === "pack") pack(opts);
else if (command === "publish") publish(opts);
else fail("usage: pack.mjs pack|publish [options] — see the header of this file");
