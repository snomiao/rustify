//! The hand-back of templates/rust/js_fallback.rs, compiled into the toy,
//! against the system it runs on: real scripts, started by the kernel and by
//! `toy js`. toy-argv stands for the JavaScript runtime and prints how it was
//! started. Run with `--nocapture` to see what each system did.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const TOY: &str = env!("CARGO_BIN_EXE_toy");
const ARGV: &str = env!("CARGO_BIN_EXE_toy-argv");
const ROOT_ENV: &str = "RUSTIFY_PACKAGE_ROOT";

/// One test at a time. Linux refuses to start a file (ETXTBSY) that another
/// thread's child, between fork and exec, still holds open for writing, as it
/// does a copy of toy-argv being made.
fn serial() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A directory of this test's own, empty.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("rustify-handback-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    // As the kernel and the binary name it: macOS hands out temp directories
    // behind a link. (On Windows that would be a \\?\ path, which the launcher never gives.)
    if cfg!(unix) {
        std::fs::canonicalize(&dir).unwrap()
    } else {
        dir
    }
}

/// A package at `root` whose JavaScript entry, dist/cli.js, begins with `head`.
fn package(root: &Path, head: &[u8]) -> PathBuf {
    std::fs::create_dir_all(root.join("dist")).unwrap();
    std::fs::write(root.join("package.json"), "{\"name\":\"stand-in\"}\n").unwrap();
    let entry = root.join("dist").join("cli.js");
    std::fs::write(&entry, head).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&entry, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    entry
}

/// A copy of toy-argv at `file`.
fn runtime_at(file: &Path) {
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::copy(ARGV, file).unwrap();
}

/// `program args…` in `cwd` with PATH = `path` and nothing of the trace.
fn start(program: &Path, args: &[&str], cwd: &Path, path: &std::ffi::OsStr, env: &[(&str, &std::ffi::OsStr)]) -> std::io::Result<Output> {
    let mut command = Command::new(program);
    command.args(args).current_dir(cwd).env("PATH", path).env_remove("RUSTIFY_HANDBACK_TRACE").env_remove(ROOT_ENV);
    for (name, value) in env {
        command.env(name, value);
    }
    command.output()
}

