//! Fixture for tests/e2e/run.sh: reports how it was started.
#[path = "../../../../templates/rust/js_fallback.rs"]
mod js_fallback;

fn main() {
    // `toy js ...` stands for a command that has not been ported yet.
    if std::env::args().nth(1).as_deref() == Some("js") {
        js_fallback::run("dist/cli.js");
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
