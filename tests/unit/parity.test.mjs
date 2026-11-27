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
const TERMINAL_PY = path.join(path.dirname(RUNNER), "terminal.py");
const isWindows = process.platform === "win32";
// The runtime that runs the tests, as the runner's --ts and --rs take it: in
// double quotes when its path has a space (C:\Program Files\nodejs\node.exe).
const RUNTIME = /\s/.test(process.execPath) ? `"${process.execPath}"` : process.execPath;

// The tests that run a program on a terminal need python3 and a
// pseudo-terminal. Where there is none they are skipped, and say so.
const noTerminal = (() => {
  if (isWindows) return "the runner has no terminal to give on Windows";
  const check = spawnSync("python3", ["-I", TERMINAL_PY, "--check"], { encoding: "utf8" });
  if (check.error) return `python3 could not be started here (${check.error.code})`;
  if (check.status !== 0) return `no pseudo-terminal could be opened here (${check.stderr.trim()})`;
  return false;
})();
const noBun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0 ? false : "bun is not installed here";

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
    if (cmd === "kind") console.log("stdout is a " + (fs.fstatSync(1).isFile() ? "file" : "pipe") + ", stderr is a " + (fs.fstatSync(2).isFile() ? "file" : "pipe"));
    if (cmd === "both") { console.log("to stdout"); console.error("to stderr"); }
    if (cmd === "tty") console.log("in=" + Boolean(process.stdin.isTTY) + " out=" + Boolean(process.stdout.isTTY) + " err=" + Boolean(process.stderr.isTTY));
    if (cmd === "ask") {
      process.stderr.write("commit? [y/N] ");
      const answer = Buffer.alloc(64);
      const length = fs.readSync(0, answer, 0, 64, null);
      console.log(/^ *y/i.test(answer.toString("utf8", 0, length)) ? "committed" : "left alone");
    }
    if (cmd === "window") console.log(process.stdout.columns + "x" + process.stdout.rows + " TERM=" + process.env.TERM);
    if (cmd === "wait") { process.stdout.write("still here "); setTimeout(() => {}, 60000); }
    // Stands for something else on the machine cleaning up the temp directory.
    if (cmd === "remove") fs.rmSync(require("path").resolve(process.env.TMPDIR, rest[0]), { recursive: true, force: true });
    // A program that removes a directory of its own on purpose.
    if (cmd === "remove-own") { fs.rmSync(process.env[rest[0]], { recursive: true, force: true }); console.log("removed " + rest[0] + ", which is there: " + fs.existsSync(process.env[rest[0]])); }
    if (cmd === "inuse") console.log(fs.readFileSync(require("path").resolve(process.env.TMPDIR, "../../IN-USE"), "utf8"));
    if (cmd === "die") process.kill(process.pid, rest[0]);
    if (cmd === "bytes") process.stdout.write(Buffer.from(rest[0], "hex"));
    if (cmd === "json") console.log(JSON.stringify({ cwd: process.cwd(), home: process.env.HOME }));
    if (cmd === "args") console.log(JSON.stringify(rest));
    // The working directory in the spellings a program on Windows may come upon.
    if (cmd === "spellings") {
      const cwd = process.cwd();
      const slashed = cwd.replace(/\\\\/g, "/");
      const cmdExe = require("path").join(process.env.SystemRoot, "System32", "cmd.exe");
      const short = require("child_process").spawnSync(cmdExe, ["/d", "/c", "for %I in (.) do @echo %~sI"], { encoding: "utf8", windowsVerbatimArguments: true }).stdout.trim();
      console.log([cwd, slashed, slashed[0].toLowerCase() + slashed.slice(1), "/" + slashed[0].toLowerCase() + slashed.slice(2), JSON.stringify(cwd), short].join("\\n"));
    }
    // Asks for a password; hidden: echo is off before the question appears.
    function password(hidden) {
      if (hidden) process.stdin.setRawMode(true);
      process.stderr.write("Password: ");
      let got = "";
      process.stdin.on("data", (data) => {
        got += data;
        if (!/[\\r\\n]/.test(got)) return;
        if (hidden) process.stdin.setRawMode(false);
        console.log("\\ngot " + got.trim().length + " characters");
        process.exit(0);
      });
    }
  `;
  fs.writeFileSync(path.join(dir, "ts.cjs"), base);
  fs.writeFileSync(path.join(dir, "rs.cjs"), rsBody ? base + rsBody : base);
  return dir;
}

function run(dir, cases, extra = [], env = process.env) {
  fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify(cases));
  return spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--ts", `${RUNTIME} ts.cjs`, "--rs", `${RUNTIME} rs.cjs`, ...extra], {
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

test("an option's value may follow an equals sign, and an option the runner does not know stops it", () => {
  const dir = setup();
  try {
    const cases = { cases: [{ name: "pipes or files", args: ["kind"] }, { name: "another", args: ["echo", "x"] }] };
    const r = run(dir, cases, ["--show", "--capture=files", "--filter=pipes or files"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "pipes or files"), /stdout is a file, stderr is a file\n/);
    assert.match(r.stdout, /all 1 case\(s\) behave the same/);

    for (const extra of [["--tyy", "stdout"], ["--capture-files"], ["--Show"]]) {
      const wrong = run(dir, cases, extra);
      assert.equal(wrong.status, 2, wrong.stdout + wrong.stderr);
      assert.equal(wrong.stdout, "");
      assert.match(wrong.stderr, new RegExp(`^parity: ${extra[0]} is not an option of the runner\nusage: `));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a --handback that is not ROOT_ENV=entry stops the run before its directory is made", () => {
  const dir = setup();
  const tmp = path.join(dir, "tmp");
  fs.mkdirSync(tmp);
  try {
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({ cases: [{ name: "one", args: ["echo", "x"] }] }));
    for (const value of ["NOEQUALS", "=dist/cli.js", "DEMO_ROOT="]) {
      const r = spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--rs", `${RUNTIME} rs.cjs`, "--handback", value], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
      });
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.equal(r.stderr, "parity: --handback needs <ROOT_ENV>=<js entry>, e.g. MYCLI_PACKAGE_ROOT=dist/cli.js\n");
      assert.deepEqual(fs.readdirSync(tmp), [], `${value} left a directory behind`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a program ended by a signal: which signal is compared", { skip: isWindows && "Windows has no signals to end a program with" }, () => {
  const dir = setup(`
    if (cmd === "another signal") process.kill(process.pid, "SIGKILL");
    if (cmd === "a signal or an exit code") process.exit(1);
  `);
  fs.appendFileSync(path.join(dir, "ts.cjs"), `if (cmd === "another signal" || cmd === "a signal or an exit code") process.kill(process.pid, "SIGTERM");\n`);
  try {
    const r = run(dir, {
      cases: [
        { name: "the same signal", args: ["die", "SIGTERM"] },
        { name: "another signal", args: ["another signal"] },
        { name: "a signal or an exit code", args: ["a signal or an exit code"] },
      ],
    }, ["--show"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "the same signal"), /exit code:\n\s+signal SIGTERM\n/);
    assert.match(r.stdout, /DIFFER {2}another signal {2}\(exit code\)\n\s+exit code\n\s+TypeScript:\n\s+signal SIGTERM\n\s+Rust:\n\s+signal SIGKILL\n/);
    assert.match(r.stdout, /DIFFER {2}a signal or an exit code {2}\(exit code\)\n\s+exit code\n\s+TypeScript:\n\s+signal SIGTERM\n\s+Rust:\n\s+1\n/);
    assert.match(r.stdout, /2 of 3 case\(s\) differ/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Bytes that are not UTF-8: one invalid byte each, and a few sequences that
// look like UTF-8 and are not (an overlong "/", an encoded surrogate, a code
// point past U+10FFFF, a lead byte at the end).
const INVALID = "61ff80" + "c0af" + "eda080" + "f4908080" + "c3";
const INVALID_SHOWN = "a\\xff\\x80\\xc0\\xaf\\xed\\xa0\\x80\\xf4\\x90\\x80\\x80\\xc3";
// And UTF-8 that must come through as it is, U+10080 included: its second
// UTF-16 unit is one that stands for an invalid byte when it is alone.
const VALID = Buffer.from("é ✓ 😀 \u{10080}\n").toString("hex");

test("capture: files compares bytes, so bytes that are not UTF-8 are told apart; pipes read UTF-8 as before", () => {
  const dir = setup(`
    if (cmd === "invalid") process.stdout.write(Buffer.from([0x61, 0xfe, 0x0a]));
  `);
  fs.appendFileSync(path.join(dir, "ts.cjs"), `if (cmd === "invalid") process.stdout.write(Buffer.from([0x61, 0xff, 0x0a]));\n`);
  try {
    const r = run(dir, {
      cases: [
        { name: "different invalid bytes, through pipes", args: ["invalid"] },
        { name: "different invalid bytes, into files", args: ["invalid"], capture: "files" },
        { name: "the same invalid bytes", args: ["bytes", INVALID], capture: "files" },
        { name: "UTF-8", args: ["bytes", VALID], capture: "files" },
      ],
    }, ["--show"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    // As the runner always did: both become U+FFFD.
    assert.match(shown(r.stdout, "different invalid bytes, through pipes"), /stdout:\n\s+a�\n/);
    assert.match(r.stdout, /DIFFER {2}different invalid bytes, into files {2}\(stdout\)\n\s+stdout\n\s+TypeScript:\n\s+a\\xff\n\s+\n\s+Rust:\n\s+a\\xfe\n/);
    assert.ok(shown(r.stdout, "the same invalid bytes").includes(`stdout:\n        ${INVALID_SHOWN}\n`), r.stdout);
    assert.ok(shown(r.stdout, "UTF-8").includes("stdout:\n        é ✓ 😀 \u{10080}\n"), r.stdout);
    assert.match(r.stdout, /1 of 4 case\(s\) differ/);
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
    return spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--rs", `${RUNTIME} rs.cjs`, "--handback", "DEMO_ROOT=dist/cli.js"], { cwd: dir, encoding: "utf8" });
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
        { name: "a value under a name in other letters", args: ["vars", "TMPDIR", "tmpdir"], env: { tmpdir: "<HOME>" } },
      ],
    }, ["--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "as the cases file says"), /GREETING=hi XDG_DATA_HOME=undefined HOME=<HOME>\n/);
    assert.match(shown(r.stdout, "a case removes the cases file's"), /GREETING=undefined\n/);
    assert.match(shown(r.stdout, "a case removes the runner's"), /XDG_CONFIG_HOME=undefined TMPDIR=undefined\n/);
    assert.match(shown(r.stdout, "a case sets what the cases file removed"), /XDG_DATA_HOME=<HOME>\/data\n/);
    // One variable on Windows, two different ones elsewhere.
    assert.match(shown(r.stdout, "a name in other letters"), isWindows ? /TMPDIR=undefined\n/ : /TMPDIR=<ROOT>[\\/]tmp\n/);
    // On Windows it takes the place of the runner's TMPDIR, and node finds it under either name.
    assert.match(shown(r.stdout, "a value under a name in other letters"), isWindows ? /TMPDIR=<HOME> tmpdir=<HOME>\n/ : /TMPDIR=<ROOT>[\\/]tmp tmpdir=<HOME>\n/);
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
      return spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--rs", `${RUNTIME} rs.cjs`, "--handback", "DEMO_ROOT=dist/cli.js"], { cwd: dir, encoding: "utf8" });
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

test("a mistake in capture stops the run before any case, with exit code 2", () => {
  const dir = setup();
  try {
    const bad = (cases, extra = []) => {
      const r = run(dir, { cases }, extra);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      return r.stderr;
    };
    assert.match(bad([{ name: "a", args: ["echo"], capture: "file" }]), /^parity: case "a": "capture" takes "files" or "pipes"; it has "file"\n$/);
    assert.match(bad([{ name: "a", args: ["echo"] }], ["--capture"]), /^parity: --capture takes files or pipes; it has nothing\n$/);
    // A case that --filter leaves out is not looked at.
    const r = run(dir, { cases: [{ name: "good", args: ["echo", "x"] }, { name: "bad", args: ["echo"], capture: "nowhere" }] }, ["--filter", "good"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("capture: files gives the program regular files instead of pipes, and compares what is in them", () => {
  const dir = setup(`
    if (cmd === "both") console.log("one more line");
  `);
  try {
    const cases = {
      cases: [
        { name: "pipes", args: ["kind"] },
        { name: "files", args: ["kind"], capture: "files" },
        { name: "pipes although the command line says otherwise", args: ["kind"], capture: "pipes" },
        { name: "a difference", args: ["both"], capture: "files" },
        { name: "the exit code and stderr", args: ["fail"], capture: "files" },
      ],
    };
    const r = run(dir, cases, ["--show"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "pipes"), /stdout is a pipe, stderr is a pipe\n/);
    assert.match(shown(r.stdout, "files"), /stdout is a file, stderr is a file\n/);
    assert.match(r.stdout, /DIFFER {2}a difference {2}\(stdout\)\n\s+stdout\n\s+TypeScript:\n\s+to stdout\n\s+\n\s+Rust:\n\s+to stdout\n\s+one more line\n/);
    assert.match(shown(r.stdout, "the exit code and stderr"), /exit code:\n\s+3\n\s+stdout:\n\s+\n\s+stderr:\n\s+nope\n/);
    assert.match(r.stdout, /1 of 5 case\(s\) differ/);

    const flagged = run(dir, cases, ["--show", "--capture", "files", "--filter", "pipes"]);
    assert.equal(flagged.status, 0, flagged.stdout + flagged.stderr);
    assert.match(shown(flagged.stdout, "pipes"), /stdout is a file, stderr is a file\n/);
    assert.match(shown(flagged.stdout, "pipes although the command line says otherwise"), /stdout is a pipe, stderr is a pipe\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("capture: files, a bun program that prints 2000 lines after reading isTTY arrives whole every time", { skip: noBun }, () => {
  // Through pipes bun 1.4.0 loses lines of this at random (whole in 0 of 20
  // runs at 5000 lines when this was written), so the same program compared
  // with itself differs. Into files it must never.
  const dir = setup();
  try {
    fs.writeFileSync(path.join(dir, "lines.js"), `const tty = process.stdout.isTTY;\nfor (let i = 0; i < 2000; i++) console.log("line " + i + " " + "x".repeat(60) + " " + Boolean(tty));\n`);
    const cases = [];
    for (let i = 1; i <= 10; i++) cases.push({ name: `run ${i}`, args: [], capture: "files" });
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({ cases }));
    const r = spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--ts", "bun lines.js", "--rs", "bun lines.js", "--show"], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /all 10 case\(s\) behave the same/);
    // And whole: 2000 lines and the empty one after the last line end.
    for (let i = 1; i <= 10; i++) assert.match(shown(r.stdout, `run ${i}`), /line 0 x+ false\n[^]*… 1971 more line\(s\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const TTY_CASES = {
  cases: [
    { name: "all three", args: ["tty"], tty: true },
    { name: "only stdout", args: ["tty"], tty: "stdout" },
    { name: "stdin and stderr", args: ["tty"], tty: ["stdin", "stderr"] },
    { name: "pipes although the command line says otherwise", args: ["tty"], tty: false },
    { name: "what the command line says", args: ["tty"] },
  ],
};

test("tty: a case says which of stdin, stdout and stderr are a terminal; --tty says it for the rest", { skip: noTerminal }, () => {
  const dir = setup();
  try {
    const plain = run(dir, TTY_CASES, ["--show"]);
    assert.equal(plain.status, 0, plain.stdout + plain.stderr);
    // Everything the terminal was sent is compared as "terminal", with the line end a terminal gets.
    assert.match(shown(plain.stdout, "all three"), /exit code:\n\s+0\n\s+terminal:\n\s+in=true out=true err=true\\r\n/);
    assert.doesNotMatch(shown(plain.stdout, "all three"), /stdout:|stderr:/);
    // A stream that is not the terminal is still compared on its own.
    assert.match(shown(plain.stdout, "only stdout"), /stderr:\n\s+\n\s+terminal:\n\s+in=false out=true err=false\\r\n/);
    assert.match(shown(plain.stdout, "stdin and stderr"), /stdout:\n\s+in=true out=false err=true\n/);
    assert.match(shown(plain.stdout, "pipes although the command line says otherwise"), /stdout:\n\s+in=false out=false err=false\n/);
    assert.match(shown(plain.stdout, "what the command line says"), /stdout:\n\s+in=false out=false err=false\n/);

    const flagged = run(dir, TTY_CASES, ["--show", "--tty", "stdout,stderr"]);
    assert.equal(flagged.status, 0, flagged.stdout + flagged.stderr);
    assert.match(shown(flagged.stdout, "what the command line says"), /terminal:\n\s+in=false out=true err=true\\r\n/);
    assert.match(shown(flagged.stdout, "pipes although the command line says otherwise"), /stdout:\n\s+in=false out=false err=false\n/);
    assert.match(shown(flagged.stdout, "only stdout"), /in=false out=true err=false/);

    const all = run(dir, TTY_CASES, ["--tty", "--show", "--filter", "what the command line says"]);
    assert.match(shown(all.stdout, "what the command line says"), /terminal:\n\s+in=true out=true err=true\\r\n/);

    const equals = run(dir, TTY_CASES, ["--tty=stdout", "--show", "--filter=what the command line says"]);
    assert.equal(equals.status, 0, equals.stdout + equals.stderr);
    assert.match(shown(equals.stdout, "what the command line says"), /terminal:\n\s+in=false out=true err=false\\r\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: a difference that only a terminal shows is reported, with its control characters spelled out", { skip: noTerminal }, () => {
  // Stands for a port that forgot the colour its TypeScript prints on a terminal.
  const dir = setup(`
    if (cmd === "status") console.log("clean");
  `);
  fs.appendFileSync(path.join(dir, "ts.cjs"), `if (cmd === "status") console.log(process.stdout.isTTY ? "\\x1b[32mclean\\x1b[0m" : "clean");\n`);
  try {
    const cases = { cases: [{ name: "status", args: ["status"] }] };
    assert.match(run(dir, cases).stdout, /all 1 case\(s\) behave the same/);
    const r = run(dir, cases, ["--tty", "stdout"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /DIFFER {2}status {2}\(terminal\)/);
    assert.match(r.stdout, /TypeScript:\n\s+\\e\[32mclean\\e\[0m\\r\n/);
    assert.match(r.stdout, /Rust:\n\s+clean\\r\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: stdout and stderr on the terminal are one stream; apart when only one of them is", { skip: noTerminal }, () => {
  const dir = setup();
  try {
    const r = run(dir, {
      cases: [
        { name: "together", args: ["both"], tty: true },
        { name: "apart", args: ["both"], tty: "stdout" },
        { name: "the exit code comes through", args: ["fail"], tty: true },
      ],
    }, ["--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "together"), /terminal:\n\s+to stdout\\r\n\s+to stderr\\r\n/);
    assert.match(shown(r.stdout, "apart"), /stderr:\n\s+to stderr\n\s+\n\s+terminal:\n\s+to stdout\\r\n/);
    assert.match(shown(r.stdout, "the exit code comes through"), /exit code:\n\s+3\n\s+terminal:\n\s+nope\\r\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: stdin is typed into the terminal, at once or when the question has been asked", { skip: noTerminal }, () => {
  const dir = setup();
  try {
    const cases = {
      cases: [
        { name: "answered when asked", args: ["ask"], tty: true, stdin: [["[y/N] ", "y\n"]] },
        { name: "typed ahead", args: ["ask"], tty: true, stdin: "n\n" },
        { name: "the question goes to a pipe", args: ["ask"], tty: "stdin,stdout", stdin: "y\n" },
      ],
    };
    const r = run(dir, cases, ["--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // The terminal echoes what is typed: after the question, or before the program has started.
    assert.match(shown(r.stdout, "answered when asked"), /terminal:\n\s+commit\? \[y\/N\] y\\r\n\s+committed\\r\n/);
    assert.match(shown(r.stdout, "typed ahead"), /terminal:\n\s+n\\r\n\s+commit\? \[y\/N\] left alone\\r\n/);
    assert.match(shown(r.stdout, "the question goes to a pipe"), /stderr:\n\s+commit\? \[y\/N\] \n\s+terminal:\n\s+y\\r\n\s+committed\\r\n/);

    // An answer that one side reads differently is a difference.
    fs.appendFileSync(path.join(dir, "rs.cjs"), `if (cmd === "ask") console.log("and one more line");\n`);
    const differs = run(dir, cases, ["--filter", "answered when asked"]);
    assert.equal(differs.status, 1);
    assert.match(differs.stdout, /DIFFER {2}answered when asked {2}\(terminal\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: a password echoed on one side only differs when it is typed at the question, not ahead", { skip: noTerminal }, () => {
  // Stands for a port that forgot to turn echo off.
  const dir = setup(`
    if (cmd === "password") password(false);
  `);
  fs.appendFileSync(path.join(dir, "ts.cjs"), `if (cmd === "password") password(true);\n`);
  try {
    const r = run(dir, {
      cases: [
        { name: "typed at the question", args: ["password"], tty: true, stdin: [["Password: ", "secret\n"]] },
        // Echoed before either program has started, so both show it.
        { name: "typed ahead", args: ["password"], tty: true, stdin: "secret\n" },
      ],
    }, ["--show"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /DIFFER {2}typed at the question {2}\(terminal\)\n\s+terminal\n\s+TypeScript:\n\s+Password: \\r\n\s+got 6 characters\\r\n[^]*Rust:\n\s+Password: secret\\r\n\s+\\r\n\s+got 6 characters\\r\n/);
    assert.match(shown(r.stdout, "typed ahead"), /terminal:\n\s+secret\\r\n\s+Password: \\r\n\s+got 6 characters\\r\n/);
    assert.match(r.stdout, /1 of 2 case\(s\) differ/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: a program that reads stdin to the end needs Ctrl-D on a terminal, or stdin left a pipe", { skip: noTerminal }, () => {
  const dir = setup();
  try {
    const cases = {
      cases: [
        { name: "piped stdin", args: ["stdin"], stdin: "abc\n", timeout: 2 },
        { name: "ended with Ctrl-D", args: ["stdin"], tty: true, stdin: "abc\n\u0004", timeout: 10 },
      ],
    };
    const all = run(dir, cases, ["--tty"]);
    assert.equal(all.status, 1, all.stdout + all.stderr);
    // What the terminal last showed is the echo, not the empty text after its line end.
    assert.match(
      all.stdout,
      /BROKEN {2}piped stdin\n\s+\S+ had not ended after 2 s on a terminal, which last showed: abc\\r; stdin was the terminal, whose input does not end: a program that reads it to the end needs "\\u0004" typed, or stdin a pipe \("tty": "stdout,stderr"\)\n/,
    );
    assert.match(all.stdout, /same {4}ended with Ctrl-D\n/);
    const r = run(dir, cases, ["--tty", "stdout,stderr", "--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "piped stdin"), /terminal:\n\s+ABC\\r\n/);
    assert.match(shown(r.stdout, "ended with Ctrl-D"), /ABC\\r\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: the terminal's bytes are compared as bytes, and a signal as a signal", { skip: noTerminal }, () => {
  const dir = setup(`
    if (cmd === "invalid") process.stdout.write(Buffer.from([0x61, 0xfe, 0x0a]));
    if (cmd === "control") process.stdout.write(Buffer.from([0x85, 0x0a]));
    if (cmd === "a signal or an exit code") process.exit(1);
  `);
  fs.appendFileSync(
    path.join(dir, "ts.cjs"),
    `if (cmd === "invalid") process.stdout.write(Buffer.from([0x61, 0xff, 0x0a]));\n` +
      `if (cmd === "control") process.stdout.write("\\u0085\\n");\n` +
      `if (cmd === "a signal or an exit code") process.kill(process.pid, "SIGTERM");\n`,
  );
  try {
    const r = run(dir, {
      cases: [
        { name: "different invalid bytes", args: ["invalid"], tty: "stdout" },
        // The character U+0085 against the byte 0x85, which is not UTF-8.
        { name: "a control character or a byte", args: ["control"], tty: "stdout" },
        { name: "the same invalid bytes", args: ["bytes", INVALID], tty: "stdout" },
        { name: "UTF-8", args: ["bytes", VALID], tty: "stdout" },
        { name: "the same signal", args: ["die", "SIGTERM"], tty: true },
        { name: "a signal or an exit code", args: ["a signal or an exit code"], tty: true },
      ],
    }, ["--show"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /DIFFER {2}different invalid bytes {2}\(terminal\)\n\s+terminal\n\s+TypeScript:\n\s+a\\xff\\r\n\s+\n\s+Rust:\n\s+a\\xfe\\r\n/);
    assert.match(r.stdout, /DIFFER {2}a control character or a byte {2}\(terminal\)\n\s+terminal\n\s+TypeScript:\n\s+\\u0085\\r\n\s+\n\s+Rust:\n\s+\\x85\\r\n/);
    assert.ok(shown(r.stdout, "the same invalid bytes").includes(`terminal:\n        ${INVALID_SHOWN}`), r.stdout);
    assert.ok(shown(r.stdout, "UTF-8").includes("terminal:\n        é ✓ 😀 \u{10080}\\r\n"), r.stdout);
    // terminal.py ends the way the program did, so the runner sees the signal.
    assert.match(shown(r.stdout, "the same signal"), /exit code:\n\s+signal SIGTERM\n/);
    assert.match(r.stdout, /DIFFER {2}a signal or an exit code {2}\(exit code\)\n\s+exit code\n\s+TypeScript:\n\s+signal SIGTERM\n\s+Rust:\n\s+1\n/);
    assert.match(r.stdout, /3 of 6 case\(s\) differ/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: the window is 80 by 24 and TERM is set, unless the case says otherwise", { skip: noTerminal }, () => {
  const dir = setup();
  try {
    const r = run(dir, {
      cases: [
        { name: "as given", args: ["window"], tty: true },
        { name: "another TERM", args: ["window"], tty: true, env: { TERM: "dumb" } },
        { name: "no TERM", args: ["window"], tty: true, env: { TERM: null } },
        { name: "no terminal, no TERM", args: ["vars", "TERM"] },
      ],
    }, ["--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "as given"), /80x24 TERM=xterm-256color\\r\n/);
    assert.match(shown(r.stdout, "another TERM"), /80x24 TERM=dumb\\r\n/);
    assert.match(shown(r.stdout, "no TERM"), /80x24 TERM=undefined\\r\n/);
    assert.match(shown(r.stdout, "no terminal, no TERM"), /TERM=undefined\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: --handback finds the stand-in's word on the terminal", { skip: noTerminal }, () => {
  const dir = setup(`
    if (cmd === "back") {
      const { spawnSync } = require("child_process");
      const r = spawnSync(process.execPath, [require("path").join(process.env.DEMO_ROOT, "dist/cli.js"), ...rest], { stdio: "inherit" });
      process.exit(r.status);
    }
  `);
  const handback = (cases, extra = []) => {
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({ cases }));
    return spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--rs", `${RUNTIME} rs.cjs`, "--handback", "DEMO_ROOT=dist/cli.js", ...extra], { cwd: dir, encoding: "utf8" });
  };
  try {
    const cases = [
      { name: "native", args: ["tty"] },
      { name: "goes back", args: ["back", "y"], handback: "not ported" },
    ];
    for (const extra of [["--tty"], ["--tty", "stdout"], ["--tty", "stdin,stderr"]]) {
      const good = handback(cases, extra);
      assert.equal(good.status, 0, good.stdout + good.stderr);
      assert.match(good.stdout, /1 case\(s\) answered by the binary, 1 handed back to the JavaScript, as the cases say/);
    }
    const wrong = handback([{ name: "believed native", args: ["back", "x"], tty: true }]);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stdout, /WRONG {3}believed native\n\s+reached the JavaScript/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: a program that cannot be started, or does not end, is broken and says why", { skip: noTerminal }, () => {
  const dir = setup();
  try {
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({ cases: [{ name: "nothing to run", args: [], tty: true }] }));
    const missing = spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--ts", "no-such-program-anywhere", "--rs", `${RUNTIME} rs.cjs`], { cwd: dir, encoding: "utf8" });
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stdout, /BROKEN {2}nothing to run\n\s+could not run no-such-program-anywhere: /);

    const hangs = run(dir, {
      cases: [
        { name: "waits for ever", args: ["wait"], tty: true, timeout: 2 },
        // The question is "commit? [y/N] ", so the answer is never typed and the program waits for it.
        { name: "waits for a question it never asks", args: ["ask"], tty: true, stdin: [["[Y/n] ", "y\n"]], timeout: 2 },
      ],
    });
    assert.equal(hangs.status, 1, hangs.stdout + hangs.stderr);
    assert.match(hangs.stdout, /BROKEN {2}waits for ever\n\s+\S+ had not ended after 2 s on a terminal, which last showed: still here ; stdin was the terminal, whose input does not end/);
    assert.match(hangs.stdout, /BROKEN {2}waits for a question it never asks\n\s+\S+ had not ended after 2 s on a terminal, which last showed: commit\? \[y\/N\] ; it never showed "\[Y\/n\] ", so "y\\n" was not typed\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: without python3 a case that asks for a terminal is broken, in one line", { skip: isWindows && "Windows has its own line, see the next test" }, () => {
  const dir = setup();
  try {
    // A PATH with nothing on it: the programs of the case are started by their full path.
    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty);
    const r = run(dir, { cases: [{ name: "wants a terminal", args: ["tty"], tty: "stdout" }, { name: "wants none", args: ["tty"] }] }, [], { ...process.env, PATH: empty });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /BROKEN {2}wants a terminal\n {6}this case is to run on a terminal \("tty"\); that takes python3, and no python3 was found on PATH\n {2}same {4}wants none\n1 of 2 case\(s\) differ/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tty: on Windows a case that asks for a terminal is broken, in one line", { skip: !isWindows && "this is about Windows" }, () => {
  const dir = setup();
  try {
    const r = run(dir, { cases: [{ name: "wants a terminal", args: ["tty"], tty: true }, { name: "wants none", args: ["tty"] }] });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /BROKEN {2}wants a terminal\n {6}this case is to run on a terminal \("tty"\), and the runner has none to give on Windows; run it on Linux or macOS\n {2}same {4}wants none\n1 of 2 case\(s\) differ/);
    const flagged = run(dir, { cases: [{ name: "wants none", args: ["tty"] }] }, ["--tty"]);
    assert.equal(flagged.status, 1, flagged.stdout + flagged.stderr);
    assert.match(flagged.stdout, /BROKEN {2}wants none\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a mistake in tty or a typed stdin stops the run before any case, with exit code 2", () => {
  const dir = setup();
  try {
    const bad = (cases, extra = []) => {
      const r = run(dir, { cases }, extra);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      return r.stderr;
    };
    assert.match(bad([{ name: "a", args: ["echo"], tty: "stdout,sterr" }]), /^parity: case "a": "tty" takes true, false, or some of stdin, stdout and stderr; it has sterr\n$/);
    assert.match(bad([{ name: "a", args: ["echo"] }], ["--tty", "out"]), /^parity: --tty takes .* it has out\n$/);
    assert.match(bad([{ name: "a", args: ["echo"] }], ["--tty="]), /^parity: --tty names no stream; it takes true, false, or some of stdin, stdout and stderr\n$/);
    assert.match(bad([{ name: "a", args: ["echo"], tty: [] }]), /^parity: case "a": "tty" names no stream; /);
    assert.match(bad([{ name: "a", args: ["ask"], stdin: [["[y/N] ", "y\n"]] }]), /^parity: case "a": "stdin" as a list is typed at a terminal, and stdin is not one here; say "tty" in the case\n$/);
    assert.match(bad([{ name: "a", args: ["ask"], tty: true, stdin: ["y\n"] }]), /^parity: case "a": "stdin" as a list takes pairs of text, \[what to wait for, what to type\]\n$/);
    // A case that --filter leaves out is not looked at.
    const r = run(dir, { cases: [{ name: "good", args: ["echo", "x"] }, { name: "bad", args: ["echo"], tty: "nowhere" }] }, ["--filter", "good"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("capture: files with a terminal: the streams that are not the terminal go to the files", { skip: noTerminal }, () => {
  const dir = setup();
  try {
    const r = run(dir, { cases: [{ name: "stdin is the terminal", args: ["kind"], tty: "stdin", capture: "files" }, { name: "stdout is", args: ["both"], tty: "stdout", capture: "files" }] }, ["--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "stdin is the terminal"), /stdout:\n\s+stdout is a file, stderr is a file\n/);
    assert.match(shown(r.stdout, "stdout is"), /stderr:\n\s+to stderr\n\s+\n\s+terminal:\n\s+to stdout\\r\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// An operating system other than this one, for marks that must not hold here.
const OTHER = process.platform === "linux" ? "darwin" : "linux";

// --handback with the binary of setup(): `back …` goes to the entry under
// $DEMO_ROOT, everything else is answered.
const HANDS_BACK = `
  if (cmd === "back") {
    const { spawnSync } = require("child_process");
    const r = spawnSync(process.execPath, [require("path").join(process.env.DEMO_ROOT, "dist/cli.js"), ...rest], { stdio: "inherit" });
    process.exit(r.status);
  }
