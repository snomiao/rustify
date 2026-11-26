//! Fixture for tests/e2e/run.sh: reports how it was started.
#[path = "../../../../templates/rust/js_fallback.rs"]
mod js_fallback;

fn main() {
    // `toy js ...` stands for a command that has not been ported yet.
    if std::env::args().nth(1).as_deref() == Some("js") {
        js_fallback::run("dist/cli.js");
    }
    // `toy sleep <seconds> <file>` stands for a long-running command: it writes
    // "<version> <tick>" to <file> five times a second and ends after
    // <seconds>, or as soon as <file>.stop exists.
    let argv: Vec<String> = std::env::args().collect();
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
