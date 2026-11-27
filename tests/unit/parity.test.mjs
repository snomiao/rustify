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
    return spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--rs", `${process.execPath} rs.cjs`, "--handback", "DEMO_ROOT=dist/cli.js", ...extra], { cwd: dir, encoding: "utf8" });
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
    const missing = spawnSync(process.execPath, [RUNNER, "--cases", "parity.json", "--ts", "no-such-program-anywhere", "--rs", `${process.execPath} rs.cjs`], { cwd: dir, encoding: "utf8" });
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
    assert.match(hangs.stdout, /BROKEN {2}waits for ever\n\s+\S+ had not ended after 2 s on a terminal, which last showed: still here \n/);
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
