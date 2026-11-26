#!/usr/bin/env node
// Upgrade rehearsal, for real machines: what happens when a package is
// upgraded while one of its commands is still running?
//
// Builds the toy binary twice (two versions) for this machine, publishes both
// to a throwaway local registry, installs the first with bun and with npm
// into temp directories, starts a long-running command, upgrades to the
// second, and reports what the package manager did and what runs afterwards.
//
// It reports; it only fails when the outcome would leave a user with a broken
// command. Nothing touches the real registry or your real global installs.
//
//   node tests/e2e/upgrade.mjs            needs cargo, and bun and/or npm

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const NPM = path.join(REPO, "templates", "npm");
const isWindows = process.platform === "win32";
const exe = isWindows ? ".exe" : "";
const key = `${process.platform === "android" ? "linux" : process.platform}-${process.arch}`;
// Two packages, for the two places a running binary can sit:
//   command        the command is the native binary, hard-linked into the
//                  main package (and the same file in the platform package)
//   binaries-only  the command is JavaScript and starts the binary that
//                  lives in the platform package only
const KINDS = [
  { kind: "command", name: "rustify-e2e-toy", command: "toy" },
  { kind: "binaries-only", name: "rustify-e2e-toy-extras", command: "toyjs" },
];
const [V1, V2] = ["1.0.0", "2.0.0"];
const work = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-upgrade-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const has = (tool) => spawnSync(tool, ["--version"], { stdio: "ignore", shell: isWindows }).status === 0;
let broken = 0;

function line(label, value) {
  console.log(`  ${label.padEnd(44)} ${value}`);
}

