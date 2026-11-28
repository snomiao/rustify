//! Fixture for tests/handback.rs: stands for a JavaScript runtime. Prints the
//! arguments it was started with, one per line, then whether the variables a
//! hand-back takes care of are set. Every byte (on Windows, every UTF-16
//! unit) outside printable ASCII is written as \xNN (\uNNNN), and `\` as `\\`.
fn main() {
    let mut out = String::new();
    for arg in std::env::args_os() {
        out.push_str(&escape(&arg));
        out.push('\n');
    }
    for name in ["RUSTIFY_PACKAGE_ROOT", "RUSTIFY_HANDBACK_TRACE"] {
        match std::env::var_os(name) {
            Some(value) => out.push_str(&format!("{name}={}\n", escape(&value))),
            None => out.push_str(&format!("{name} unset\n")),
        }
    }
    // A reader that has gone away is not this fixture's business.
    let _ = std::io::Write::write_all(&mut std::io::stdout(), out.as_bytes());
}

#[cfg(unix)]
fn escape(text: &std::ffi::OsStr) -> String {
    use std::os::unix::ffi::OsStrExt;
    text.as_bytes()
        .iter()
        .map(|&b| match b {
            b'\\' => "\\\\".to_string(),
            0x20..=0x7e => (b as char).to_string(),
            _ => format!("\\x{b:02x}"),
        })
        .collect()
}

#[cfg(windows)]
fn escape(text: &std::ffi::OsStr) -> String {
    use std::os::windows::ffi::OsStrExt;
    text.encode_wide()
        .map(|u| match u {
            0x5c => "\\\\".to_string(),
            0x20..=0x7e => (u as u8 as char).to_string(),
            _ => format!("\\u{u:04x}"),
        })
        .collect()
}
