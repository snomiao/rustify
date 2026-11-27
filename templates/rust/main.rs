//! __NAME__ — Rust entry point.
//!
//! Installed from npm, this binary is the command users run. A command runs
//! here once it has been ported and a parity test shows it behaves like the
//! TypeScript; until then it is handed back to the JavaScript the package
//! still ships, so nothing changes for users.

mod js_fallback;

__JS_ENTRY_DEFINITION__

/// `__ENV___NO_NATIVE=1` hands every command back to the JavaScript: the way
/// out for a user if a ported command misbehaves.
fn native() -> bool {
    std::env::var_os("__ENV___NO_NATIVE").is_none()
}

fn main() {
    // Arguments that are not valid UTF-8 are for the JavaScript to deal with.
    let args: Option<Vec<String>> = std::env::args_os().skip(1).map(|arg| arg.into_string().ok()).collect();
    if let Some(args) = args.filter(|_| native()) {
        // Ported commands go here, one arm each, once their parity cases pass.
        // Everything the binary answers itself belongs in this match,
        // `--version` included, so that `__ENV___NO_NATIVE=1` switches it off.
        //
        // An arm takes only the invocations it implements exactly. For the
        // rest it falls out of the match, before it has printed or changed
        // anything, and the JavaScript answers. `js_fallback::attempt` is the
        // guard for that: the command works out its whole answer first and
        // returns it, or returns `Err(js_fallback::HandBack)`; and should it
        // panic, the invocation is handed back just the same.
        //
        //   Some("status") => {
        //       if let Some(text) = js_fallback::attempt(|| status::answer(&args[1..])) {
        //           print!("{text}");
        //           return;
        //       }
        //   }
        match args.first().map(String::as_str) {
            _ => {}
        }
    }
    js_fallback::run(__JS_ENTRY_EXPRESSION__)
}
