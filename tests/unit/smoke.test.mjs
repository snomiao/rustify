// Unit tests for templates/npm/smoke-command.mjs: how the install smoke test
// reads an `--also` line, and the home directory it gives a command.
//
// The Windows rules are tested on every system by naming the platform. That a
// real Windows machine agrees is what the smoke runs on Windows runners show.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { TRACE_ENV, TRACE_LINE, homeVariables, parseLine, withEnv, withPath } from "../../templates/npm/smoke-command.mjs";

const KEYS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64", "win32-arm64"];
const parse = (text, host = "linux-x64") => parseLine(text, host, KEYS);

test("a line without markers reads as it always did", () => {
  assert.deepEqual(parse("toy  one two => printed text !> forbidden text"), {
    line: "toy  one two",
    name: "toy",
    args: ["one", "two"],
    code: 0,
    wanted: "printed text",
    unwanted: "forbidden text",
    who: null,
    realHome: false,
  });
  assert.deepEqual(parse("toy"), { line: "toy", name: "toy", args: [], code: 0, wanted: "", unwanted: "", who: null, realHome: false });
  const failing = parse('[7] toyjs exit 7 => args=["exit", "7"]');
  assert.deepEqual([failing.code, failing.line, failing.wanted], [7, "toyjs exit 7", 'args=["exit", "7"]']);
});

test("[native] and [handback] say who has to answer", () => {
  assert.equal(parse("[native] toy status => ok").who, "native");
  assert.equal(parse("[handback] toy --help => usage").who, "handback");
  assert.equal(parse("[native] toy status => ok").line, "toy status");
});

test("markers combine in any order", () => {
  for (const text of ["[2] [native] [real-home] toy bad => usage", "[real-home] [native] [2] toy bad => usage"]) {
    const { code, who, realHome, name, args } = parse(text);
    assert.deepEqual({ code, who, realHome, name, args }, { code: 2, who: "native", realHome: true, name: "toy", args: ["bad"] });
  }
});

test("a demand can be limited to platforms, by system or by whole key", () => {
  const text = "[native:linux,darwin] [handback:win32] toy status => ok";
  assert.equal(parse(text, "linux-arm64").who, "native");
  assert.equal(parse(text, "darwin-x64").who, "native");
  assert.equal(parse(text, "win32-arm64").who, "handback");
  assert.equal(parse("[native:linux] toy status", "darwin-arm64").who, null, "elsewhere the line makes no demand");
  assert.equal(parse("[native:linux-x64] toy status", "linux-x64").who, "native");
  assert.equal(parse("[native:linux-x64] toy status", "linux-arm64").who, null);
});

test("what cannot be meant is an error, not a command", () => {
  assert.throws(() => parse("[natvie] toy status"), /unknown marker \[natvie\]/);
  assert.throws(() => parse("[native:windows] toy status"), /does not name a platform \("windows"\)/);
  assert.throws(() => parse("[native:] toy status"), /does not name a platform/);
  assert.throws(() => parse("[native] [handback] toy status"), /a native answer and for a hand-back on linux-x64/);
  assert.throws(() => parse("[native:linux] [handback:linux-x64] toy status"), /a native answer and for a hand-back/);
  assert.throws(() => parse("[native] => text"), /names no command/);
});

test("the smoke test and the Rust helper agree on the variable and the line", () => {
  const helper = fs.readFileSync(new URL("../../templates/rust/js_fallback.rs", import.meta.url), "utf8");
  assert.match(helper, /^\/\/! rustify JS fallback v(\d+)/);
  assert.ok(Number(helper.match(/^\/\/! rustify JS fallback v(\d+)/)[1]) >= 5);
  assert.ok(helper.includes(`pub const TRACE_ENV: &str = "${TRACE_ENV}";`));
  assert.ok(helper.includes(`pub const TRACE_LINE: &str = "${TRACE_LINE}";`));
});

test("a command's own home directory on Linux and macOS", () => {
  const real = { PATH: "/usr/bin", HOME: "/home/me", XDG_CONFIG_HOME: "/home/me/.config", XDG_DATA_HOME: "/data", XDG_STATE_HOME: "/state", XDG_CACHE_HOME: "/cache", XDG_RUNTIME_DIR: "/run/user/1000", LANG: "C" };
  for (const platform of ["linux", "darwin"]) {
    assert.deepEqual(withEnv(real, homeVariables("/tmp/smoke/home", platform), platform), {
      PATH: "/usr/bin",
      XDG_RUNTIME_DIR: "/run/user/1000",
      LANG: "C",
      HOME: "/tmp/smoke/home",
      USERPROFILE: "/tmp/smoke/home",
    });
  }
});

test("a command's own home directory on Windows", () => {
  const home = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\rustify-smoke-x\\home-bun";
  const real = {
    Path: "C:\\Windows",
    USERPROFILE: "C:\\Users\\me",
    HOMEDRIVE: "C:",
    HOMEPATH: "\\Users\\me",
    APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    TEMP: "C:\\Users\\me\\AppData\\Local\\Temp",
    // Windows ignores case in names; a shell may have set these in another one.
    Home: "C:\\Users\\me",
    xdg_config_home: "C:\\Users\\me\\.config",
  };
  assert.deepEqual(withEnv(real, homeVariables(home, "win32"), "win32"), {
    Path: "C:\\Windows",
    TEMP: "C:\\Users\\me\\AppData\\Local\\Temp",
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: "C:",
    HOMEPATH: "\\Users\\RUNNER~1\\AppData\\Local\\Temp\\rustify-smoke-x\\home-bun",
    APPDATA: `${home}\\AppData\\Roaming`,
    LOCALAPPDATA: `${home}\\AppData\\Local`,
  });
});

test("what the caller sets afterwards wins, on Windows whatever the case", () => {
  const isolated = withEnv({ HOME: "/home/me" }, homeVariables("/tmp/smoke/home", "linux"), "linux");
  assert.deepEqual(withEnv(isolated, { HOME: "/chosen", XDG_CONFIG_HOME: "/chosen/config" }, "linux"), {
    HOME: "/chosen",
    USERPROFILE: "/tmp/smoke/home",
    XDG_CONFIG_HOME: "/chosen/config",
  });
  assert.deepEqual(withEnv({ USERPROFILE: "C:\\throwaway", Path: "C:\\Windows" }, { userprofile: "D:\\chosen" }, "win32"), {
    Path: "C:\\Windows",
    userprofile: "D:\\chosen",
  });
  // Elsewhere names differ by case, and both variables exist.
  assert.deepEqual(withEnv({ HOME: "/a" }, { home: "/b" }, "linux"), { HOME: "/a", home: "/b" });
});

test("a runtime's directory goes first in PATH, under the name PATH already has", () => {
  assert.deepEqual(withPath({ PATH: "/usr/bin:/bin", HOME: "/h" }, ["/opt/bun/bin"], "linux"), { PATH: "/opt/bun/bin:/usr/bin:/bin", HOME: "/h" });
  assert.deepEqual(withPath({ HOME: "/h" }, ["/a", "/b"], "darwin"), { HOME: "/h", PATH: "/a:/b" });
  assert.deepEqual(withPath({ Path: "C:\\Windows" }, ["C:\\node"], "win32"), { Path: "C:\\node;C:\\Windows" });
  // Elsewhere case matters: `Path` is not PATH there.
  assert.deepEqual(withPath({ Path: "x" }, ["/a"], "linux"), { Path: "x", PATH: "/a" });
});
