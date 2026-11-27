//! rustify JS fallback v5 — copy into the crate as `src/js_fallback.rs`.
//! (v2: waits for the JavaScript on Ctrl+C on Windows. v3: starts the
//! JavaScript with the runtime its own `#!` line names, and offers a
//! TypeScript entry to bun only. v4: says so when bun is what is missing.
//! v5: says on stderr that it handed back when `RUSTIFY_HANDBACK_TRACE` is
//! set; `attempt` runs a ported command so that it can decline, and so that a
//! bug in it costs the user nothing.)
//!
//! For the time when the Rust binary is already the command users run but some
//! commands still exist only in the package's JavaScript. The binary handles
//! what it has ported and hands everything else to the old entry point:
//!
//! ```ignore
//! match command {
//!     "send" | "search" => run_natively(),
//!     _ => js_fallback::run("dist/cli.js"), // never returns
//! }
//! ```
//!
//! Ported commands start at native speed; the others behave exactly as before.
//!
//! A ported command seldom implements every invocation. `attempt` is for the
//! usual shape: the command works out its whole answer before it prints or
//! changes anything, and says `Err(HandBack)` for a command line or a state of
//! the machine it does not implement:
//!
//! ```ignore
//! "status" => {
//!     if let Some(text) = js_fallback::attempt(|| status::answer(&args[1..])) {
//!         print!("{text}");
//!         return;
//!     }
//!     js_fallback::run("dist/cli.js")
//! }
//! ```
//!
//! Delete this file when nothing falls back any more.

use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

/// Environment variable the npm launcher sets to the package directory when
/// the binary runs from the platform package. Use the same name as
/// `rustify.rootEnv` in package.json, and make it specific to the project
/// (`MYCLI_PACKAGE_ROOT`) so one tool starting another does not inherit it.
pub const ROOT_ENV: &str = "RUSTIFY_PACKAGE_ROOT";

/// Set this variable to any value that is not empty and `run` writes
/// `TRACE_LINE` to stderr before it starts the JavaScript. That shows who
/// answered a command where no parity test runs: rustify's install smoke test
/// sets it for a line marked `[native]` or `[handback]`, and it finds out
/// whether a binary is able to say the line by looking for the text in the
/// file. So the name and the line are the same in every project: do not
/// change them. Whatever the command starts inherits the variable.
pub const TRACE_ENV: &str = "RUSTIFY_HANDBACK_TRACE";
pub const TRACE_LINE: &str = "rustify: handed back to the JavaScript";

fn tracing() -> bool {
    std::env::var_os(TRACE_ENV).is_some_and(|value| !value.is_empty())
}

/// Directory of the npm package this binary was installed with, if any.
pub fn package_root() -> Option<PathBuf> {
    // Installed and linked: the binary is <package>/rustify/<command>, and the
    // packer puts a package.json marker next to it.
    if let Ok(exe) = std::env::current_exe() {
        // macOS reports the path the command was started through, and for an
        // npm install that is a symlink in the package manager's bin directory.
        #[cfg(unix)]
        let exe = std::fs::canonicalize(&exe).unwrap_or(exe);
        if let Some(bin) = exe.parent() {
            if bin.join("package.json").is_file() {
                if let Some(root) = bin.parent() {
                    if root.join("package.json").is_file() {
                        return Some(root.to_path_buf());
                    }
                }
            }
        }
    }
    // Running from the platform package: the launcher told us.
    let root = PathBuf::from(std::env::var_os(ROOT_ENV)?);
    root.join("package.json").is_file().then_some(root)
}

/// Runs the package's JavaScript entry with this process's arguments and ends
/// the process with its exit code. `entry` is relative to the package root.
pub fn run(entry: &str) -> ! {
    if tracing() {
        // A closed stderr must not stop the hand-back.
        let _ = writeln!(std::io::stderr(), "{TRACE_LINE}");
    }
    let Some(root) = package_root() else {
        eprintln!(
            "this command is not available in the standalone binary yet; \
             install the npm package to use it"
        );
        std::process::exit(1);
    };
    let script = root.join(entry);
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    let candidates = runtimes(&script);
    let mut last_error = None;
    for runtime in &candidates {
        let mut command = program(&runtime[0]);
        command.args(&runtime[1..]).arg(&script).args(&args);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Replaces this process, so signals and the exit code need no relaying.
            last_error = Some(command.exec());
        }
        #[cfg(not(unix))]
        {
            #[cfg(windows)]
            stay_alive_on_ctrl_c();
            match command.status() {
                Ok(status) => std::process::exit(status.code().unwrap_or(1)),
                Err(err) => last_error = Some(err),
            }
        }
    }
    let tried: Vec<&str> = candidates.iter().map(|c| c[0].as_str()).collect();
    let reason = last_error.map(|e| e.to_string()).unwrap_or_default();
    if tried == ["bun"] {
        // A TypeScript entry: node is not offered, it cannot be relied on to run it.
        eprintln!("cannot run {}: it needs bun, which could not be started ({reason}). See https://bun.sh", script.display());
    } else {
        eprintln!("cannot run {}: none of {} could be started ({reason})", script.display(), tried.join(", "));
    }
    std::process::exit(127);
}

