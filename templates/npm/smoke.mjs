#!/usr/bin/env node
// rustify install smoke test v1 — zero dependencies, runs on node or bun.
//
// Installs a packed release the way a user would (`bun i -g` or `npm i -g`),
// runs a command from it, and fails unless the native binary answered.
// Run it on every OS in CI: it is the proof that the release installs and
// starts there.
//
//   Before publishing — serves <dist> from a throwaway local registry:
//     smoke.mjs --dist npm-dist --run "<command> --version"
//   After publishing — installs from the real registry:
//     smoke.mjs --dist npm-dist --run "<command> --version" --registry https://registry.npmjs.org
//
// Options:
//   --installer bun|npm   default: both, when available
//   --expect <text>       text the output must contain (default: the version)
//   --also "<command> [args] => <text>"
//                         one more command of the package that must exit 0
//                         and print <text>; repeatable. Use it for commands
//                         that are still JavaScript or are handed back to it.
//
// Installs go to a temp directory. Your real global installs are not touched.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";

function parseArgs(argv) {
  const out = { also: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (key === "also") out.also.push(String(value));
    else out[key] = value;
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.run) {
  console.error(
    'usage: smoke.mjs --dist <dir> --run "<command> [args]" [--expect <text>] [--also "<command> [args] => <text>"]... ' +
      "[--registry <url>] [--installer bun|npm]",
  );
  process.exit(2);
}
const dist = path.resolve(opts.dist || "npm-dist");
const plan = JSON.parse(fs.readFileSync(path.join(dist, "publish.json"), "utf8"));
const hostKey = `${process.platform === "android" ? "linux" : process.platform}-${process.arch}`;
if ((plan.unsupported || []).includes(hostKey)) {
  // The project said so itself (rustify.platforms); nothing to install here.
  console.log(`== ${plan.name}@${plan.version} on ${hostKey}\n  skip  the project does not ship a build for ${hostKey}`);
  process.exit(0);
}
const [command, ...args] = String(opts.run).split(/\s+/).filter(Boolean);
const expect = opts.expect || plan.version;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-smoke-"));
let failures = 0;
const timings = [];

const ok = (message) => console.log(`  ok    ${message}`);
const bad = (message) => {
  failures++;
  console.log(`  FAIL  ${message}`);
};
const has = (tool) => spawnSync(tool, ["--version"], { stdio: "ignore", shell: isWindows }).status === 0;
const sh = (tool, toolArgs, env) =>
  spawnSync(tool, toolArgs, { encoding: "utf8", env: { ...process.env, ...env }, shell: isWindows });

function isScript(file) {
  const fd = fs.openSync(fs.realpathSync(file), "r");
  const head = Buffer.alloc(2);
  fs.readSync(fd, head, 0, 2, 0);
  fs.closeSync(fd);
  return head.toString() === "#!";
}

// Where `installer` puts a command of the package.
function binFor(installer, home, name) {
  if (installer === "bun") return path.join(home, "bin", name + (isWindows ? ".exe" : ""));
  return isWindows ? path.join(home, `${name}.cmd`) : path.join(home, "bin", name);
}

function runOnce(bin, runArgs = args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(isWindows ? `"${bin}"` : bin, runArgs, { encoding: "utf8", shell: isWindows });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, code: result.status, text: `${result.stdout || ""}${result.stderr || ""}`, error: result.error };
}

