// Tests of templates/parity/parity.mjs, using two small scripts as the two
// "implementations".
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const RUNNER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates/parity/parity.mjs");
const isWindows = process.platform === "win32";

function setup(rsBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rustify-parity-test-"));
  const base = `
    const fs = require("fs");
    const [cmd, ...rest] = process.argv.slice(2);
    if (cmd === "echo") console.log(rest.join(" "));
    if (cmd === "where") console.log("cwd=" + process.cwd() + " home=" + process.env.HOME);
    if (cmd === "write") fs.writeFileSync("out.txt", rest.join(" ") + "\\n");
    if (cmd === "stdin") console.log(fs.readFileSync(0, "utf8").toUpperCase());
    if (cmd === "env") console.log(process.env.GREETING + " " + process.env.TZ);
    if (cmd === "fail") { console.error("nope"); process.exit(3); }
    if (cmd === "stamp") console.log("at " + new Date().toISOString());
    if (cmd === "tmp") console.log("tmp=" + process.env.TMPDIR + " entries=" + fs.readdirSync(process.env.TMPDIR).length);
    if (cmd === "vars") console.log(rest.map((name) => name + "=" + process.env[name]).join(" "));
    if (cmd === "log") { fs.writeFileSync(process.env.LOG, rest.join(" ") + "\\n"); console.log(fs.readFileSync(process.env.LOG, "utf8") + require("path").relative(process.env.TMPDIR, process.env.LOG)); }
    // Stands for something else on the machine cleaning up the temp directory.
    if (cmd === "remove") fs.rmSync(require("path").resolve(process.env.TMPDIR, rest[0]), { recursive: true, force: true });
    // A program that removes a directory of its own on purpose.
    if (cmd === "remove-own") { fs.rmSync(process.env[rest[0]], { recursive: true, force: true }); console.log("removed " + rest[0] + ", which is there: " + fs.existsSync(process.env[rest[0]])); }
    if (cmd === "inuse") console.log(fs.readFileSync(require("path").resolve(process.env.TMPDIR, "../../IN-USE"), "utf8"));
  `;
  fs.writeFileSync(path.join(dir, "ts.cjs"), base);
  fs.writeFileSync(path.join(dir, "rs.cjs"), rsBody ? base + rsBody : base);
  return dir;
}

function run(dir, cases, extra = [], env = process.env) {
  fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify(cases));
  return spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--ts", `${process.execPath} ts.cjs`, "--rs", `${process.execPath} rs.cjs`, ...extra], {
    cwd: dir,
    encoding: "utf8",
    env,
  });
}

// What --show printed under one case: the text from its name to the next case.
function shown(output, name) {
  const from = output.indexOf(`  same    ${name}\n`);
  assert.notEqual(from, -1, `no "same" line for ${name} in:\n${output}`);
  const rest = output.slice(from + 1);
  const next = rest.search(/\n {2}\S|\n\S/);
  return next === -1 ? rest : rest.slice(0, next);
}

const CASES = {
  env: { TZ: "UTC" },
  cases: [
    { name: "plain output", args: ["echo", "a", "b"] },
    { name: "temp paths are normalised", args: ["where"] },
    { name: "files left behind", args: ["write", "hello"], after: ["cat out.txt"] },
    { name: "stdin", args: ["stdin"], stdin: "abc" },
    { name: "env", args: ["env"], env: { GREETING: "hi" } },
    { name: "exit code and stderr", args: ["fail"] },
    { name: "input files and setup", args: ["echo", "x"], files: { "in/a.txt": "1\n" }, setup: ["cp in/a.txt b.txt"], after: ["cat b.txt"] },
    { name: "a timestamp, normalised", args: ["stamp"], normalize: [["\\d{4}-[\\d:.TZ-]+", "<TIME>"]] },
  ],
};