/// What a ported command returns for an invocation, or a state of the
/// machine, that it does not implement exactly: the JavaScript has to answer.
#[allow(dead_code)] // unused until the first command is ported
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandBack;

/// Set by `commit`.
static COMMITTED: AtomicBool = AtomicBool::new(false);

/// Says that the command is about to print or change something, so the
/// invocation can no longer be handed back. Only a command that prints or
/// writes inside `attempt` needs this (one that reports progress while it
/// works, say); a command that returns its whole answer does not.
#[allow(dead_code)]
pub fn commit() {
    COMMITTED.store(true, Ordering::Relaxed);
}

/// Runs a ported command up to its answer. `Some(answer)` is for the caller
/// to print and carry out. `None` means the invocation goes to the
/// JavaScript (call `run` next): the command declined with `Err(HandBack)`,
/// or it panicked.
///
/// A panic is a bug in the port. As long as the command has printed and
/// changed nothing, the JavaScript can still answer in its place, so the
/// panic is swallowed without a word and the user gets what they asked for.
/// With `TRACE_ENV` set, the panic is reported as usual before the hand-back
/// line, which is how to find such a bug.
///
/// After `commit` there is no way back. A panic is then reported and ends the
/// process as any panic does (exit code 101), and returning `Err(HandBack)`
/// is itself a bug and panics.
///
/// This relies on unwinding. A crate built with `panic = "abort"` cannot
/// catch anything: there a panic ends the process at once, with its usual
/// message. The Cargo.toml that `rustify scaffold` writes leaves the default,
/// which unwinds.
#[allow(dead_code)]
pub fn attempt<T>(command: impl FnOnce() -> Result<T, HandBack>) -> Option<T> {
    use std::panic;
    let committed = || COMMITTED.load(Ordering::Relaxed);
    let outcome = if cfg!(panic = "unwind") {
        // The hook is what prints "thread 'main' panicked at …". Keep it quiet
        // while the invocation can still be handed back, on every thread the
        // command starts, and put the previous hook back afterwards.
        let previous = std::sync::Arc::new(panic::take_hook());
        let report = std::sync::Arc::clone(&previous);
        panic::set_hook(Box::new(move |info| {
            if committed() || tracing() {
                report(info);
            }
        }));
        let outcome = panic::catch_unwind(panic::AssertUnwindSafe(command));
        drop(panic::take_hook());
        panic::set_hook(match std::sync::Arc::try_unwrap(previous) {
            Ok(hook) => hook,
            Err(shared) => Box::new(move |info| shared(info)),
        });
        outcome
    } else {
        Ok(command())
    };
    match outcome {
        Ok(Ok(answer)) => Some(answer),
        Ok(Err(HandBack)) if committed() => panic!("a ported command handed back after js_fallback::commit()"),
        Err(payload) if committed() => panic::resume_unwind(payload),
        Ok(Err(HandBack)) | Err(_) => None,
    }
}

/// The commands to try for running `script`, in order. First what the
/// script's own `#!` line names, because that is what ran it before this
/// binary existed; then bun and node, whichever is installed.
fn runtimes(script: &std::path::Path) -> Vec<Vec<String>> {
    let head = std::fs::read(script).unwrap_or_default();
    let first_line = String::from_utf8_lossy(&head[..head.len().min(512)]).lines().next().unwrap_or("").to_string();
    let is_typescript = matches!(
        script.extension().and_then(|e| e.to_str()),
        Some("ts" | "mts" | "cts" | "tsx")
    );
    let mut list: Vec<Vec<String>> = interpreter(&first_line).into_iter().collect();
    // node cannot be relied on to run TypeScript, so it is only tried for a
    // TypeScript entry when the entry asks for it.
    let fallbacks: &[&str] = if is_typescript { &["bun"] } else { &["bun", "node"] };
    for name in fallbacks {
        if !list.iter().any(|c| c[0] == *name) {
            list.push(vec![name.to_string()]);
        }
    }
    list
}

/// The command a `#!` line asks for, without its directory:
/// `#!/usr/bin/env node` is `["node"]`, `#!/usr/bin/env -S npx tsx` is
/// `["npx", "tsx"]`, and a line that is not a `#!` line is `None`.
fn interpreter(first_line: &str) -> Option<Vec<String>> {
    let mut words = first_line.strip_prefix("#!")?.split_whitespace();
    let name = |path: &str| path.rsplit(['/', '\\']).next().unwrap_or(path).to_string();
    let first = name(words.next()?);
    let command: Vec<String> = if first == "env" {
        // Skip env's own flags (-S) and VAR=value settings.
        words.skip_while(|w| w.starts_with('-') || w.contains('=')).map(String::from).collect()
    } else {
        std::iter::once(first).chain(words.map(String::from)).collect()
    };
    (!command.is_empty()).then_some(command)
}