`;
function handbackRun(dir, cases, extra = []) {
  fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({ cases }));
  return spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--rs", `${RUNTIME} rs.cjs`, "--handback", "DEMO_ROOT=dist/cli.js", ...extra], { cwd: dir, encoding: "utf8" });
}

test('"handback" keyed by operating system holds on the systems it names, and only there', () => {
  const dir = setup(HANDS_BACK);
  try {
    const good = handbackRun(dir, [
      { name: "answered here, handed back elsewhere", args: ["echo", "x"], handback: { [OTHER]: "not ported there" } },
      { name: "handed back here", args: ["back", "y"], handback: { [process.platform]: "not ported here", [OTHER]: "nor there" } },
      { name: "handed back everywhere", args: ["back", "z"], handback: "not ported" },
    ]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.equal(good.stdout, "1 case(s) answered by the binary, 2 handed back to the JavaScript, as the cases say\n");

    const wrong = handbackRun(dir, [
      { name: "handed back where it should not be", args: ["back", "x"], handback: { [OTHER]: "not ported there" } },
      { name: "answered where it should be handed back", args: ["echo", "y"], handback: { [process.platform]: "not ported here" } },
      { name: "an empty mark is no mark", args: ["back", "x"], handback: {} },
    ]);
    assert.equal(wrong.status, 1);
    assert.equal(
      wrong.stdout,
      `  WRONG   handed back where it should not be\n      reached the JavaScript on ${process.platform}, but the case says "handback" only on ${OTHER}\n` +
        `  WRONG   answered where it should be handed back\n      was answered by the binary, but the case says it is handed back (on ${process.platform}: not ported here)\n` +
        `  WRONG   an empty mark is no mark\n      reached the JavaScript, but the case does not say "handback"\n` +
        "3 of 3 case(s) went the wrong way\n",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('"skip" keeps a case from running on the systems it names, and the end of the run says how many and why', () => {
  // A skipped case would differ, or be broken, if it ran.
  const dir = setup(`
    if (cmd === "differs") console.log("only in Rust");
  ` + HANDS_BACK);
  try {
    const cases = [
      { name: "runs", args: ["echo", "x"] },
      { name: "skipped here", args: ["differs"], skip: { [process.platform]: "means something else here" } },
      { name: "skipped here too", args: ["back", "x"], setup: ["exit 7"], skip: { [process.platform]: "means something else here" } },
      { name: "skipped for another reason", args: ["differs"], skip: { [process.platform]: "needs a POSIX file mode", [OTHER]: "not there either" } },
      { name: "skipped elsewhere only, so it runs", args: ["echo", "y"], skip: { [OTHER]: "not there" } },
    ];
    const report = `3 case(s) skipped on ${process.platform}, as the cases say:\n     2  means something else here\n     1  needs a POSIX file mode\n`;
    const r = run(dir, { cases });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(
      r.stdout,
      "  same    runs\n  skip    skipped here\n  skip    skipped here too\n  skip    skipped for another reason\n  same    skipped elsewhere only, so it runs\n" +
        report +
        "all 2 case(s) behave the same\n",
    );
    // --handback: a skipped case is not checked either, and the end says so too.
    const checked = handbackRun(dir, cases);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.equal(checked.stdout, `2 case(s) answered by the binary, 0 handed back to the JavaScript, as the cases say\n${report}`);
    // A run in which every case was skipped ran nothing.
    const none = `2 case(s) skipped on ${process.platform}, as the cases say:\n     2  means something else here\nno case ran\n`;
    const all = run(dir, { cases }, ["--filter", "skipped here"]);
    assert.equal(all.status, 2, all.stdout + all.stderr);
    assert.equal(all.stdout, `  skip    skipped here\n  skip    skipped here too\n${none}`);
    const allChecked = handbackRun(dir, cases, ["--filter", "skipped here"]);
    assert.equal(allChecked.status, 2, allChecked.stdout + allChecked.stderr);
    assert.equal(allChecked.stdout, none);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a mistake in "handback" or "skip" stops the run before any case, with exit code 2', () => {
  const dir = setup();
  try {
    const bad = (testCase) => {
      const r = run(dir, { cases: [{ name: "a", args: ["echo"], ...testCase }] });
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      return r.stderr;
    };
    const shape = '"skip" takes an object keyed by operating system, as node names it, with the reason as text: { "win32": "why" }';
    assert.equal(bad({ skip: "everywhere" }), `parity: case "a": ${shape}; it has "everywhere"\n`);
    assert.equal(bad({ skip: ["win32"] }), `parity: case "a": ${shape}; it has ["win32"]\n`);
    assert.match(bad({ handback: ["win32"] }), /^parity: case "a": "handback" takes an object keyed by operating system/);
    assert.match(bad({ skip: { windows: "no POSIX file mode" } }), /^parity: case "a": "skip" names "windows", which is not an operating system as process\.platform names it \(linux, darwin, win32, …\)\n$/);
    assert.match(bad({ handback: { "darwin-arm64": "x" } }), /^parity: case "a": "handback" names "darwin-arm64": the runner tells operating systems apart, not architectures; say "darwin"\n$/);
    assert.equal(bad({ skip: { [process.platform]: "" } }), `parity: case "a": "skip" needs a reason for ${process.platform}, as text\n`);
    assert.equal(bad({ handback: { [OTHER]: true } }), `parity: case "a": "handback" needs a reason for ${OTHER}, as text\n`);
    // A case that --filter leaves out is not looked at.
    const r = run(dir, { cases: [{ name: "good", args: ["echo", "x"] }, { name: "bad", args: ["echo"], skip: "nowhere" }] }, ["--filter", "good"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// How a POSIX shell's pwd, ~ and $HOME spell a directory of the run: on
// Windows as MSYS does, /c/Users/… or /tmp/…, which clean() tags. And how
// JSON spells one: on Windows with doubled backslashes, tagged too.
const MSYS = isWindows ? ":msys" : "";
const IN_JSON = isWindows ? ":json" : "";

test("setup and after lines reach the shell as written, and the run's directories come back as placeholders", () => {
  const dir = setup();
  try {
    const r = run(dir, {
      cases: [
        // Git Bash reads its command line by rules of its own, which make one backslash of two.
        { name: "backslashes", args: ["echo", "x"], setup: [String.raw`printf '%s\n' 'a\\b' "c\\d" > lines.txt`], after: ["cat lines.txt"] },
        { name: "where the lines run", args: ["json"], after: ["pwd", "cd .. && pwd", 'echo "$HOME"', "echo '<CWD>' '<ROOT>' '<HOME>'"] },
        // Unquoted, a placeholder reaches the program only in a spelling the
        // shell leaves alone: on Windows a backslash would be an escape.
        // (echo puts the words of a path with spaces back together.)
        { name: "placeholders without quotes", args: ["echo", "x"], setup: ["echo <ROOT> > where.txt"], after: ["cat where.txt", "echo <CWD> <HOME> <REPO>"] },
        { name: "the line is not in the environment", args: ["echo", "x"], after: ["env | grep -c RUSTIFY_PARITY_LINE"] },
      ],
    }, ["--show"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(shown(r.stdout, "backslashes").includes(String.raw`after: cat lines.txt:
        a\\b
        c\d
        [exit 0]`), r.stdout);
    const where = shown(r.stdout, "where the lines run");
    assert.ok(where.includes(`stdout:\n        {"cwd":"<CWD${IN_JSON}>","home":"<HOME${IN_JSON}>"}\n`), where);
    assert.match(where, new RegExp(`after: pwd:\\n\\s+<CWD${MSYS}>\\n\\s+\\[exit 0\\]\\n`));
    assert.match(where, new RegExp(`after: cd \\.\\. && pwd:\\n\\s+<ROOT${MSYS}>\\n\\s+\\[exit 0\\]\\n`));
    assert.match(where, new RegExp(`after: echo "\\$HOME":\\n\\s+<HOME${MSYS}>\\n\\s+\\[exit 0\\]\\n`));
    assert.match(where, /after: echo '<CWD>' '<ROOT>' '<HOME>':\n\s+<CWD> <ROOT> <HOME>\n\s+\[exit 0\]$/);
    const bare = shown(r.stdout, "placeholders without quotes");
    assert.match(bare, /after: cat where\.txt:\n\s+<ROOT>\n\s+\[exit 0\]\n/);
    assert.match(bare, /after: echo <CWD> <HOME> <REPO>:\n\s+<CWD> <HOME> <REPO>\n\s+\[exit 0\]$/);
    assert.match(shown(r.stdout, "the line is not in the environment"), /after: env \| grep -c RUSTIFY_PARITY_LINE:\n\s+0\n\s+\[exit 1\]$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--shell, or RUSTIFY_PARITY_SHELL, names the shell for setup and after lines", { skip: isWindows && "the shell here is a shell script, which Windows does not start" }, () => {
  const dir = setup();
  try {
    const shell = path.join(dir, "my shell");
    fs.writeFileSync(shell, '#!/bin/sh\necho "through my shell: $1"\nexec /bin/sh "$@"\n', { mode: 0o755 });
    const cases = { cases: [{ name: "a line", args: ["echo", "x"], setup: ["true"], after: ["echo hi"] }] };
    const through = /after: echo hi:\n\s+through my shell: -c\n\s+hi\n\s+\[exit 0\]\n/;
    const named = run(dir, cases, ["--show", "--shell", shell]);
    assert.equal(named.status, 0, named.stdout + named.stderr);
    assert.match(named.stdout, through);
    const fromEnv = run(dir, cases, ["--show"], { ...process.env, RUSTIFY_PARITY_SHELL: shell });
    assert.match(fromEnv.stdout, through);
    // --shell comes first.
    const both = run(dir, cases, ["--show", "--shell=/bin/sh"], { ...process.env, RUSTIFY_PARITY_SHELL: shell });
    assert.equal(both.status, 0, both.stdout + both.stderr);
    assert.doesNotMatch(both.stdout, /through my shell/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a --shell that names no file, or WSL, stops the run before any case, with exit code 2", () => {
  const dir = setup();
  try {
    const cases = { cases: [{ name: "a line", args: ["echo", "x"], after: ["echo hi"] }] };
    const bad = (extra, env = process.env) => {
      const r = run(dir, cases, extra, env);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      return r.stderr;
    };
    assert.match(bad(["--shell", "no/such/shell"]), /^parity: --shell: there is no file no\/such\/shell; it takes the path of a POSIX shell, such as /);
    assert.match(bad(["--shell"]), /^parity: --shell needs the path of a POSIX shell/);
    assert.match(bad([], { ...process.env, RUSTIFY_PARITY_SHELL: "no/such/shell" }), /^parity: RUSTIFY_PARITY_SHELL: there is no file no\/such\/shell; /);
    const wsl = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "bash.exe");
    if (isWindows && fs.existsSync(wsl)) assert.match(bad(["--shell", wsl]), /^parity: --shell: .*bash\.exe starts WSL, which runs the lines in another operating system/i);

    // The variable may be set for a whole machine: a run in which no case
    // that runs has lines does not look at it. --shell is checked all the same.
    const noLines = {
      cases: [
        { name: "no lines", args: ["echo", "x"] },
        { name: "lines, skipped here", args: ["echo", "y"], after: ["echo hi"], skip: { [process.platform]: "not here" } },
      ],
    };
    const lineless = run(dir, noLines, [], { ...process.env, RUSTIFY_PARITY_SHELL: "no/such/shell" });
    assert.equal(lineless.status, 0, lineless.stdout + lineless.stderr);
    assert.match(lineless.stdout, /all 1 case\(s\) behave the same/);
    const flagged = run(dir, noLines, ["--shell", "no/such/shell"]);
    assert.equal(flagged.status, 2, flagged.stdout + flagged.stderr);
    assert.match(flagged.stderr, /^parity: --shell: there is no file no\/such\/shell; /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a shell that cannot be started makes a case with setup or after lines broken, in one line", () => {
  const dir = setup();
  try {
    // A file that is no program: not executable here, not an executable on Windows.
    const shell = path.join(dir, isWindows ? "not-a-shell.exe" : "not-a-shell");
    fs.writeFileSync(shell, "echo this is text\n", { mode: 0o644 });
    const r = run(dir, {
      cases: [
        { name: "setup", args: ["echo", "x"], setup: ["true"] },
        // Without setup lines, the after lines would otherwise compare the same nothing on both sides.
        { name: "after only", args: ["echo", "x"], after: ["echo hi"] },
        { name: "no lines", args: ["echo", "x"] },
      ],
    }, ["--shell", shell]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    // The reason is the runtime's own (node: spawnSync <path> EACCES; bun: EACCES: permission denied, posix_spawn '<path>').
    assert.match(r.stdout, /^ {2}BROKEN {2}setup\n {6}setup `true` could not be run: .*\S\n {2}BROKEN {2}after only\n {6}after `echo hi` could not be run: .*\S\n {2}same {4}no lines\n2 of 3 case\(s\) differ\n$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--ts and --rs take a word in double quotes, and a quote that is not closed is a mistake", () => {
  const dir = setup();
  try {
    fs.mkdirSync(path.join(dir, "a b"));
    fs.copyFileSync(path.join(dir, "rs.cjs"), path.join(dir, "a b", "rs.cjs"));
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({ cases: [{ name: "one", args: ["echo", "x"] }] }));
    const runner = (ts, rs) => spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--ts", ts, "--rs", rs], { cwd: dir, encoding: "utf8" });
    const quoted = runner(`"${process.execPath}" ts.cjs`, `"${process.execPath}" "a b/rs.cjs"`);
    assert.equal(quoted.status, 0, quoted.stdout + quoted.stderr);
    assert.match(quoted.stdout, /all 1 case\(s\) behave the same/);
    const open = runner(`${RUNTIME} ts.cjs`, `"${process.execPath} rs.cjs`);
    assert.equal(open.status, 2, open.stdout + open.stderr);
    assert.match(open.stderr, /^parity: --rs has a double quote that is not closed: /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Arguments that a program of the MSYS family on Windows would rewrite: globs
// that match files of the case, a home, braces, a file to read for @name,
// POSIX paths; and spaces, quotes and backslashes, which MSYS reads by rules
// of its own.
const AS_WRITTEN_ARGS = ["args", ".env.*", "*", "~", "{a,b}", "@plain", "/", "x=/tmp/y", "/owner/repo", "two words", 'a"b', "", "c\\d", "e\\\\f", "x y\\", "'g h'"];
const AS_WRITTEN_FILES = { ".env.a": "", ".env.b": "", plain: "" };
const AS_WRITTEN_SHOWN = JSON.stringify(AS_WRITTEN_ARGS.slice(1));

test("a leading env in --ts or --rs sets variables for the program only, and the case's arguments reach it as written", () => {
  // On Windows the runner does this env itself; MSYS's env.exe would add a TERM and rewrite the arguments.
  const dir = setup();
  try {
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({
      cases: [
        { name: "variables", args: ["vars", "GREETING", "TERM", "HOME"], after: ['echo "${GREETING-not in the lines}"'] },
        { name: "arguments", args: AS_WRITTEN_ARGS, files: AS_WRITTEN_FILES },
      ],
    }));
    const r = spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--ts", `env GREETING=hi ${RUNTIME} ts.cjs`, "--rs", `env GREETING=hi ${RUNTIME} rs.cjs`, "--show"], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(shown(r.stdout, "variables"), /stdout:\n\s+GREETING=hi TERM=undefined HOME=<HOME>\n[^]*not in the lines\n/);
    assert.ok(shown(r.stdout, "arguments").includes(`stdout:\n        ${AS_WRITTEN_SHOWN}\n`), r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows: an MSYS program in front of the program passes the case's arguments on as written; the lines keep MSYS's path conversion", { skip: !isWindows && "this is about Windows" }, () => {
  const dir = setup();
  try {
    // A wrapper script run by Git's sh, as `sh rs/parity/run.sh …` is.
    const sh = path.resolve(spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim(), "..", "..", "..", "usr", "bin", "sh.exe");
    fs.writeFileSync(path.join(dir, "launch.sh"), 'exec "$@"\n');
    const variables = ["vars", "MSYS", "MSYS2_ARG_CONV_EXCL", "MSYS_NO_PATHCONV"];
    const inLines = 'echo "${MSYS-none} ${MSYS2_ARG_CONV_EXCL-none} ${MSYS_NO_PATHCONV-none}"';
    const none = { MSYS2_ARG_CONV_EXCL: null, MSYS_NO_PATHCONV: null };
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({
      cases: [
        { name: "arguments", args: AS_WRITTEN_ARGS, files: AS_WRITTEN_FILES },
        // The line hands node a POSIX path, which MSYS turns into a Windows one.
        { name: "variables", args: variables, env: { PARITY_NODE: process.execPath }, after: [inLines, '"$PARITY_NODE" -p "process.argv[1]" /usr/x'] },
        // Taken out by the case: then the wrapper rewrites what the Rust side gets.
        { name: "without them", args: ["args", "/"], env: none, after: [inLines] },
      ],
    }));
    const r = spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--ts", `${RUNTIME} ts.cjs`, "--rs", `"${sh}" launch.sh ${RUNTIME} rs.cjs`, "--show"], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(shown(r.stdout, "arguments").includes(`stdout:\n        ${AS_WRITTEN_SHOWN}\n`), r.stdout);
    const vars = shown(r.stdout, "variables");
    assert.match(vars, /stdout:\n\s+MSYS=undefined MSYS2_ARG_CONV_EXCL=\* MSYS_NO_PATHCONV=1\n/);
    assert.match(vars, /:\n\s+none none none\n\s+\[exit 0\]\n/);
    assert.match(vars, /process\.argv\[1\]" \/usr\/x:\n\s+[A-Za-z]:\/.*\/usr\/x\n\s+\[exit 0\]/);
    assert.match(r.stdout, /DIFFER {2}without them {2}\(stdout\)\n\s+stdout\n\s+TypeScript:\n\s+\["\/"\]\n\s+\n\s+Rust:\n\s+\["[A-Za-z]:\/[^"]*\/"\]\n/);
    assert.match(r.stdout, /1 of 3 case\(s\) differ/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows: lines run in Git for Windows' bash, before Windows' own find and sort", { skip: !isWindows && "this is about Windows" }, () => {
  const dir = setup();
  try {
    const cases = { cases: [{ name: "the shell", args: ["echo", "x"], after: ["echo ${BASH_VERSION%%.*}", "command -v find sort stat", "uname -o"] }] };
    // PATH as it is here; and with System32 ahead of Git's usr\bin, as a PATH set for the whole machine can have it.
    const usrBin = path.resolve(spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim(), "..", "..", "..", "usr", "bin");
    const behind = `${path.join(process.env.SystemRoot, "System32")};${usrBin};${process.env.PATH}`;
    // Without the variable's other spelling (Path), which would be a second PATH.
    const systemFirst = Object.fromEntries([...Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"), ["PATH", behind]]);
    for (const env of [process.env, systemFirst]) {
      const r = run(dir, cases, ["--show"], env);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const the = shown(r.stdout, "the shell");
      assert.match(the, /after: echo \$\{BASH_VERSION%%\.\*\}:\n\s+\d+\n/);
      assert.match(the, /after: command -v find sort stat:\n\s+\/usr\/bin\/find\n\s+\/usr\/bin\/sort\n\s+\/usr\/bin\/stat\n/);
      assert.match(the, /after: uname -o:\n\s+Msys\n/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The 8.3 spelling of a directory on Windows, as cmd gives it.
function shortOf(dir) {
  const cmd = path.join(process.env.SystemRoot, "System32", "cmd.exe");
  return spawnSync(cmd, ["/d", "/c", `for %I in ("${dir}") do @echo %~sI`], { encoding: "utf8", windowsVerbatimArguments: true }).stdout.trim();
}

// A temp directory in its 8.3 spelling, as GitHub's runners give it
// (C:\Users\RUNNER~1\…), and the tag of that spelling: none where the volume
// makes no short names.
function shortTemp(dir) {
  const long = path.join(dir, "a long temp directory");
  fs.mkdirSync(long);
  const short = shortOf(long);
  return { short, tag: short.toLowerCase() === long.toLowerCase() ? "" : ":8.3" };
}

test("Windows: every spelling of a directory comes back as its placeholder, tagged with the spelling, the 8.3 one too", { skip: !isWindows && "this is about Windows" }, () => {
  const dir = setup();
  try {
    const { short, tag } = shortTemp(dir);
    const env = { ...process.env, TEMP: short, TMP: short };
    const r = run(dir, { cases: [{ name: "spellings", args: ["spellings"], after: ["pwd", "cygpath -aw .", "cygpath -am .", "cygpath -ad ."] }, { name: "where", args: ["where"] }] }, ["--show"], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const spellings = shown(r.stdout, "spellings");
    // As node gives it, with forward slashes, a lower-case drive letter, as MSYS prints it, as JSON writes it, and in 8.3.
    assert.ok(spellings.includes(`stdout:\n        <CWD>\n        <CWD>\n        <CWD:case>\n        <CWD:msys>\n        "<CWD:json>"\n        <CWD${tag}>\n`), spellings);
    for (const [line, name] of [["pwd", "<CWD:msys>"], ["cygpath -aw .", "<CWD>"], ["cygpath -am .", "<CWD>"], ["cygpath -ad .", `<CWD${tag}>`]]) {
      assert.ok(spellings.includes(`after: ${line}:\n        ${name}\n`), `${line}: ${spellings}`);
    }
    assert.match(shown(r.stdout, "where"), /cwd=<CWD> home=<HOME>\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows: two programs that print a directory in different spellings differ", { skip: !isWindows && "this is about Windows" }, () => {
  // Stands for a port that prints the directory with {:?}, in lower case, as
  // MSYS does, or in 8.3, where its TypeScript prints it as Windows gives it.
  const dir = setup(`
    if (cmd === "spelt") {
      const cwd = process.cwd();
      const short = require("child_process").spawnSync(require("path").join(process.env.SystemRoot, "System32", "cmd.exe"), ["/d", "/c", "for %I in (.) do @echo %~sI"], { encoding: "utf8", windowsVerbatimArguments: true }).stdout.trim();
      const spelt = { json: JSON.stringify(cwd), lower: cwd.toLowerCase(), msys: "/" + cwd[0].toLowerCase() + cwd.slice(2).replace(/\\\\/g, "/"), short, slashed: cwd.replace(/\\\\/g, "/") };
      console.log(spelt[rest[0]]);
      process.exit(0);
    }
  `);
  fs.appendFileSync(path.join(dir, "ts.cjs"), `if (cmd === "spelt") console.log(rest[0] === "json" ? '"' + process.cwd() + '"' : process.cwd());\n`);
  try {
    const { short, tag } = shortTemp(dir);
    const r = run(dir, { cases: ["json", "lower", "msys", "short", "slashed"].map((spelling) => ({ name: spelling, args: ["spelt", spelling] })) }, [], { ...process.env, TEMP: short, TMP: short });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /DIFFER {2}json {2}\(stdout\)\n\s+stdout\n\s+TypeScript:\n\s+"<CWD>"\n\s+\n\s+Rust:\n\s+"<CWD:json>"\n/);
    assert.match(r.stdout, /DIFFER {2}lower {2}\(stdout\)\n[^]*Rust:\n\s+<CWD:case>\n/);
    assert.match(r.stdout, /DIFFER {2}msys {2}\(stdout\)\n[^]*Rust:\n\s+<CWD:msys>\n/);
    // Where the volume makes no short names, the short spelling is the long one.
    if (tag) assert.match(r.stdout, /DIFFER {2}short {2}\(stdout\)\n[^]*Rust:\n\s+<CWD:8\.3>\n/);
    // As the runner always had it: forward slashes are the same directory.
    assert.match(r.stdout, /\n {2}same {4}slashed\n/);
    assert.match(r.stdout, new RegExp(`${tag ? 4 : 3} of 5 case\\(s\\) differ`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows: started from Git Bash, as the pipeline starts it, the run's directories under /tmp come back as placeholders", { skip: !isWindows && "this is about Windows" }, () => {
  const dir = setup();
  try {
    // The shell that runs the lines shares the mounts of the Git Bash below,
    // whose /tmp is that Git Bash's temp directory: this test's directory, or
    // the temp directory of a Git Bash the tests were started from. The
    // runner's own temp directory is another, below it and in 8.3, so only
    // the shell can say where its /tmp is.
    const gitBash = path.resolve(spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim(), "..", "..", "..", "bin", "bash.exe");
    const { short } = shortTemp(dir);
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({ cases: [{ name: "where the lines run", args: ["json"], after: ["pwd", "pwd -W", "cd .. && pwd", 'echo "$HOME"'] }] }));
    // The values go in variables: on its command line Git Bash would read their backslashes by its own rules.
    const env = { ...process.env, TEMP: dir, TMP: dir, PARITY_TEMP: short, PARITY_NODE: process.execPath, PARITY_RUNNER: RUNNER, PARITY_TS: `${RUNTIME} ts.cjs`, PARITY_RS: `${RUNTIME} rs.cjs` };
    const r = spawnSync(
      gitBash,
      ["--noprofile", "--norc", "-c", 'cd /tmp && echo "/tmp is $(pwd -W)" && cd - > /dev/null && TEMP="$PARITY_TEMP" TMP="$PARITY_TEMP" "$PARITY_NODE" "$PARITY_RUNNER" --cases parity.json --ts "$PARITY_TS" --rs "$PARITY_RS" --show'],
      { cwd: dir, env, encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const where = shown(r.stdout, "where the lines run");
    assert.match(where, /stdout:\n\s+\{"cwd":"<CWD:json>","home":"<HOME:json>"\}\n/);
    assert.match(where, /after: pwd:\n\s+<CWD:msys>\n/);
    assert.match(where, /after: pwd -W:\n\s+<CWD>\n/);
    assert.match(where, /after: cd \.\. && pwd:\n\s+<ROOT:msys>\n/);
    assert.match(where, /after: echo "\$HOME":\n\s+<HOME:msys>\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows: a program named without .exe starts, also behind env", { skip: !isWindows && "this is about Windows" }, () => {
  const dir = setup();
  try {
    fs.mkdirSync(path.join(dir, "bin"));
    fs.copyFileSync(process.execPath, path.join(dir, "bin", "runtime.exe"));
    fs.writeFileSync(path.join(dir, "parity.json"), JSON.stringify({ cases: [{ name: "one", args: ["echo", "x"] }] }));
    const r = spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--ts", "bin/runtime ts.cjs", "--rs", "env GREETING=hi bin/runtime rs.cjs"], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /all 1 case\(s\) behave the same/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows: without a POSIX shell a case with setup or after lines is broken, in one line", { skip: !isWindows && "this is about Windows" }, () => {
  const dir = setup();
  try {
    // Nowhere to find Git: no git on PATH, and the usual places empty.
    const empty = path.join(dir, "empty");
    fs.mkdirSync(empty);
    const env = { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PATH: empty, ProgramFiles: empty, ProgramW6432: empty, "ProgramFiles(x86)": empty, LOCALAPPDATA: empty };
    const r = run(dir, { cases: [{ name: "has lines", args: ["echo", "x"], after: ["echo hi"] }, { name: "has none", args: ["echo", "y"] }] }, [], env);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(
      r.stdout,
      '  BROKEN  has lines\n      this case has "setup" or "after" lines, which a POSIX shell runs, and none was found: no bash of Git for Windows where `git --exec-path` points ' +
        "or in %ProgramFiles%\\Git; install Git for Windows, or name a shell with --shell <path> or RUSTIFY_PARITY_SHELL\n  same    has none\n1 of 2 case(s) differ\n",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