test("identical implementations pass every case", () => {
  const dir = setup();
  try {
    const r = run(dir, CASES);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /all 8 case\(s\) behave the same/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a difference in stdout, in the exit code or in a file is reported", () => {
  const dir = setup(`
    if (cmd === "echo") console.log("extra");
    if (cmd === "fail") process.exitCode = 4;
    if (cmd === "write") fs.appendFileSync("out.txt", "more\\n");
  `);
  try {
    const r = run(dir, CASES);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /DIFFER {2}plain output {2}\(stdout\)/);
    assert.match(r.stdout, /DIFFER {2}files left behind {2}\(after: cat out\.txt\)/);
    assert.match(r.stdout, /same {4}stdin/);
    assert.match(r.stdout, /3 of 8 case\(s\) differ/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--filter runs a subset, and a filter that matches nothing is an error", () => {
  const dir = setup();
  try {
    assert.match(run(dir, CASES, ["--filter", "stdin"]).stdout, /all 1 case\(s\) behave the same/);
    assert.equal(run(dir, CASES, ["--filter", "no such case"]).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing setup command is reported as broken, not as a pass", () => {
  const dir = setup();
  try {
    const r = run(dir, { cases: [{ name: "bad setup", args: ["echo"], setup: ["exit 7"] }] });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /BROKEN {2}bad setup/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("<CWD> and <HOME> in a case stand for the directories of the run", () => {
  const dir = setup();
  try {
    const r = run(dir, {
      cases: [
        {
          name: "placeholders",
          args: ["echo", "<CWD>/a", "<HOME>/b"],
          env: { GREETING: "<HOME>" },
          files: { "ref.txt": "<CWD>\n" },
          after: ["cat ref.txt", "test -d '<HOME>' && echo home-exists"],
        },
        { name: "env placeholder reaches the program", args: ["env"], env: { GREETING: "<CWD>", TZ: "UTC" } },
        { name: "<REPO> is where the runner was started", args: ["echo", "x"], after: ["test -f '<REPO>/parity.json' && echo found-the-cases-file"] },
        { name: "each run has its own empty temp directory", args: ["tmp"] },
      ],
    }, ["--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /all 4 case\(s\) behave the same/);
    assert.match(r.stdout, /found-the-cases-file/);
    assert.match(r.stdout, /tmp=<ROOT>[\\/]tmp entries=0/);
    // --show prints what was compared, with the run's paths normalised again.
    assert.match(r.stdout, /<CWD>\/a <HOME>\/b/);
    assert.match(r.stdout, /home-exists/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--handback tells the cases the binary answers from the ones it hands back", () => {
  // Stands for a binary: hands `back …` to the entry under $DEMO_ROOT, answers the rest.
  const dir = setup(`
    if (cmd === "back") {
      const { spawnSync } = require("child_process");
      const r = spawnSync(process.execPath, [require("path").join(process.env.DEMO_ROOT, "dist/cli.js"), ...rest], { stdio: "inherit" });
      process.exit(r.status);
    }
  `);
  const handback = (cases) => {
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({ cases }));
    return spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--rs", `${process.execPath} rs.cjs`, "--handback", "DEMO_ROOT=dist/cli.js"], { cwd: dir, encoding: "utf8" });
  };
  try {
    const good = handback([
      { name: "native", args: ["echo", "x"] },
      { name: "goes back", args: ["back", "y"], handback: "not ported" },
    ]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /1 case\(s\) answered by the binary, 1 handed back to the JavaScript, as the cases say/);

    const wrong = handback([
      { name: "believed native", args: ["back", "x"] },
      { name: "believed handed back", args: ["echo", "y"], handback: "not ported" },
    ]);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stdout, /WRONG {3}believed native\n\s+reached the JavaScript/);
    assert.match(wrong.stdout, /WRONG {3}believed handed back\n\s+was answered by the binary/);
    assert.match(wrong.stdout, /2 of 2 case\(s\) went the wrong way/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("null in an env removes the variable: the cases file's, or one the runner sets", () => {
  const dir = setup();
  try {
    const r = run(dir, {
      env: { GREETING: "hi", XDG_DATA_HOME: null },
      cases: [
        { name: "as the cases file says", args: ["vars", "GREETING", "XDG_DATA_HOME", "HOME"] },
        { name: "a case removes the cases file's", args: ["vars", "GREETING"], env: { GREETING: null } },
        { name: "a case removes the runner's", args: ["vars", "XDG_CONFIG_HOME", "TMPDIR"], env: { XDG_CONFIG_HOME: null, TMPDIR: null } },
        { name: "a case sets what the cases file removed", args: ["vars", "XDG_DATA_HOME"], env: { XDG_DATA_HOME: "<HOME>/data" } },
        { name: "a name in other letters", args: ["vars", "TMPDIR"], env: { tmpdir: null } },
      ],
    }, ["--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "as the cases file says"), /GREETING=hi XDG_DATA_HOME=undefined HOME=<HOME>\n/);
    assert.match(shown(r.stdout, "a case removes the cases file's"), /GREETING=undefined\n/);
    assert.match(shown(r.stdout, "a case removes the runner's"), /XDG_CONFIG_HOME=undefined TMPDIR=undefined\n/);
    assert.match(shown(r.stdout, "a case sets what the cases file removed"), /XDG_DATA_HOME=<HOME>\/data\n/);
    // One variable on Windows, two different ones elsewhere.
    assert.match(shown(r.stdout, "a name in other letters"), isWindows ? /TMPDIR=undefined\n/ : /TMPDIR=<ROOT>[\\/]tmp\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("<ROOT> is the run's own directory, beside the ones the program is given", () => {
  const dir = setup();
  try {
    const r = run(dir, { cases: [{ name: "a log of its own", args: ["log", "asked", "<ROOT>"], env: { LOG: "<ROOT>/requests.log" } }] }, ["--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // Written and read back there; one level up from the temp directory.
    assert.match(shown(r.stdout, "a log of its own"), /asked <ROOT>\n\s+\.\.[\\/]requests\.log\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a cases file that is not JSON, or has no list of cases, is said so in one line, with exit code 2", () => {
  const dir = setup();
  try {
    const raw = (text) => {
      fs.writeFileSync(path.join(dir, "raw.json"), text);
      return spawnSync(process.execPath, [RUNNER, "--cases", "raw.json", "--ts", "x", "--rs", "x"], { cwd: dir, encoding: "utf8" });
    };
    const notJson = raw("{ cases: [] }");
    assert.equal(notJson.status, 2, notJson.stdout + notJson.stderr);
    assert.match(notJson.stderr, /^parity: raw\.json: .*JSON.*\n$/);
    const noList = raw("{}");
    assert.equal(noList.status, 2, noList.stdout + noList.stderr);
    assert.equal(noList.stderr, 'parity: raw.json has no "cases" list\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a run whose directory is removed under it stops with one message and exit code 3", () => {
  const dir = setup();
  try {
    const cases = (target) => ({
      cases: [
        { name: "before", args: ["echo", "1"] },
        { name: "meanwhile", args: ["remove", target], after: ["echo probed"] },
        { name: "after", args: ["echo", "2"] },
      ],
    });
    // The file that marks the directory as in use: on every system. A
    // directory that a program is running in cannot be removed on Windows.
    const targets = [["../../IN-USE", /rustify-parity-\w+[\\/]IN-USE/]];
    if (!isWindows) targets.push(["..", /rustify-parity-\w+[\\/]1-ts/], ["../..", /rustify-parity-\w+/]);
    for (const [target, gone] of targets) {
      const r = run(dir, cases(target));
      assert.equal(r.status, 3, r.stdout + r.stderr);
      const lines = r.stdout.trimEnd().split("\n");
      assert.deepEqual(lines.slice(0, -1), ["  same    before"], r.stdout);
      assert.match(lines.at(-1), /^parity: stopped, because \S+ is gone: something else on this machine removed this run's directory, or part of it, while the cases were running .* not a result of the port\. Run it again\.$/);
      assert.match(lines.at(-1), gone);
      assert.doesNotMatch(r.stdout, /DIFFER|BROKEN|differ|behave the same/);
    }
    // --handback: the same, and also when only the stand-in package goes.
    const handback = (target) => {
      fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify(cases(target)));
      return spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--rs", `${process.execPath} rs.cjs`, "--handback", "DEMO_ROOT=dist/cli.js"], { cwd: dir, encoding: "utf8" });
    };
    for (const [target, gone] of [...targets, ["../../stand-in", /rustify-parity-\w+[\\/]stand-in[\\/]dist[\\/]cli\.js/]]) {
      const r = handback(target);
      assert.equal(r.status, 3, r.stdout + r.stderr);
      // Only the binary runs here, so the case's directory is 1-rs.
      assert.match(r.stdout.trimEnd().split("\n").at(-1), new RegExp(gone.source.replace("1-ts", "1-rs")));
      assert.doesNotMatch(r.stdout, /WRONG|BROKEN|went the wrong way|as the cases say/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a program that removes its own HOME or temp directory is compared, not taken for a vanished run", () => {
  const dir = setup(`
    if (cmd === "remove-own" && rest.includes("HOME")) process.exitCode = 1;
  `);
  try {
    const r = run(dir, {
      cases: [
        { name: "the temp directory", args: ["remove-own", "TMPDIR"] },
        { name: "HOME", args: ["remove-own", "HOME"] },
        { name: "after them", args: ["echo", "x"] },
      ],
    }, ["--show"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "the temp directory"), /removed TMPDIR, which is there: false\n/);
    assert.match(r.stdout, /DIFFER {2}HOME {2}\(exit code\)/);
    assert.match(r.stdout, /same {4}after them\n[^]*\n1 of 3 case\(s\) differ\n$/);
    assert.doesNotMatch(r.stdout, /stopped|gone/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--keep leaves the run's directory, names it, and says to remove that one only", () => {
  const dir = setup();
  let kept;
  try {
    const r = run(dir, { cases: [{ name: "one", args: ["write", "hello"] }, { name: "the IN-USE file", args: ["inuse"] }] }, ["--keep", "--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    kept = /^kept (.+)$/m.exec(r.stdout)?.[1];
    assert.ok(kept && fs.existsSync(path.join(kept, "0-rs", "cwd", "out.txt")), r.stdout);
    assert.ok(r.stdout.includes(`kept ${kept}\n  When you are done with it, remove that directory by this exact path, and nothing else:\n`), r.stdout);
    assert.match(r.stdout, /never .*rustify-parity-\* as a pattern, which takes the directories of runs still going\./);
    // While the run lasts the directory says whose it is; once kept, nobody is in it any more.
    assert.match(shown(r.stdout, "the IN-USE file"), /A rustify parity run is working in this directory: process \d+ on .*\n\s+Do not remove it while that process is alive\./);
    assert.ok(!fs.existsSync(path.join(kept, "IN-USE")), "IN-USE is still there");
  } finally {
    // Its exact path, and only if it is what the runner made.
    if (kept && /rustify-parity-\w{6}$/.test(kept)) fs.rmSync(kept, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