fn text(output: &Output) -> String {
    format!(
        "exit {:?}\n--- stdout\n{}--- stderr\n{}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

const ARGS: [&str; 4] = ["js", "one", "two words", ""];

#[cfg(unix)]
mod unix {
    use super::*;

    /// The kernel starting the entry, and `toy js` starting it, side by side:
    /// the same arguments, output and exit code, or the kernel refuses
    /// (ENOEXEC) and the hand-back starts bun.
    fn compare(name: &str, head: &[u8], expect_refused: bool) {
        let dir = scratch(name);
        let root = dir.join("pkg");
        let entry = package(&root, head);
        // What a no-`#!` entry falls back to: a "bun" that prints its arguments.
        runtime_at(&dir.join("bin").join("bun"));
        // For a relative interpreter, which the kernel finds from the working directory.
        let cwd = dir.join("cwd");
        runtime_at(&cwd.join("rel-argv"));
        runtime_at(&cwd.join("sub").join("rel-argv"));
        let path = std::env::join_paths([dir.join("bin"), "/usr/bin".into(), "/bin".into()]).unwrap();
        let kernel = start(&entry, &ARGS, &cwd, &path, &[]);
        let hand_back = start(Path::new(TOY), &ARGS, &cwd, &path, &[(ROOT_ENV, root.as_os_str())]).unwrap();
        println!("== {name}: {:?}\n-- the kernel: {}\n-- toy js: {}", String::from_utf8_lossy(head), kernel.as_ref().map(text).unwrap_or_else(|e| format!("{e}\n")), text(&hand_back));
        if expect_refused {
            // ENOEXEC, which Rust reports as it is (Linux) or, where it ends
            // in execvp, which runs such a file with /bin/sh (macOS), a shell
            // reading the script: no interpreter from its first line, anyway.
            match kernel {
                Err(error) => assert_eq!(error.raw_os_error(), Some(8), "{name}: ENOEXEC"),
                Ok(output) => assert!(!String::from_utf8_lossy(&output.stdout).contains("RUSTIFY_HANDBACK_TRACE unset"), "{name}: the kernel started it"),
            }
            // argv[0] is what Command::new was given: "bun".
            let printed = String::from_utf8_lossy(&hand_back.stdout).into_owned();
            assert!(printed.starts_with(&format!("bun\n{}\n{}\n", entry.display(), ARGS.join("\n"))), "{name}: bun was not started: {printed}");
        } else {
            let kernel = kernel.unwrap();
            assert_eq!(text(&hand_back), text(&kernel), "{name}: the hand-back started the entry otherwise than the kernel");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_entry_with_a_shebang_line_is_started_as_the_kernel_starts_it() {
        let _serial = serial();
        let cases: Vec<(&str, String, bool)> = vec![
            ("plain", format!("#!{ARGV}\n"), false),
            ("an-argument", format!("#!{ARGV} one\n"), false),
            ("blanks", format!("#! \t{ARGV}  one two\tthree \t\n"), false),
            ("dash-s", format!("#!{ARGV} -S bun --flag\n"), false),
            ("env-s", format!("#!/usr/bin/env -S {ARGV} --flag\n"), false),
            ("crlf", format!("#!{ARGV} one\r\nconsole.log(1)\r\n"), false),
            ("hash", format!("#!{ARGV} one # two\n"), false),
            ("nul", format!("#!{ARGV} one\0two\n"), false),
            // An empty argument, which both kernels pass (Linux: "one "; macOS: "one", "").
            ("nul-after-blank", format!("#!{ARGV} \0two\n"), false),
            ("nul-after-tab", format!("#!{ARGV}\t\0two\n"), false),
            ("nul-after-argument", format!("#!{ARGV} one \0two\n"), false),
            ("long", format!("#!{ARGV} {}\n", "a".repeat(300)), false),
            ("relative", "#!rel-argv x y\n".to_string(), false),
            ("relative-dir", "#!sub/rel-argv x\n".to_string(), false),
            ("env-bun-missing", "#!/usr/bin/env bun-that-is-not-there\n".to_string(), false),
            ("env-crlf", "#!/usr/bin/env bun\r\n".to_string(), false),
            ("bom", format!("\u{feff}#!{ARGV} one\n"), true),
            ("no-shebang", "console.log(1)\n".to_string(), true),
            ("empty-shebang", "#!\n".to_string(), true),
        ];
        for (name, head, refused) in cases {
            compare(name, head.as_bytes(), refused);
        }
        // What one system refuses and the other does not.
        let longer = format!("#!{ARGV} {}\n", "a".repeat(600));
        compare("longer", longer.as_bytes(), cfg!(target_os = "macos"));
        let no_line_end = format!("#!{ARGV} one");
        compare("no-line-end", no_line_end.as_bytes(), cfg!(target_os = "macos"));
    }

    /// A NUL where the interpreter's name begins: the kernels try to start an
    /// empty name and cannot (EACCES on Linux, ENOENT on macOS), and the
    /// hand-back takes the line for none, as for `#!` alone: bun.
    #[test]
    fn an_interpreter_name_that_a_nul_empties_is_no_interpreter() {
        let _serial = serial();
        for (name, head) in [("nul-first", "#!\0/usr/bin/env node\n"), ("nul-after-blanks", "#!  \0/usr/bin/env node\n")] {
            let dir = scratch(name);
            let root = dir.join("pkg");
            let entry = package(&root, head.as_bytes());
            runtime_at(&dir.join("bin").join("bun"));
            let path = std::env::join_paths([dir.join("bin"), "/usr/bin".into(), "/bin".into()]).unwrap();
            let kernel = start(&entry, &ARGS, &dir, &path, &[]);
            let hand_back = start(Path::new(TOY), &ARGS, &dir, &path, &[(ROOT_ENV, root.as_os_str())]).unwrap();
            println!("== {name}\n-- the kernel: {}\n-- toy js: {}", kernel.as_ref().map(text).unwrap_or_else(|e| format!("{e}\n")), text(&hand_back));
            let expected = if cfg!(target_os = "macos") { 2 } else { 13 };
            assert_eq!(kernel.err().and_then(|e| e.raw_os_error()), Some(expected), "{name}: the kernel's answer");
            let printed = String::from_utf8_lossy(&hand_back.stdout).into_owned();
            assert!(hand_back.status.success() && printed.starts_with(&format!("bun\n{}\n{}\n", entry.display(), ARGS.join("\n"))), "{name}: bun was not started: {}", text(&hand_back));
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }

    /// Linux reads 256 bytes: an interpreter's name that a blank in the last
    /// of them ends is taken, and what follows is cut off; macOS reads 512.
    #[test]
    fn an_interpreter_name_at_the_end_of_what_linux_reads() {
        let _serial = serial();
        let dir = scratch("edge");
        // A copy of toy-argv whose path is 253 bytes long: "#!" and it fill bytes 0 to 254.
        let pad = 253 - dir.as_os_str().len() - "/".len() - "/toy-argv".len();
        let interpreter = dir.join("e".repeat(pad)).join("toy-argv");
        assert_eq!(interpreter.as_os_str().len(), 253);
        runtime_at(&interpreter);
        let root = dir.join("pkg");
        let entry = package(&root, format!("#!{} cut-off-on-linux\n", interpreter.display()).as_bytes());
        let path = std::env::join_paths(["/usr/bin", "/bin"]).unwrap();
        let kernel = start(&entry, &ARGS, &dir, &path, &[]).unwrap();
        let hand_back = start(Path::new(TOY), &ARGS, &dir, &path, &[(ROOT_ENV, root.as_os_str())]).unwrap();
        println!("-- the kernel: {}-- toy js: {}", text(&kernel), text(&hand_back));
        let second = String::from_utf8_lossy(&kernel.stdout).lines().nth(1).unwrap_or("").to_string();
        assert_eq!(second, if cfg!(target_os = "macos") { "cut-off-on-linux".to_string() } else { entry.display().to_string() });
        assert_eq!(text(&hand_back), text(&kernel));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// `#!/usr/bin/env bun` with no bun on PATH: env says so, in its words and
    /// with its exit code, as when the command was the script itself.
    #[test]
    fn a_missing_bun_is_reported_by_env() {
        let _serial = serial();
        let dir = scratch("no-bun");
        let root = dir.join("pkg");
        let entry = package(&root, b"#!/usr/bin/env bun\nconsole.log(1)\n");
        // A PATH with nothing on it: a system may have a bun in /usr/bin.
        std::fs::create_dir_all(dir.join("empty")).unwrap();
        let path = dir.join("empty").into_os_string();
        let kernel = start(&entry, &ARGS, &dir, &path, &[]).unwrap();
        let hand_back = start(Path::new(TOY), &ARGS, &dir, &path, &[(ROOT_ENV, root.as_os_str())]).unwrap();
        println!("-- the kernel: {}-- toy js: {}", text(&kernel), text(&hand_back));
        assert_eq!(hand_back.status.code(), Some(127));
        assert!(String::from_utf8_lossy(&hand_back.stderr).starts_with("env: "), "env's own words");
        assert_eq!(text(&hand_back), text(&kernel));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// An interpreter that is not there: the hand-back says which, exit 127.
    #[test]
    fn a_missing_interpreter_is_named() {
        let _serial = serial();
        let dir = scratch("no-interpreter");
        let root = dir.join("pkg");
        package(&root, b"#!/nonexistent/interpreter\n");
        let hand_back = start(Path::new(TOY), &ARGS, &dir, "/usr/bin:/bin".as_ref(), &[(ROOT_ENV, root.as_os_str())]).unwrap();
        assert_eq!(hand_back.status.code(), Some(127));
        let stderr = String::from_utf8_lossy(&hand_back.stderr);
        assert!(stderr.contains("its #! line names /nonexistent/interpreter, which could not be started"), "{stderr}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

/// The JavaScript does not see ROOT_ENV when it names the package, as the
/// launcher sets it; a value of the user's that names another directory stays.
#[test]
fn root_env_is_the_launchers_only_when_it_names_the_package() {
    let _serial = serial();
    let dir = scratch("root-env");
    let root = dir.join("pkg");
    let exe = if cfg!(windows) { ".exe" } else { "" };
    // The entry needs no `#!` line: "bun" on PATH is toy-argv.
    package(&root, b"console.log(1)\n");
    runtime_at(&dir.join("bin").join(format!("bun{exe}")));
    let mut dirs = vec![dir.join("bin")];
    if let Some(system) = std::env::var_os("SystemRoot") {
        dirs.push(PathBuf::from(system).join("System32"));
    }
    let path = std::env::join_paths(dirs).unwrap();
    let seen = |toy: &Path, value: &std::ffi::OsStr| {
        let output = start(toy, &ARGS, &dir, &path, &[(ROOT_ENV, value)]).unwrap();
        assert!(output.status.success(), "{}", text(&output));
        String::from_utf8_lossy(&output.stdout).lines().find(|l| l.starts_with(ROOT_ENV)).unwrap().to_string()
    };
    // Named as the launcher names it, and in another spelling of the same directory.
    assert_eq!(seen(Path::new(TOY), root.as_os_str()), format!("{ROOT_ENV} unset"));
    let other_spelling = root.join("dist").join("..");
    assert_eq!(seen(Path::new(TOY), other_spelling.as_os_str()), format!("{ROOT_ENV} unset"));
    // The binary inside the package, as installed and linked, which finds the
    // package by its own place: the user's value names something else.
    std::fs::create_dir_all(root.join("rustify")).unwrap();
    std::fs::write(root.join("rustify").join("package.json"), "{\"type\":\"commonjs\"}\n").unwrap();
    let linked = root.join("rustify").join(format!("toy{exe}"));
    std::fs::copy(TOY, &linked).unwrap();
    let elsewhere = dir.join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    let kept = seen(&linked, elsewhere.as_os_str());
    assert!(kept.starts_with(&format!("{ROOT_ENV}=")) && kept.ends_with("elsewhere"), "{kept}");
    assert_eq!(seen(&linked, "not a directory".as_ref()), format!("{ROOT_ENV}=not a directory"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[cfg(windows)]
mod windows {
    use super::*;

    /// npm's cmd-shim (npm 10) writes this for `npm i -g bun`: bun.cmd beside
    /// node_modules\bun\bin\bun.exe.
    const BUN_CMD: &str = "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\"%dp0%\\node_modules\\bun\\bin\\bun.exe\"   %*\r\n";

    /// An npm global prefix with bun installed by npm, and nothing else on PATH but System32.
    fn npm_bun(dir: &Path) -> std::ffi::OsString {
        let prefix = dir.join("npm");
        runtime_at(&prefix.join("node_modules").join("bun").join("bin").join("bun.exe"));
        std::fs::write(prefix.join("bun.cmd"), BUN_CMD).unwrap();
        let system = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32");
        std::env::join_paths([prefix, system]).unwrap()
    }

    #[test]
    fn bun_is_found_as_bun_cmd_and_gets_the_arguments() {
        let _serial = serial();
        let dir = scratch("bun-cmd");
        let root = dir.join("pkg");
        let entry = package(&root, b"#!/usr/bin/env bun\nconsole.log(1)\n");
        let path = npm_bun(&dir);
        let args = ["js", "plain", "two words", "", "100%", "%PATH%", "a\"b", "\"", "&", "^", "|", "<>", "a&b|c<d>e^f", "!x!", "\u{65e5}\u{672c}\u{e9}", "trailing\\", "C:\\dir with space\\"];
        let output = start(Path::new(TOY), &args, &dir, &path, &[(ROOT_ENV, root.as_os_str())]).unwrap();
        println!("{}", text(&output));
        assert!(output.status.success(), "{}", text(&output));
        let printed = String::from_utf8_lossy(&output.stdout).into_owned();
        let lines: Vec<&str> = printed.lines().collect();
        assert!(lines[0].replace("\\\\", "\\").to_lowercase().ends_with("\\node_modules\\bun\\bin\\bun.exe"), "bun.exe, through bun.cmd: {}", lines[0]);
        assert_eq!(lines[1].replace("\\\\", "\\"), entry.display().to_string());
        let escaped: Vec<String> = args.iter().map(|a| a.replace('\\', "\\\\").chars().map(|c| if (' '..='~').contains(&c) { c.to_string() } else { format!("\\u{:04x}", c as u32) }).collect()).collect();
        assert_eq!(lines[2..2 + args.len()], escaped[..], "the arguments arrive as they were given");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// An argument with a line break cannot go through a batch file unchanged:
    /// Rust refuses to start it, and the hand-back says so.
    #[test]
    fn a_batch_file_that_cannot_take_the_arguments_says_so() {
        let _serial = serial();
        let dir = scratch("bun-cmd-refused");
        let root = dir.join("pkg");
        package(&root, b"#!/usr/bin/env bun\nconsole.log(1)\n");
        let path = npm_bun(&dir);
        let output = start(Path::new(TOY), &["js", "two\nlines"], &dir, &path, &[(ROOT_ENV, root.as_os_str())]).unwrap();
        println!("{}", text(&output));
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert_eq!(output.status.code(), Some(127), "{}", text(&output));
        // Named as the file is, not in PATHEXT's capitals.
        assert!(stderr.contains("\\npm\\bun.cmd is a batch file") && !stderr.contains("panicked"), "{stderr}");
        assert!(output.stdout.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The entry is started as the package managers' shims start it
    /// (measured on Windows 11 with npm 11 and bun 1.4.2): with what its `#!`
    /// line names and nothing else, except that bun's shim takes bun where
    /// the line names node and node is missing. So an entry whose line names
    /// bun never goes to node, as wtx's `wtx.mjs` did, where node then failed
    /// on its first import. With nothing to start, the binary says what is
    /// missing and exits 1, as npm's shim does from a command prompt.
    #[test]
    fn the_runtime_is_the_one_the_line_names() {
        let _serial = serial();
        let dir = scratch("shims");
        let root = dir.join("pkg");
        let system = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32");
        // The entry's first bytes, the runtimes on PATH, and the one started (None: none).
        let cases: [(&str, &[&str], Option<&str>); 7] = [
            ("#!/usr/bin/env bun\nimport { serve } from \"./src/server\";\n", &["node"], None),
            ("#!/usr/bin/env bun\r\nconsole.log(1)\r\n", &["node", "bun"], Some("bun")),
            ("#!/usr/bin/env node\n", &["bun"], Some("bun")),
            ("#!/usr/bin/env node\n", &["bun", "node"], Some("node")),
            ("#!/usr/bin/env node\n", &[], None),
            ("#!/usr/bin/env tsx\n", &["node", "bun"], None),
            ("console.log(1)\n", &["node"], Some("node")),
        ];
        for (head, on_path, started) in cases {
            let bin = dir.join(format!("bin-{}", on_path.join("-")));
            for name in on_path {
                runtime_at(&bin.join(format!("{name}.exe")));
            }
            let entry = package(&root, head.as_bytes());
            let path = std::env::join_paths([bin, system.clone()]).unwrap();
            let output = start(Path::new(TOY), &["js", "one"], &dir, &path, &[(ROOT_ENV, root.as_os_str())]).unwrap();
            let label = format!("{head:?} with {on_path:?} on PATH: {}", text(&output));
            let printed = String::from_utf8_lossy(&output.stdout).into_owned();
            match started {
                Some(name) => {
                    assert!(output.status.success(), "{label}");
                    let first = printed.lines().next().unwrap_or("").replace("\\\\", "\\").to_lowercase();
                    assert!(first.ends_with(&format!("\\{name}.exe")), "{name} was to be started: {label}");
                }
                None => {
                    assert_eq!(output.status.code(), Some(1), "{label}");
                    assert!(printed.is_empty(), "nothing was to be started: {label}");
                    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
                    let named = head.trim_start_matches("#!/usr/bin/env ").split(['\r', '\n']).next().unwrap();
                    assert!(stderr.starts_with(&format!("cannot run {}: its #! line names {named}; ", entry.display())), "{label}");
                }
            }
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// bun.exe ahead of bun.cmd on PATH is the one started.
    #[test]
    fn bun_exe_first_on_path_wins() {
        let _serial = serial();
        let dir = scratch("bun-exe");
        let root = dir.join("pkg");
        package(&root, b"console.log(1)\n");
        runtime_at(&dir.join("bun").join("bun.exe"));
        let npm = npm_bun(&dir);
        let path = std::env::join_paths(std::iter::once(dir.join("bun")).chain(std::env::split_paths(&npm))).unwrap();
        let output = start(Path::new(TOY), &["js", "two\nlines"], &dir, &path, &[(ROOT_ENV, root.as_os_str())]).unwrap();
        assert!(output.status.success(), "{}", text(&output));
        let printed = String::from_utf8_lossy(&output.stdout).into_owned();
        assert!(printed.lines().next().unwrap().replace("\\\\", "\\").to_lowercase().ends_with("\\bun\\bun.exe"), "{printed}");
        assert!(printed.contains("two\\u000alines"), "and a line break reaches it: {printed}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