/// A command for `name`. On Windows, tools installed by a package manager
/// (npx, tsx, …) are `.cmd` files, which have to be started through cmd.
fn program(name: &str) -> Command {
    #[cfg(windows)]
    if !matches!(name, "bun" | "node" | "deno") {
        let mut command = Command::new("cmd");
        command.args(["/C", name]);
        return command;
    }
    Command::new(name)
}

/// Ctrl+C reaches every process attached to the console. Without a handler
/// this process would end at once and hand the prompt back while the
/// JavaScript is still shutting down. With one it waits, and exits with the
/// child's exit code. A handler, unlike the "ignore Ctrl+C" flag, is not
/// inherited, so the child still gets the key press.
#[cfg(windows)]
fn stay_alive_on_ctrl_c() {
    extern "system" {
        fn SetConsoleCtrlHandler(
            handler: Option<unsafe extern "system" fn(u32) -> i32>,
            add: i32,
        ) -> i32;
    }
    unsafe extern "system" fn handled(_event: u32) -> i32 {
        1
    }
    unsafe {
        SetConsoleCtrlHandler(Some(handled), 1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(script: &std::path::Path) -> Vec<String> {
        runtimes(script).into_iter().map(|c| c.join(" ")).collect()
    }

    #[test]
    fn the_shebang_names_the_interpreter() {
        assert_eq!(interpreter("#!/usr/bin/env node"), Some(vec!["node".to_string()]));
        assert_eq!(interpreter("#!/usr/bin/env bun"), Some(vec!["bun".to_string()]));
        assert_eq!(interpreter("#!/usr/local/bin/node --no-warnings").unwrap(), ["node", "--no-warnings"]);
        assert_eq!(interpreter("#!/usr/bin/env -S npx tsx").unwrap(), ["npx", "tsx"]);
        assert_eq!(interpreter("#!/usr/bin/env npx tsx").unwrap(), ["npx", "tsx"]);
        assert_eq!(interpreter("#! /usr/bin/env  FOO=1 node").unwrap(), ["node"]);
        assert_eq!(interpreter("import x from \"y\";"), None);
        assert_eq!(interpreter("#!/usr/bin/env"), None);
        assert_eq!(interpreter(""), None);
    }

    /// One test for all of `attempt`: the panic hook and the commit mark are
    /// shared by the whole process, so the steps have to run in this order.
    #[test]
    fn attempt_answers_declines_and_hands_back_a_panic_until_commit() {
        use std::panic::catch_unwind;
        use std::sync::atomic::AtomicUsize;
        static REPORTED: AtomicUsize = AtomicUsize::new(0);
        let reported = || REPORTED.load(Ordering::Relaxed);
        let before = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {
            REPORTED.fetch_add(1, Ordering::Relaxed);
        }));

        assert_eq!(attempt(|| Ok(7)), Some(7));
        assert_eq!(attempt(|| Err::<i32, _>(HandBack)), None);
        assert_eq!(reported(), 0);
        assert_eq!(attempt(|| -> Result<i32, HandBack> { panic!("a bug in a ported command") }), None);
        // Silent, unless whoever runs the tests has switched the trace on.
        assert_eq!(reported(), usize::from(tracing()), "a panic before commit is not reported");
        let silent = reported();
        assert!(catch_unwind(|| panic!("outside attempt")).is_err());
        assert_eq!(reported(), silent + 1, "the hook that was there before is back");

        commit();
        assert_eq!(attempt(|| Ok(8)), Some(8));
        assert!(catch_unwind(|| attempt(|| -> Result<i32, HandBack> { panic!("a bug after the first output") })).is_err());
        assert_eq!(reported(), silent + 2, "a panic after commit is reported and not swallowed");
        assert!(catch_unwind(|| attempt(|| Err::<i32, _>(HandBack))).is_err(), "handing back after commit is a bug");
        assert_eq!(reported(), silent + 3);
        std::panic::set_hook(before);
    }

    #[test]
    fn the_script_decides_which_runtime_is_tried_first() {
        let dir = std::env::temp_dir().join(format!("rustify-fallback-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = |name: &str, text: &str| {
            let path = dir.join(name);
            std::fs::write(&path, text).unwrap();
            path
        };
        assert_eq!(names(&file("a.js", "#!/usr/bin/env node\nx")), ["node", "bun"]);
        assert_eq!(names(&file("b.js", "#!/usr/bin/env bun\nx")), ["bun", "node"]);
        assert_eq!(names(&file("c.js", "console.log(1)")), ["bun", "node"]);
        assert_eq!(names(&file("d.ts", "#!/usr/bin/env bun\nx")), ["bun"]);
        assert_eq!(names(&file("e.ts", "#!/usr/bin/env npx tsx\nx")), ["npx tsx", "bun"]);
        assert_eq!(names(&file("f.ts", "#!/usr/bin/env node\nx")), ["node", "bun"]);
        assert_eq!(names(&dir.join("missing.js")), ["bun", "node"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