function check(installer, registry) {
  const spec = `${plan.name}@${plan.version}`;
  const home = path.join(work, installer);
  let install;
  let bin;
  let packageDir;
  if (installer === "bun") {
    const env = { BUN_INSTALL: home, BUN_INSTALL_CACHE_DIR: path.join(work, "bun-cache") };
    install = sh("bun", ["i", "-g", spec, "--registry", registry], env);
    bin = binFor(installer, home, command);
    packageDir = path.join(home, "install", "global", "node_modules", plan.name);
  } else {
    install = sh("npm", ["i", "-g", "--prefix", home, spec, "--registry", registry]);
    bin = binFor(installer, home, command);
    packageDir = path.join(home, isWindows ? "" : "lib", "node_modules", plan.name);
  }
  if (install.status !== 0) {
    return bad(`${installer}: install of ${spec} failed\n${install.stdout || ""}${install.stderr || ""}`);
  }
  if (/blocked \d+ postinstall/i.test(`${install.stdout}${install.stderr}`)) {
    bad(`${installer}: the release relies on an install script, which ${installer} did not run`);
  }
  if (!fs.existsSync(bin)) return bad(`${installer}: ${bin} was not created`);
  ok(`${installer}: installed ${spec}`);

  const first = runOnce(bin);
  if (first.code !== 0 || !first.text.includes(expect)) {
    return bad(
      `${installer}: "${opts.run}" exited ${first.code}${first.error ? ` (${first.error.message})` : ""} ` +
        `and should print "${expect}". Output:\n${first.text}`,
    );
  }
  ok(`${installer}: first run works — ${first.text.trim().split("\n")[0].slice(0, 160)}`);

  const second = runOnce(bin);
  if (second.code !== 0 || !second.text.includes(expect)) {
    return bad(`${installer}: second run exited ${second.code}. Output:\n${second.text}`);
  }
  const native = path.join(packageDir, "bin", command + (isWindows ? ".exe" : ""));
  if (isWindows) {
    if (!fs.existsSync(native)) {
      return bad(`${installer}: ${native} is missing, so the binary runs from the platform package`);
    }
    ok(`${installer}: native copy is in place beside the launcher`);
    // The package manager's shim must now start that copy, not the launcher.
    if (installer === "bun") {
      const bunx = fs.readFileSync(path.join(home, "bin", `${command}.bunx`));
      const flags = bunx.readUInt16LE(bunx.length - 2);
      const target = bunx.subarray(0, bunx.length - 6).toString("utf16le");
      if (!(flags & 0b100) && target.toLowerCase().endsWith(`${command}.exe`.toLowerCase())) {
        ok(`${installer}: bun's shim starts the binary directly`);
      } else {
        bad(`${installer}: bun's shim still starts the launcher, so every start pays for a JS runtime`);
      }
    } else {
      const cmd = fs.readFileSync(bin, "utf8");
      if (cmd.includes(`${command}.exe"`)) ok(`${installer}: npm's shim starts the binary directly`);
      else bad(`${installer}: npm's shim still starts the launcher, so every start pays for a JS runtime`);
    }
  } else if (isScript(bin)) {
    bad(`${installer}: the command is still a script after the first run, so every start pays for a JS runtime`);
  } else {
    ok(`${installer}: the command is now the native binary itself`);
  }

  // Installing the same version again must leave a working command.
  const again = installer === "bun"
    ? sh("bun", ["i", "-g", spec, "--registry", registry], { BUN_INSTALL: home, BUN_INSTALL_CACHE_DIR: path.join(work, "bun-cache") })
    : sh("npm", ["i", "-g", "--prefix", home, spec, "--registry", registry]);
  const afterReinstall = [runOnce(bin), runOnce(bin)];
  if (again.status !== 0 || afterReinstall.some((r) => r.code !== 0 || !r.text.includes(expect))) {
    bad(`${installer}: the command broke after installing the same version again\n${afterReinstall.map((r) => r.text).join("\n")}`);
  } else {
    ok(`${installer}: still works after installing the same version again`);
  }

  // Start time: the installed command against the binary run directly.
  const best = (file) => Math.min(...Array.from({ length: 7 }, () => runOnce(file).ms));
  const installed = best(bin);
  const direct = best(native);
  ok(
    `${installer}: start time ${installed.toFixed(1)} ms installed, ${direct.toFixed(1)} ms for the binary run directly ` +
      `(first run through the launcher: ${first.ms.toFixed(0)} ms)`,
  );
  timings.push({ installer, first: first.ms, installed, direct });

  for (const extra of opts.also) {
    const [line, wanted = ""] = extra.split("=>").map((part) => part.trim());
    const [name, ...extraArgs] = line.split(/\s+/).filter(Boolean);
    const result = runOnce(binFor(installer, home, name), extraArgs);
    if (result.code === 0 && result.text.includes(wanted)) {
      ok(`${installer}: \`${line}\` works — ${result.text.trim().split("\n")[0].slice(0, 120)}`);
    } else {
      bad(`${installer}: \`${line}\` exited ${result.code} and should print "${wanted}". Output:\n${result.text}`);
    }
  }
}

// The registry runs as its own process: the checks below block this one.
function startLocalRegistry() {
  const child = spawn(process.execPath, [path.join(HERE, "registry.mjs"), path.join(work, "registry")], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`local registry exited with ${code}`)));
    child.stdout.once("data", (line) => resolve({ url: String(line).trim(), close: () => child.kill() }));
  });
}

let registry = typeof opts.registry === "string" ? opts.registry : null;
let local = null;
try {
  console.log(`== ${plan.name}@${plan.version} on ${process.platform}-${process.arch}`);
  if (!registry) {
    local = await startLocalRegistry();
    registry = local.url;
    const npmrc = path.join(work, "npmrc");
    fs.writeFileSync(npmrc, `//${registry.replace(/^https?:\/\//, "")}/:_authToken=smoke\n`);
    process.env.NPM_CONFIG_USERCONFIG = npmrc; // npm
    process.env.NPM_CONFIG_TOKEN = "smoke"; // bun publish
    execFileSync(process.execPath, [path.join(HERE, "pack.mjs"), "publish", "--out", dist, "--registry", registry], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    ok(`published to a local registry (${registry})`);
  }
  const wanted = typeof opts.installer === "string" ? [opts.installer] : ["bun", "npm"];
  const usable = wanted.filter(has);
  if (!usable.length) bad(`none of ${wanted.join(", ")} is installed`);
  for (const installer of usable) check(installer, registry);
} finally {
  if (local) local.close();
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
}
if (process.env.GITHUB_STEP_SUMMARY && timings.length) {
  const rows = timings.map(
    (t) =>
      `| ${process.platform}-${process.arch} | ${t.installer} | ${t.first.toFixed(0)} ms | ${t.installed.toFixed(1)} ms | ${t.direct.toFixed(1)} ms |`,
  );
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `| Platform | Installed with | First run | Later runs | Binary run directly |\n|---|---|---|---|---|\n${rows.join("\n")}\n`,
  );
}
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