function build(version) {
  execFileSync(
    "cargo",
    ["build", "--release", "--quiet", "--manifest-path", path.join(HERE, "toy", "Cargo.toml"), "--target-dir", path.join(work, "target")],
    { env: { ...process.env, TOY_VERSION: version }, stdio: "inherit" },
  );
  const dir = path.join(work, `native-${version}`, key);
  fs.mkdirSync(dir, { recursive: true });
  for (const bin of ["toy", "toy-helper"]) {
    fs.copyFileSync(path.join(work, "target", "release", `${bin}${exe}`), path.join(dir, `${bin}${exe}`));
  }
  return KINDS.map(({ kind }) => {
    const out = path.join(work, `dist-${kind}-${version}`);
    execFileSync(
      process.execPath,
      [path.join(NPM, "pack.mjs"), "pack", "--package", path.join(work, `project-${kind}`, "package.json"),
        "--artifacts", path.join(work, `native-${version}`), "--version", version, "--out", out, "--allow-missing"],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    return out;
  });
}

function run(bin, args) {
  const r = spawnSync(isWindows ? `"${bin}"` : bin, args, { encoding: "utf8", shell: isWindows });
  return { code: r.status, text: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}
const versionOf = (text) => (text.match(/version=(\S+)/) || [])[1] || `? (${text.slice(0, 80)})`;

async function scenario(installer, registry, { kind, name: NAME, command }) {
  console.log(`\n== ${installer} on ${key}, ${kind} package`);
  const home = path.join(work, `${installer}-${kind}`);
  const env = { ...process.env, BUN_INSTALL: home, BUN_INSTALL_CACHE_DIR: path.join(work, "bun-cache") };
  const install = (version) =>
    installer === "bun"
      ? spawnSync("bun", ["i", "-g", `${NAME}@${version}`, "--registry", registry], { encoding: "utf8", env, shell: isWindows })
      : spawnSync("npm", ["i", "-g", "--prefix", home, `${NAME}@${version}`, "--registry", registry], { encoding: "utf8", env, shell: isWindows });
  const bin =
    installer === "bun"
      ? path.join(home, "bin", `${command}${exe}`)
      : isWindows ? path.join(home, `${command}.cmd`) : path.join(home, "bin", command);

  const first = install(V1);
  if (first.status !== 0) {
    broken++;
    return line("install of the first version", `FAILED\n${first.stdout}${first.stderr}`);
  }
  run(bin, ["warm-up"]);
  line("first version, after its first run", versionOf(run(bin, ["check"]).text));

  // A long-running command of the installed first version.
  const beat = path.join(work, `${installer}-${kind}.beat`);
  const long = spawn(isWindows ? `"${bin}"` : bin, ["sleep", "90", beat], { stdio: "ignore", shell: isWindows, detached: !isWindows });
  for (let i = 0; i < 50 && !fs.existsSync(beat); i++) await sleep(100);
  line("long-running command started", fs.existsSync(beat) ? `yes (${fs.readFileSync(beat, "utf8")})` : "NO");

  const upgrade = install(V2);
  const log = `${upgrade.stdout || ""}${upgrade.stderr || ""}`.trim();
  line("upgrade while it runs: package manager", upgrade.status === 0 ? "succeeded" : `FAILED (exit ${upgrade.status})`);
  if (upgrade.status !== 0) console.log(log.split("\n").map((l) => `      ${l}`).join("\n"));

  const before = fs.readFileSync(beat, "utf8");
  await sleep(700);
  const after = fs.readFileSync(beat, "utf8");
  line("the running command kept running", before !== after ? `yes (still ${after.split(" ")[0]})` : "NO, it stopped");

  const now = run(bin, ["check"]);
  line("command right after the upgrade", `${versionOf(now.text)}${now.code === 0 ? "" : ` (exit ${now.code})`}`);
  const again = run(bin, ["check"]);
  line("and on the next run", `${versionOf(again.text)}${again.code === 0 ? "" : ` (exit ${again.code})`}`);

  fs.writeFileSync(`${beat}.stop`, "");
  await new Promise((resolve) => (long.exitCode === null ? long.once("exit", resolve) : resolve()));
  await sleep(300);

  const settled = [run(bin, ["check"]), run(bin, ["check"])].pop();
  line("after the old command has ended", `${versionOf(settled.text)}${settled.code === 0 ? "" : ` (exit ${settled.code})`}`);
  if (upgrade.status !== 0 && versionOf(settled.text) !== V1) broken++;
  if (upgrade.status === 0 && versionOf(settled.text) !== V2) {
    // The package manager said the upgrade worked, yet the old binary runs.
    const retry = install(V2);
    const fixed = versionOf([run(bin, ["check"]), run(bin, ["check"])].pop().text);
    line("installing the new version once more", `${retry.status === 0 ? "succeeded" : "FAILED"}, command is ${fixed}`);
    if (fixed !== V2) broken++;
  }
}

fs.mkdirSync(path.join(work, "project-command"), { recursive: true });
fs.writeFileSync(
  path.join(work, "project-command", "package.json"),
  JSON.stringify({ name: KINDS[0].name, version: "0.0.0", license: "MIT", rustify: { bins: { toy: "toy" } } }),
);
// The binaries-only fixture of the pipeline's own CI, with the lookup it uses.
fs.cpSync(path.join(HERE, "toy-extras"), path.join(work, "project-binaries-only"), { recursive: true });
fs.copyFileSync(path.join(NPM, "native-binary.mjs"), path.join(work, "project-binaries-only", "native-binary.mjs"));
const registryProcess = spawn(process.execPath, [path.join(NPM, "registry.mjs"), path.join(work, "registry")], {
  stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, RUSTIFY_UPSTREAM_REGISTRY: "" },
});
try {
  const registry = await new Promise((resolve, reject) => {
    registryProcess.once("error", reject);
    registryProcess.stdout.once("data", (d) => resolve(String(d).trim()));
  });
  const npmrc = path.join(work, "npmrc");
  fs.writeFileSync(npmrc, `//${registry.replace(/^https?:\/\//, "")}/:_authToken=upgrade\n`);
  process.env.NPM_CONFIG_USERCONFIG = npmrc; // npm
  process.env.NPM_CONFIG_TOKEN = "upgrade"; // bun publish
  console.log(`building the toy ${V1} and ${V2} for ${key}`);
  for (const version of [V1, V2]) {
    for (const dist of build(version)) {
      execFileSync(process.execPath, [path.join(NPM, "pack.mjs"), "publish", "--out", dist, "--registry", registry], {
        stdio: ["ignore", "ignore", "inherit"],
      });
    }
  }
  for (const installer of ["bun", "npm"].filter(has)) {
    for (const kind of KINDS) await scenario(installer, registry, kind);
  }
} finally {
  registryProcess.kill();
  await sleep(200);
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.log(`(could not remove ${work}: ${err.code})`);
  }
}
console.log(broken ? `\n${broken} outcome(s) would leave a broken command` : "\nno outcome leaves a broken command");
process.exit(broken ? 1 : 0);
