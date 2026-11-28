//! Fixture for tests/e2e/run.sh: reports how it was started.
#[path = "../../../../templates/rust/js_fallback.rs"]
mod js_fallback;

fn main() {
    // `toy js ...` stands for a command that has not been ported yet.
    if std::env::args().nth(1).as_deref() == Some("js") {
        js_fallback::run("dist/cli.js");
    }
    // These stand for a ported command that goes through `js_fallback::attempt`:
    //   toy answer      works out its answer, which is then printed
    //   toy decline     does not implement the invocation: the JavaScript answers
    //   toy panic       has a bug: the JavaScript answers and nothing else shows
    //   toy panic-thread  has a bug in a worker thread it started, and declines
    //                   when the thread fails: the same
    //   toy panic-late  has a bug after it began to print: nothing can answer in its place
    if let Some(command @ ("answer" | "decline" | "panic" | "panic-thread" | "panic-late")) = std::env::args().nth(1).as_deref() {
        let answer = js_fallback::attempt(|| match command {
            "answer" => Ok("toy answers natively"),
            "decline" => Err(js_fallback::HandBack),
            "panic" => panic!("a bug in a ported command"),
            "panic-thread" => std::thread::spawn(|| -> &'static str { panic!("a bug in a worker thread") })
                .join()
                .map_err(|_| js_fallback::HandBack),
            _ => {
                js_fallback::commit();
                println!("toy began to answer");
                panic!("a bug after the first output");
            }
        });
        match answer {
            Some(text) => return println!("{text}"),
            None => js_fallback::run("dist/cli.js"),
        }
    }
    // `toy where <text> <NAME>...` says, for each environment variable, whether
    // its value contains <text>: `HOME:inside`, `HOME:outside` or `HOME:unset`.
    // The install smoke test gives commands a home directory of their own; this
    // shows which variables point into it.
    let argv: Vec<String> = std::env::args().collect();
    if argv.get(1).map(String::as_str) == Some("where") {
        let text = argv.get(2).cloned().unwrap_or_default();
        let report: Vec<String> = argv
            .iter()
            .skip(3)
            .map(|name| match std::env::var_os(name) {
                None => format!("{name}:unset"),
                Some(value) if value.to_string_lossy().contains(&text) => format!("{name}:inside"),
                Some(_) => format!("{name}:outside"),
            })
            .collect();
        return println!("{}", report.join(" "));
    }
    // `toy env [file]` writes the environment this process was started with,
    // as the system holds it: one entry per line, in the system's order, every
    // byte (on Windows every UTF-16 unit) outside printable ASCII as \xNN
    // (\uNNNN), and `\` as `\\`. It shows what the launcher handed over.
    if argv.get(1).map(String::as_str) == Some("env") {
        let text: String = raw_environment().into_iter().map(|entry| entry + "\n").collect();
        match argv.get(2) {
            Some(file) => std::fs::write(file, text).unwrap_or_else(|e| panic!("{file}: {e}")),
            None => {
                let _ = std::io::Write::write_all(&mut std::io::stdout(), text.as_bytes());
            }
        }
        return;
    }
    // `toy sleep <seconds> <file>` stands for a long-running command: it writes
    // "<version> <tick>" to <file> five times a second and ends after
    // <seconds>, or as soon as <file>.stop exists.
    if argv.get(1).map(String::as_str) == Some("sleep") {
        let seconds: u64 = argv.get(2).and_then(|s| s.parse().ok()).unwrap_or(10);
        let file = argv.get(3).cloned().unwrap_or_default();
        let version = option_env!("TOY_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"));
        for tick in 0..seconds * 5 {
            if !file.is_empty() {
                let _ = std::fs::write(&file, format!("{version} {tick}"));
                if std::path::Path::new(&format!("{file}.stop")).exists() {
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        return;
    }
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    let argv0 = std::env::args().next().unwrap_or_default();
    let root = std::env::var("RUSTIFY_PACKAGE_ROOT").unwrap_or_default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    println!(
        "toy version={} arch={} exe={} argv0={} root={} args={:?}",
        option_env!("TOY_VERSION").unwrap_or(env!("CARGO_PKG_VERSION")),
        std::env::consts::ARCH,
        exe,
        argv0,
        root,
        args
    );
    if args.first().map(String::as_str) == Some("exit") {
        std::process::exit(args.get(1).and_then(|c| c.parse().ok()).unwrap_or(0));
    }
}

/// The entries of this process's environment block, escaped (see `toy env`).
#[cfg(unix)]
fn raw_environment() -> Vec<String> {
    use std::ffi::{c_char, CStr};
    #[cfg(target_os = "macos")]
    unsafe fn environ() -> *const *const c_char {
        extern "C" {
            fn _NSGetEnviron() -> *const *const *const c_char;
        }
        *_NSGetEnviron()
    }
    #[cfg(not(target_os = "macos"))]
    unsafe fn environ() -> *const *const c_char {
        extern "C" {
            static environ: *const *const c_char;
        }
        environ
    }
    let mut entries = Vec::new();
    // SAFETY: environ is a NULL-terminated array of C strings, and nothing
    // in this process changes it while it is read.
    unsafe {
        let mut at = environ();
        while !at.is_null() && !(*at).is_null() {
            let escaped = CStr::from_ptr(*at).to_bytes().iter().map(|&b| match b {
                b'\\' => "\\\\".to_string(),
                0x20..=0x7e => (b as char).to_string(),
                _ => format!("\\x{b:02x}"),
            });
            entries.push(escaped.collect());
            at = at.add(1);
        }
    }
    entries
}

/// The entries of this process's environment block, escaped (see `toy env`).
#[cfg(windows)]
fn raw_environment() -> Vec<String> {
    extern "system" {
        fn GetEnvironmentStringsW() -> *mut u16;
        fn FreeEnvironmentStringsW(block: *mut u16) -> i32;
    }
    let mut entries = Vec::new();
    // SAFETY: the block is a run of NUL-terminated UTF-16 strings that ends
    // with an empty one, and it is freed once, after it was read.
    unsafe {
        let block = GetEnvironmentStringsW();
        if block.is_null() {
            return entries;
        }
        let mut at = block;
        loop {
            let mut length = 0;
            while *at.add(length) != 0 {
                length += 1;
            }
            if length == 0 {
                break;
            }
            let escaped = std::slice::from_raw_parts(at, length).iter().map(|&u| match u {
                0x5c => "\\\\".to_string(),
                0x20..=0x7e => (u as u8 as char).to_string(),
                _ => format!("\\u{u:04x}"),
            });
            entries.push(escaped.collect());
            at = at.add(length + 1);
        }
        FreeEnvironmentStringsW(block);
    }
    entries
}

#[cfg(not(any(unix, windows)))]
fn raw_environment() -> Vec<String> {
    std::env::vars_os().map(|(k, v)| format!("{}={}", k.to_string_lossy(), v.to_string_lossy())).collect()
}
