//! rustify — where each project stands on its move from TypeScript to Rust,
//! and whether `bun i -g <package>` already gives users the native binary.
//!
//! `rustify audit` only reads: local checkouts, the parity ledgers in
//! `parity/`, and the public npm and crates.io registries. It never changes a
//! project. `rustify vendor` copies the release scripts into a project.

use serde::Deserialize;
use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::{env, fs};

const PLATFORMS_JSON: &str = include_str!("../templates/npm/platforms.json");
const WORKFLOW: &str = "rust-npm-release.yml";
/// What a project's workflow must reference to be on the shared pipeline.
const BUILD_WORKFLOW: &str = "snomiao/rustify/.github/workflows/rust-npm-build.yml@";
const PUBLISH_ACTION: &str = "snomiao/rustify/actions/publish@";
const SCRIPT_EXTENSIONS: &[&str] = &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
const STATUSES: &[&str] = &["missing", "partial", "ported", "verified", "dropped"];

#[derive(Deserialize)]
struct Registry {
    project: Vec<Project>,
}

#[derive(Deserialize)]
struct Project {
    name: String,
    repo: Option<String>,
    path: Option<String>,
    npm: Option<String>,
    #[serde(rename = "crate")]
    crate_name: Option<String>,
    manifest: Option<String>,
    #[serde(default)]
    ts: Vec<String>,
    #[serde(default)]
    rust: Vec<String>,
    #[serde(default)]
    ignore: Vec<String>,
    #[serde(default)]
    keep_ts: BTreeMap<String, String>,
}

#[derive(Deserialize, Default)]
struct Ledger {
    /// Commit of the project the ledger was last checked against.
    reconciled: Option<String>,
    #[serde(default)]
    feature: Vec<Feature>,
}

#[derive(Deserialize)]
struct Feature {
    name: String,
    status: String,
    ts: Option<String>,
    rs: Option<String>,
    proof: Option<String>,
}

/// One project's section of the report plus its row in the summary table.
#[derive(Default)]
struct Section {
    body: String,
    port: String,
    install: String,
    next: Option<String>,
}

impl Section {
    fn line(&mut self, tag: &str, text: impl AsRef<str>) {
        let _ = writeln!(self.body, "- `{tag}` {}", text.as_ref());
    }
    fn ok(&mut self, text: impl AsRef<str>) {
        self.line("ok  ", text);
    }
    fn info(&mut self, text: impl AsRef<str>) {
        self.line("info", text);
    }
    fn warn(&mut self, text: impl AsRef<str>) {
        self.line("warn", text);
    }
    /// A gap. The first one recorded becomes the project's next step.
    fn todo(&mut self, text: impl AsRef<str>, next: &str) {
        self.line("todo", text);
        if self.next.is_none() {
            self.next = Some(next.to_string());
        }
    }
    fn heading(&mut self, text: &str) {
        let _ = writeln!(self.body, "\n**{text}**\n");
    }
}

/// Writes to stdout and ignores a closed pipe (`rustify audit | head`).
fn emit(text: &str) {
    let _ = std::io::Write::write_all(&mut std::io::stdout(), text.as_bytes());
}

macro_rules! say {
    ($($arg:tt)*) => {{
        emit(&format!($($arg)*));
        emit("\n");
    }};
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let code = match args.first().map(String::as_str) {
        Some("audit") => audit(&args[1..]),
        Some("vendor") => vendor(&args[1..]),
        Some("scaffold") => scaffold(&args[1..]),
        _ => {
            eprintln!(
                "usage:\n  rustify audit [project...] [--offline] [--write]\n      report every project's port and delivery status\n      --offline  skip the npm and crates.io lookups\n      --write    also save the report to docs/status.md\n  Every command takes `--at <checkout>` with one project name, to work on a\n  checkout other than the project's default one (a feature worktree).\n  rustify scaffold <project> [--dry-run]\n      start a Rust crate in a project that has none: a binary that hands\n      every command back to the JavaScript, ready for commands to move in\n  rustify vendor <project> [--dry-run]\n      add the release workflow to a project that has none"
            );
            2
        }
    };
    std::process::exit(code);
}

// ───────────────────────────── locating things ─────────────────────────────

/// The rustify checkout: the nearest directory at or above the current one
/// that contains projects.toml.
fn home() -> PathBuf {
    let mut dir = env::current_dir().expect("current directory");
    loop {
        if dir.join("projects.toml").is_file() {
            return dir;
        }
        if !dir.pop() {
            eprintln!("rustify: projects.toml not found here or in any parent directory");
            std::process::exit(2);
        }
    }
}

fn load_registry(home: &Path) -> Registry {
    let text = fs::read_to_string(home.join("projects.toml")).expect("read projects.toml");
    toml::from_str(&text).unwrap_or_else(|e| {
        eprintln!("rustify: projects.toml: {e}");
        std::process::exit(2);
    })
}

/// Directory that holds the project checkouts.
fn checkout_root(home: &Path) -> PathBuf {
    if let Ok(root) = env::var("RUSTIFY_ROOT") {
        return PathBuf::from(root);
    }
    // <root>/rustify/tree/<branch> is the layout used on the main dev machine.
    let parent = home.parent().unwrap_or(home);
    if parent.file_name().is_some_and(|n| n == "tree") {
        if let Some(root) = parent.parent().and_then(Path::parent) {
            return root.to_path_buf();
        }
    }
    parent.to_path_buf()
}

fn locate(project: &Project, root: &Path) -> Option<PathBuf> {
    if let Some(path) = &project.path {
        let path = PathBuf::from(path);
        return path.is_dir().then_some(path);
    }
    let base = root.join(&project.name);
    [base.join("tree/main"), base.join("tree/master"), base.clone()]
        .into_iter()
        .find(|p| p.join(".git").exists())
}

/// Value of `--at <dir>`: work on this checkout instead of the project's
/// default one (a feature worktree, for instance).
fn at(args: &[String]) -> Option<PathBuf> {
    let i = args.iter().position(|a| a == "--at")?;
    args.get(i + 1).map(PathBuf::from)
}

/// The arguments that are neither flags nor the value of `--at`.
fn positional(args: &[String]) -> Vec<&String> {
    let skip = args.iter().position(|a| a == "--at").map(|i| i + 1);
    args.iter()
        .enumerate()
        .filter(|(i, a)| !a.starts_with("--") && Some(*i) != skip)
        .map(|(_, a)| a)
        .collect()
}

/// The variables through which git tells the commands a hook runs which
/// repository, index and object store to use. They outrank `-C`.
const GIT_LOCATION_VARIABLES: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

/// `git -C <dir>`, reading that checkout even when started from a git hook
/// of another repository.
fn git_command(dir: &Path) -> Command {
    let mut git = Command::new("git");
    for name in GIT_LOCATION_VARIABLES {
        git.env_remove(name);
    }
    git.arg("-C").arg(dir);
    git
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = git_command(dir).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// GET a JSON document with curl. `Ok(None)` means the server said 404.
fn fetch(url: &str, accept: &str) -> Result<Option<Json>, String> {
    let out = Command::new("curl")
        .args(["-sS", "-L", "--max-time", "30", "-w", "\n%{http_code}"])
        .args(["-H", &format!("Accept: {accept}"), "-H", "User-Agent: rustify-audit", url])
        .output()
        .map_err(|e| format!("curl is not available ({e})"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let (body, status) = text.rsplit_once('\n').unwrap_or((&text, ""));
    match status.trim() {
        "200" => serde_json::from_str(body).map(Some).map_err(|e| format!("unreadable answer: {e}")),
        "404" => Ok(None),
        other => Err(format!("HTTP {other}")),
    }
}

// ──────────────────────────────── counting ─────────────────────────────────

struct SourceFile {
    path: String,
    lines: usize,
    is_test: bool,
}

/// A directory of projects.toml as git prints paths: `./src/` is `src`, and
/// the repository root is `.`.
fn tidy(dir: &str) -> &str {
    let mut dir = dir.trim_end_matches('/');
    while let Some(rest) = dir.strip_prefix("./") {
        dir = rest;
    }
    dir
}

fn is_under(path: &str, dir: &str) -> bool {
    let dir = tidy(dir);
    dir == "." || path == dir || path.starts_with(&format!("{dir}/"))
}

/// How far below the repository root a directory lies: 0 for the root
/// itself, 2 for `rs/src`.
fn depth(dir: &str) -> usize {
    match tidy(dir) {
        "." => 0,
        dir => dir.split('/').count(),
    }
}

/// How far below the repository root the deepest of `dirs` that holds `path`
/// lies. `None` when none holds it.
fn deepest<'a>(path: &str, dirs: impl IntoIterator<Item = &'a String>) -> Option<usize> {
    dirs.into_iter().filter(|dir| is_under(path, dir)).map(|dir| depth(dir)).max()
}

/// The extension of a file name: `ts` for `a/b.d.ts`, nothing for a file that
/// is merely called `ts`.
fn extension(path: &str) -> &str {
    Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("")
}

impl Project {
    /// Whether a file is TypeScript or JavaScript the port is to replace, its
    /// tests included: a script under a `ts` directory that no `ignore` or
    /// `keep_ts` path holds and that is not one of the port's own scripts.
    fn replaces(&self, path: &str) -> bool {
        let Some(ts) = deepest(path, &self.ts) else { return false };
        SCRIPT_EXTENSIONS.contains(&extension(path))
            && !path.ends_with(".d.ts")
            && !self.ignore.iter().chain(self.keep_ts.keys()).any(|skip| is_under(path, skip))
            && !self.is_ports_own_script(path, ts)
    }

    /// The directory the crate has to itself: `rs` for `rs/Cargo.toml`, and
    /// also when projects.toml names no manifest, since `rustify scaffold`
    /// puts the crate there. `None` for a crate at the repository root.
    fn crate_dir(&self) -> Option<&str> {
        let manifest = tidy(self.manifest.as_deref().unwrap_or("rs/Cargo.toml"));
        manifest.rsplit_once('/').map(|(dir, _)| dir)
    }

    /// Whether a script under a `ts` directory `ts` levels down belongs to
    /// the port: it lies in a `rust` directory inside the crate's own
    /// directory, and that directory lies below the `ts` directory. A crate
    /// at the repository root, or in the very directory of the TypeScript,
    /// shares its directories (`src`) with the TypeScript: there the
    /// extension alone tells the two apart, and a `rust` directory takes no
    /// script out.
    fn is_ports_own_script(&self, path: &str, ts: usize) -> bool {
        let Some(crate_dir) = self.crate_dir() else { return false };
        depth(crate_dir) > ts
            && self.rust.iter().any(|rust| is_under(path, rust) && is_under(tidy(rust), crate_dir))
    }

    /// Whether a file that is not a script is still part of what the
    /// TypeScript does: a shell script it runs, a template it writes out, data
    /// it reads. Only under a `ts` directory other than the repository root,
    /// where everything is the program's; at the root the same rule would
    /// take in package.json, the README and the workflows. Nothing that
    /// `ignore` or `keep_ts` holds, no Rust, nothing in the crate's own
    /// directory, no `.d.ts`.
    fn runs(&self, path: &str) -> bool {
        let named = self.ts.iter().any(|ts| tidy(ts) != "." && is_under(path, ts));
        named
            && !SCRIPT_EXTENSIONS.contains(&extension(path))
            && !path.ends_with(".d.ts")
            && !self.ignore.iter().chain(self.keep_ts.keys()).any(|skip| is_under(path, skip))
            && !self.is_rust(path)
            && extension(path) != "rs"
            && !self.crate_dir().is_some_and(|dir| is_under(path, dir))
    }

    /// Whether a file belongs to the Rust port: a `.rs` file under a `rust`
    /// directory. Being listed under `rust` outranks an `ignore` entry that
    /// holds the directory (`ignore = ["rs"]` with `rust = ["rs/src"]`); an
    /// `ignore` entry inside the directory still leaves its files out.
    fn is_rust(&self, path: &str) -> bool {
        let Some(rust) = deepest(path, &self.rust) else { return false };
        extension(path) == "rs" && !deepest(path, &self.ignore).is_some_and(|ignored| ignored > rust)
    }
}

fn is_test_path(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.contains(".spec.")
        || name.contains(".test.")
        || path.split('/').any(|part| matches!(part, "tests" | "test" | "__tests__" | "e2e"))
}

/// The tracked files of a checkout that `wanted` accepts.
fn sources(dir: &Path, wanted: impl Fn(&str) -> bool) -> Vec<SourceFile> {
    let mut files = Vec::new();
    // -z, because git otherwise prints a name with non-ASCII characters
    // quoted and escaped, and no extension would match it.
    let listed = git(dir, &["ls-files", "-z"]).unwrap_or_default();
    for path in listed.split('\0').filter(|path| wanted(path)) {
        let Ok(bytes) = fs::read(dir.join(path)) else { continue };
        files.push(SourceFile {
            path: path.to_string(),
            lines: bytes.iter().filter(|b| **b == b'\n').count(),
            is_test: is_test_path(path),
        });
    }
    files
}

fn count_matching(dir: &Path, files: &[SourceFile], needles: &[&str]) -> usize {
    files
        .iter()
        .filter_map(|f| fs::read_to_string(dir.join(&f.path)).ok())
        .map(|text| {
            text.lines()
                .filter(|line| {
                    let line = line.trim_start();
                    needles.iter().any(|n| line.starts_with(n))
                })
                .count()
        })
        .sum()
}

/// `pidStore.ts` and `pid_store.rs` both become `pidstore`.
fn module_key(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    let stem = name.split('.').next().unwrap_or(name);
    stem.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()
}

fn thousands(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

// ───────────────────────────────── audit ───────────────────────────────────

fn audit(args: &[String]) -> i32 {
    let offline = args.iter().any(|a| a == "--offline");
    let write = args.iter().any(|a| a == "--write");
    let wanted: Vec<&String> = positional(args);
    let here = at(args);
    if here.is_some() && wanted.len() != 1 {
        eprintln!("rustify: --at needs exactly one project name");
        return 2;
    }
    let home = home();
    let registry = load_registry(&home);
    let root = checkout_root(&home);
    for name in &wanted {
        if !registry.project.iter().any(|p| &&p.name == name) {
            eprintln!("rustify: no project named {name} in projects.toml");
            return 2;
        }
    }

    let mut sections = Vec::new();
    for project in &registry.project {
        if !wanted.is_empty() && !wanted.contains(&&project.name) {
            continue;
        }
        sections.push((project, audit_project(project, &home, &root, offline, here.as_deref())));
    }

    let mut report = String::from("# Rustify status\n\n");
    report.push_str("| Project | Port | `bun i -g` gives | Next step |\n|---|---|---|---|\n");
    for (project, section) in &sections {
        let _ = writeln!(
            report,
            "| {} | {} | {} | {} |",
            project.name,
            section.port,
            section.install,
            section.next.as_deref().unwrap_or("nothing — done")
        );
    }
    if offline {
        report.push_str("\nRegistry lookups were skipped (`--offline`), so published state is unknown.\n");
    }
    for (project, section) in &sections {
        let _ = write!(report, "\n## {}\n{}", project.name, section.body);
    }
    emit(&report);
    if write {
        let file = home.join("docs/status.md");
        if let Err(e) = fs::create_dir_all(home.join("docs")).and_then(|_| fs::write(&file, &report)) {
            eprintln!("rustify: cannot write {}: {e}", file.display());
            return 1;
        }
        eprintln!("saved {}", file.display());
    }
    0
}

fn audit_project(project: &Project, home: &Path, root: &Path, offline: bool, here: Option<&Path>) -> Section {
    let mut s = Section { port: "unknown".into(), install: "unknown".into(), ..Default::default() };
    let Some(dir) = here.map(Path::to_path_buf).filter(|d| d.is_dir()).or_else(|| locate(project, root)) else {
        s.todo(
            format!("no checkout found under `{}`", root.join(&project.name).display()),
            "clone the repository",
        );
        return s;
    };

    // ── checkout ──
    s.heading("Checkout");
    let branch = git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default();
    let head = git(&dir, &["rev-parse", "--short", "HEAD"]).unwrap_or_default();
    let dirty = git(&dir, &["status", "--porcelain"]).map(|t| t.lines().count()).unwrap_or(0);
    s.info(format!("`{}` on `{branch}` at `{head}`", dir.display()));
    if dirty > 0 {
        s.warn(format!("{dirty} uncommitted change(s) — someone is working here; use a separate worktree"));
    }

    // ── code ──
    s.heading("Code");
    let ts = sources(&dir, |path| project.replaces(path));
    let rs = sources(&dir, |path| project.is_rust(path));
    let (ts_src, ts_tests): (Vec<&SourceFile>, Vec<&SourceFile>) = ts.iter().partition(|f| !f.is_test);
    let ts_lines: usize = ts_src.iter().map(|f| f.lines).sum();
    let ts_test_lines: usize = ts_tests.iter().map(|f| f.lines).sum();
    let rs_lines: usize = rs.iter().map(|f| f.lines).sum();
    let ts_cases = count_matching(&dir, &ts, &["it(", "test(", "it.each", "test.each"]);
    let rs_cases = count_matching(&dir, &rs, &["#[test]", "#[tokio::test"]);
    s.info(format!(
        "TypeScript/JS to replace: {} lines in {} files; its tests: {} lines, about {} cases",
        thousands(ts_lines),
        ts_src.len(),
        thousands(ts_test_lines),
        thousands(ts_cases)
    ));
    s.info(format!(
        "Rust: {} lines in {} files, {} tests",
        thousands(rs_lines),
        rs.len(),
        thousands(rs_cases)
    ));
    for (path, reason) in &project.keep_ts {
        s.info(format!("`{path}` stays TypeScript: {reason}"));
    }
    if !rs.is_empty() && !ts_src.is_empty() {
        let rust_keys: BTreeSet<String> = rs.iter().map(|f| module_key(&f.path)).collect();
        let mut unmatched: Vec<&&SourceFile> =
            ts_src.iter().filter(|f| !rust_keys.contains(&module_key(&f.path))).collect();
        unmatched.sort_by(|a, b| b.lines.cmp(&a.lines));
        let unmatched_lines: usize = unmatched.iter().map(|f| f.lines).sum();
        let largest: Vec<String> =
            unmatched.iter().take(8).map(|f| format!("`{}` ({})", f.path, thousands(f.lines))).collect();
        s.info(format!(
            "by file name, {} of {} TypeScript modules have no Rust module of the same name ({} lines). \
             A rough signal only: Rust code is often organised differently.{}",
            unmatched.len(),
            ts_src.len(),
            thousands(unmatched_lines),
            if largest.is_empty() { String::new() } else { format!(" Largest: {}", largest.join(", ")) }
        ));
    }

    // ── parity ledger ──
    s.heading("Parity ledger");
    let ledger_path = home.join("parity").join(format!("{}.toml", project.name));
    let has_rust = !rs.is_empty();
    if ts_src.is_empty() {
        s.port = "no TypeScript left".into();
        s.ok("no TypeScript left to replace");
    } else if !ledger_path.is_file() {
        s.port = if has_rust { "started, not measured".into() } else { "not started".into() };
        s.todo(
            format!("no ledger at `parity/{}.toml`, so progress cannot be measured", project.name),
            "write the parity ledger",
        );
    } else {
        audit_ledger(&mut s, project, &dir, &ledger_path);
    }
    if !has_rust && !ts_src.is_empty() {
        s.todo("no Rust port exists yet", "start the Rust port");
    }

    // ── delivery ──
    s.heading("Delivery");
    audit_delivery(&mut s, project, &dir, offline);
    s
}

/// The file paths in a ledger location: `a.ts`, `a.ts:12`, `a.ts some words`,
/// or several of those separated by `;`.
fn locations(value: &str) -> impl Iterator<Item = &str> {
    value
        .split(';')
        .enumerate()
        .filter_map(|(i, part)| part.trim().split([':', ' ']).next().map(|file| (i, file)))
        // After the first location, a `;` may just be punctuation in a
        // description: only something that looks like a path is one.
        .filter(|(i, file)| !file.is_empty() && (*i == 0 || file.contains('/') || file.contains('.')))
        .map(|(_, file)| file)
}

/// The TypeScript sources that differ between `commit` and HEAD: the files
/// the "Code" section counts as TypeScript to replace, tests aside, and the
/// ones that were such files at `commit` and have been deleted or moved away
/// since. `None` when the checkout does not have the commit.
fn changed_typescript(project: &Project, dir: &Path, commit: &str) -> Option<Vec<String>> {
    // --no-renames lists a moved file under its old name as well, which is
    // where the ledger still points. --relative and -z give the paths the way
    // `git ls-files -z` does for the counts.
    let range = format!("{commit}..HEAD");
    let listed = git(dir, &["diff", "--name-only", "--no-renames", "--relative", "-z", &range])?;
    Some(
        listed
            .split('\0')
            .filter(|path| (project.replaces(path) || project.runs(path)) && !is_test_path(path))
            .map(String::from)
            .collect(),
    )
}

fn audit_ledger(s: &mut Section, project: &Project, dir: &Path, path: &Path) {
    let ledger: Ledger = match fs::read_to_string(path).map_err(|e| e.to_string()).and_then(|t| {
        toml::from_str(&t).map_err(|e| e.to_string())
    }) {
        Ok(ledger) => ledger,
        Err(e) => {
            s.port = "ledger unreadable".into();
            s.todo(format!("`parity/{}.toml` cannot be read: {e}", project.name), "fix the parity ledger");
            return;
        }
    };
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    let mut problems = Vec::new();
    for f in &ledger.feature {
        if !STATUSES.contains(&f.status.as_str()) {
            problems.push(format!("`{}` has unknown status `{}`", f.name, f.status));
            continue;
        }
        *counts.entry(f.status.as_str()).or_default() += 1;
        if f.status == "verified" {
            match &f.proof {
                None => problems.push(format!("`{}` is marked verified without a `proof`", f.name)),
                Some(proof) => {
                    for file in locations(proof) {
                        if !dir.join(file).exists() {
                            problems.push(format!("`{}`: proof `{file}` does not exist", f.name));
                        }
                    }
                }
            }
        }
        for (label, value) in [("ts", &f.ts), ("rs", &f.rs)] {
            if let Some(value) = value {
                for file in locations(value) {
                    if !dir.join(file).exists() {
                        problems.push(format!("`{}`: {label} path `{file}` does not exist", f.name));
                    }
                }
            }
        }
        if matches!(f.status.as_str(), "ported" | "verified" | "partial") && f.rs.is_none() {
            problems.push(format!("`{}` is {} but names no `rs` location", f.name, f.status));
        }
    }
    let get = |k: &str| counts.get(k).copied().unwrap_or(0);
    let total = ledger.feature.len() - get("dropped");
    s.port = format!(
        "{} verified, {} ported, {} partial, {} missing of {}",
        get("verified"),
        get("ported"),
        get("partial"),
        get("missing"),
        total
    );
    s.info(format!(
        "{} features: {} verified, {} ported but unproven, {} partial, {} missing, {} dropped",
        ledger.feature.len(),
        get("verified"),
        get("ported"),
        get("partial"),
        get("missing"),
        get("dropped")
    ));
    for problem in &problems {
        s.warn(problem);
    }

    // Has the TypeScript moved since the ledger was last checked against it?
    match &ledger.reconciled {
        None => s.todo("the ledger does not say which commit it was checked against (`reconciled`)", "reconcile the parity ledger"),
        Some(commit) => match changed_typescript(project, dir, commit) {
            None => s.warn(format!("ledger was reconciled at `{commit}`, which this checkout does not have")),
            Some(changed) if changed.is_empty() => {
                s.ok(format!("ledger is current (reconciled at `{commit}`, no TypeScript changed since)"));
            }
            Some(changed) => s.todo(
                format!(
                    "{} file(s) of the TypeScript changed since the ledger was reconciled at `{commit}`: {}",
                    changed.len(),
                    changed.iter().take(10).map(|p| format!("`{p}`")).collect::<Vec<_>>().join(", ")
                ),
                "reconcile the parity ledger",
            ),
        },
    }
    if get("missing") + get("partial") > 0 {
        s.todo(
            format!("{} feature(s) not fully ported", get("missing") + get("partial")),
            "port the missing features",
        );
    } else if get("ported") > 0 {
        s.todo(format!("{} ported feature(s) have no proof of parity", get("ported")), "add parity tests");
    }
}

fn audit_delivery(s: &mut Section, project: &Project, dir: &Path, offline: bool) {
    let platforms: BTreeMap<String, Json> = serde_json::from_str(PLATFORMS_JSON).expect("platforms.json");

    // Local crate.
    let cargo: Option<toml::Value> = project
        .manifest
        .as_ref()
        .and_then(|m| fs::read_to_string(dir.join(m)).ok())
        .and_then(|t| toml::from_str(&t).ok());
    let mut cargo_bins: Vec<String> = Vec::new();
    let mut cargo_version = None;
    if let Some(cargo) = &cargo {
        let package = cargo.get("package");
        let name = package.and_then(|p| p.get("name")).and_then(|v| v.as_str()).unwrap_or("");
        cargo_version = package.and_then(|p| p.get("version")).and_then(|v| v.as_str()).map(String::from);
        cargo_bins = cargo
            .get("bin")
            .and_then(|b| b.as_array())
            .map(|bins| bins.iter().filter_map(|b| b.get("name")?.as_str().map(String::from)).collect())
            .unwrap_or_default();
        if cargo_bins.is_empty() && !name.is_empty() {
            cargo_bins.push(name.to_string());
        }
        s.info(format!(
            "crate `{name}` {} builds: {}",
            cargo_version.as_deref().unwrap_or("?"),
            cargo_bins.iter().map(|b| format!("`{b}`")).collect::<Vec<_>>().join(", ")
        ));
        if let Some(wanted) = &project.crate_name {
            if wanted != name {
                s.todo(format!("crate is named `{name}`; it should be `{wanted}`"), "rename the crate");
            }
        }
    } else if project.manifest.is_some() {
        s.warn(format!("`{}` is missing or unreadable", project.manifest.as_deref().unwrap_or("")));
    }

    // Local npm package and its rustify configuration.
    let package: Option<Json> =
        fs::read_to_string(dir.join("package.json")).ok().and_then(|t| serde_json::from_str(&t).ok());
    let config = package.as_ref().and_then(|p| p.get("rustify"));
    if let Some(package) = &package {
        let intended = &package["publishConfig"]["bin"];
        if !intended.is_null() && *intended != package["bin"] {
            s.warn("`publishConfig.bin` differs from `bin`, and npm does not apply it when publishing: the published command is what `bin` names. The hand-back must go there too");
        }
    }
    let mut pipeline_ready = true;
    if cargo.is_none() {
        pipeline_ready = false;
    } else {
        // Every workflow of the project, to see whether one uses the shared pipeline.
        let workflows: String = fs::read_dir(dir.join(".github/workflows"))
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| e.path().extension().is_some_and(|x| x == "yml" || x == "yaml"))
                    .filter_map(|e| fs::read_to_string(e.path()).ok())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        let reference = |needle: &str| {
            workflows
                .lines()
                .filter(|line| !line.trim_start().starts_with('#'))
                .find_map(|line| line.split_once(needle))
                .map(|(_, rest)| rest.split_whitespace().next().unwrap_or("").to_string())
        };
        match reference(BUILD_WORKFLOW) {
            None => {
                pipeline_ready = false;
                s.todo(
                    "no workflow uses the shared build pipeline (`snomiao/rustify/.github/workflows/rust-npm-build.yml`)",
                    &format!("add the release workflow (`rustify vendor {}`)", project.name),
                );
            }
            Some(at) => {
                s.ok(format!("builds and smoke-tests every platform through the shared pipeline (`@{at}`)"));
                if workflows.lines().any(|l| l.trim_start().starts_with("parity:")) {
                    s.ok("the pipeline runs the project's parity tests before anything can be published");
                } else {
                    s.info("no `parity:` command is passed to the pipeline, so nothing compares Rust with TypeScript in CI");
                }
                match reference(PUBLISH_ACTION) {
                    Some(_) => s.ok("publishing goes through the shared pipeline"),
                    None => {
                        pipeline_ready = false;
                        s.todo(
                            "nothing publishes what the pipeline builds yet (no `snomiao/rustify/actions/publish` job)",
                            "wire the publish job into the project's release",
                        );
                    }
                }
            }
        }

        match config.and_then(|c| c.get("bins")).and_then(|b| b.as_object()) {
            None => {
                pipeline_ready = false;
                s.todo(
                    "`package.json` has no `rustify.bins` (which npm command runs which cargo bin)",
                    "add `rustify` to package.json",
                );
            }
            Some(bins) => {
                let unknown: Vec<String> = bins
                    .iter()
                    .filter_map(|(command, bin)| {
                        let bin = bin.as_str().unwrap_or("");
                        (!cargo_bins.iter().any(|b| b == bin)).then(|| format!("`{command}` → `{bin}`"))
                    })
                    .collect();
                if unknown.is_empty() {
                    let mode = config.and_then(|c| c.get("mode")).and_then(|m| m.as_str()).unwrap_or("native");
                    s.ok(format!("{} npm command(s) mapped to cargo bins, mode `{mode}`", bins.len()));
                } else {
                    pipeline_ready = false;
                    s.todo(
                        format!("`rustify.bins` names cargo bins the crate does not build: {}", unknown.join(", ")),
                        "fix `rustify.bins` in package.json",
                    );
                }
            }
        }
    }

    if offline {
        return;
    }

    // crates.io.
    if let Some(name) = &project.crate_name {
        match fetch(&format!("https://crates.io/api/v1/crates/{name}"), "application/json") {
            Err(e) => s.warn(format!("crates.io lookup failed: {e}")),
            Ok(None) => {
                if cargo.is_some() {
                    s.info(format!("crate `{name}` is not on crates.io (the name is free)"));
                }
            }
            Ok(Some(doc)) => {
                let published = doc["crate"]["max_version"].as_str().unwrap_or("?");
                let theirs = doc["crate"]["repository"].as_str().unwrap_or("");
                let ours = project.repo.as_deref().unwrap_or("\u{0}");
                if !theirs.to_lowercase().contains(&ours.to_lowercase()) {
                    s.warn(format!(
                        "`{name}` on crates.io belongs to another project ({}) — pick a different crate name",
                        if theirs.is_empty() { "no repository listed" } else { theirs }
                    ));
                } else {
                    s.ok(format!("crates.io has `{name}` {published}"));
                }
            }
        }
    }

    // npm: what does `bun i -g <name>` actually deliver today?
    let Some(name) = &project.npm else {
        s.install = "no npm package".into();
        return;
    };
    let doc = match fetch(
        &format!("https://registry.npmjs.org/{}", name.replace('/', "%2f")),
        "application/vnd.npm.install-v1+json",
    ) {
        Err(e) => {
            s.warn(format!("npm lookup failed: {e}"));
            return;
        }
        Ok(None) => {
            s.install = "nothing (not on npm)".into();
            s.todo(format!("`{name}` is not on npm"), "publish the package");
            return;
        }
        Ok(Some(doc)) => doc,
    };
    let latest = doc["dist-tags"]["latest"].as_str().unwrap_or("").to_string();
    let manifest = &doc["versions"][&latest];
    let local_version = package.as_ref().and_then(|p| p["version"].as_str()).unwrap_or("");
    s.info(format!("npm has `{name}` {latest}"));
    // A checkout whose newest release tag is older than npm is behind, and the
    // counts above describe old code.
    if let Some(tag) = git(dir, &["describe", "--tags", "--abbrev=0"]) {
        if tag.trim_start_matches('v') != latest {
            s.warn(format!(
                "the newest release tag in this checkout is `{tag}` — it is behind npm; fetch before trusting the code counts"
            ));
        }
    }
    if let Some(cargo_version) = &cargo_version {
        if *cargo_version != latest {
            s.info(format!(
                "Cargo.toml says {cargo_version} and package.json says {}; at release the workflow stamps one version into the binary and the package",
                if local_version.is_empty() { "nothing" } else { local_version }
            ));
        }
    }
    // A project may declare that it ships fewer platforms (rustify.platforms).
    let declared: Option<Vec<String>> = config
        .and_then(|c| c.get("platforms"))
        .and_then(|p| p.as_array())
        .map(|list| list.iter().filter_map(|k| k.as_str().map(String::from)).collect());
    let platforms: BTreeMap<String, Json> = match &declared {
        Some(keys) => {
            s.info(format!(
                "ships {} of {} platforms by its own declaration: {}",
                keys.len(),
                platforms.len(),
                keys.join(", ")
            ));
            platforms.into_iter().filter(|(k, _)| keys.contains(k)).collect()
        }
        None => platforms,
    };
    let optional = manifest["optionalDependencies"].as_object();
    let mut native = Vec::new();
    let mut broken = Vec::new();
    for (key, platform) in &platforms {
        let alias = format!("{name}-{key}");
        let expected = format!("npm:{name}@{latest}-{key}");
        match optional.and_then(|o| o.get(&alias)).and_then(|v| v.as_str()) {
            Some(spec) if spec == expected => {
                let build = &doc["versions"][format!("{latest}-{key}")];
                if build.is_null() {
                    broken.push(format!("{key}: `{latest}-{key}` is not published"));
                } else if build["os"] != platform["os"] || build["cpu"] != platform["cpu"] {
                    broken.push(format!("{key}: wrong os/cpu on `{latest}-{key}`"));
                } else {
                    native.push(key.as_str());
                }
            }
            Some(spec) => broken.push(format!("{key}: points at `{spec}`, expected `{expected}`")),
            None => {}
        }
    }
    let bins: Vec<String> = match &manifest["bin"] {
        Json::Object(map) => map.iter().map(|(k, v)| format!("`{k}` → `{}`", v.as_str().unwrap_or("?"))).collect(),
        Json::String(target) => vec![format!("`{name}` → `{target}`")],
        _ => Vec::new(),
    };
    if manifest["hasInstallScript"] == Json::Bool(true) {
        s.warn("the published package has an install script; bun does not run those for global installs unless the user trusts the package");
    }
    if native.len() == platforms.len() && broken.is_empty() {
        s.install = "native binary, all platforms".into();
        s.ok(format!("`bun i -g {name}` installs the native binary on all {} platforms", platforms.len()));
    } else if !native.is_empty() || !broken.is_empty() {
        let lacking: Vec<&str> =
            platforms.keys().map(String::as_str).filter(|k| !native.contains(k)).collect();
        s.install = format!("native binary on {} of {} platforms", native.len(), platforms.len());
        s.todo(
            format!("published natively for {} only; not for {}", native.join(", "), lacking.join(", ")),
            "release for every platform",
        );
        for problem in broken {
            s.warn(problem);
        }
    } else {
        s.install = "JavaScript".into();
        let shown = if bins.len() > 4 {
            format!("{}, … ({} commands)", bins[..3].join(", "), bins.len())
        } else {
            bins.join(", ")
        };
        let next = if pipeline_ready {
            "run the release workflow with publish on"
        } else if cargo.is_none() {
            "start the Rust port"
        } else {
            "finish the release pipeline, then release"
        };
        s.todo(format!("`bun i -g {name}` installs JavaScript, not the Rust binary ({shown})"), next);
    }
}

// ───────────────────────────────── vendor ──────────────────────────────────

/// Workflow `paths:` lines for the directories that hold a project's
/// TypeScript: `src` is `"src/**"`, the repository root is every file with
/// one of the extensions the audit counts there.
fn ts_paths(dirs: &[String]) -> String {
    let mut lines = Vec::new();
    for dir in dirs {
        match tidy(dir) {
            "." | "" => lines.extend(SCRIPT_EXTENSIONS.iter().map(|e| format!("      - \"**.{e}\""))),
            dir => lines.push(format!("      - \"{dir}/**\"")),
        }
    }
    lines.join("\n")
}

/// Workflow `paths:` lines for the crate: all of its directory, or, for a
/// crate at the repository root, its manifest, lock file and build script and
/// the directories `rust` names (`src` when it names none).
fn rust_paths(manifest: &str, rust_dirs: &[String]) -> String {
    if let Some((crate_dir, _)) = tidy(manifest).rsplit_once('/') {
        return format!("      - \"{crate_dir}/**\"");
    }
    let mut lines: Vec<String> =
        ["Cargo.toml", "Cargo.lock", "build.rs"].iter().map(|file| format!("      - \"{file}\"")).collect();
    let default = ["src".to_string()];
    for dir in if rust_dirs.is_empty() { &default[..] } else { rust_dirs } {
        lines.push(match tidy(dir) {
            "." | "" => "      - \"**.rs\"".to_string(),
            dir => format!("      - \"{dir}/**\""),
        });
    }
    lines.join("\n")
}

/// The JavaScript file each command of a package runs, as published:
/// command name → file, relative to the package root. That is `bin`.
/// `publishConfig.bin` is not it: npm does not apply it when publishing
/// (pnpm and yarn do), so packages published with npm run `bin`.
fn js_entries(package: &Json) -> Vec<(String, String)> {
    let bin = &package["bin"];
    let clean = |file: &str| file.trim_start_matches("./").to_string();
    match bin {
        Json::String(file) => {
            let name = package["name"].as_str().unwrap_or("").rsplit('/').next().unwrap_or("").to_string();
            vec![(name, clean(file))]
        }
        Json::Object(map) => map
            .iter()
            .filter_map(|(command, file)| Some((command.clone(), clean(file.as_str()?))))
            .collect(),
        _ => Vec::new(),
    }
}

/// The part of `main.rs` that says which JavaScript file to hand back to.
/// One constant when every command runs the same file; otherwise a lookup by
/// the name the binary was started as.
fn entry_code(entries: &[(String, String)]) -> (String, String) {
    let first = &entries[0].1;
    if entries.iter().all(|(_, file)| file == first) {
        return (
            format!("/// The package's JavaScript entry, relative to the package root.\nconst JS_ENTRY: &str = \"{first}\";\n"),
            "JS_ENTRY".to_string(),
        );
    }
    let mut code = String::from(
        "/// The command this binary was started as.\nfn command() -> String {\n    std::env::args_os()\n        .next()\n        .map(std::path::PathBuf::from)\n        .and_then(|path| path.file_stem().map(|stem| stem.to_string_lossy().into_owned()))\n        .unwrap_or_default()\n}\n\n/// The JavaScript entry of each command, relative to the package root.\nfn js_entry(command: &str) -> &'static str {\n    match command {\n",
    );
    for (command, file) in &entries[1..] {
        let _ = writeln!(code, "        \"{command}\" => \"{file}\",");
    }
    let _ = writeln!(code, "        _ => \"{first}\", // {}\n    }}\n}}", entries[0].0);
    (code, "js_entry(&command())".to_string())
}

/// A crate's `.gitignore`: what the file already says, byte for byte, and
/// `/target` on a line of its own, ended the way the file ends its lines. A
/// crate at the repository root shares that file with the rest of the
/// project. `None` for a file with NUL bytes in it (UTF-16, which Windows
/// PowerShell 5 writes with `>`): appending to it would garble it, so it is
/// left as it is.
fn ignoring_target(existing: &[u8]) -> Option<Vec<u8>> {
    if existing.contains(&0) {
        return None;
    }
    let ignores = existing
        .split(|byte| *byte == b'\n')
        .any(|line| matches!(line.trim_ascii(), b"target" | b"/target" | b"target/" | b"/target/"));
    let mut text = existing.to_vec();
    if !ignores {
        let newline: &[u8] = if existing.windows(2).any(|pair| pair == b"\r\n") { b"\r\n" } else { b"\n" };
        if !text.is_empty() && !text.ends_with(b"\n") {
            text.extend_from_slice(newline);
        }
        text.extend_from_slice(b"/target");
        text.extend_from_slice(newline);
    }
    Some(text)
}

/// What `rustify scaffold` writes into a checkout, and what it tells the
/// user afterwards.
struct CratePlan {
    files: Vec<(PathBuf, Vec<u8>)>,
    /// A `.gitignore` that is left as it is, though it does not ignore
    /// `/target`.
    kept: Option<PathBuf>,
    next: String,
}

fn plan_crate(project: &Project, home: &Path, dir: &Path) -> Result<CratePlan, String> {
    let name = &project.name;
    let manifest = project.manifest.clone().unwrap_or_else(|| "rs/Cargo.toml".to_string());
    let crate_dir = dir.join(&manifest).parent().map(Path::to_path_buf).unwrap_or_else(|| dir.to_path_buf());
    if dir.join(&manifest).exists() {
        return Err(format!("{} already exists — nothing to scaffold", dir.join(&manifest).display()));
    }
    let package: Json = fs::read_to_string(dir.join("package.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .ok_or_else(|| format!("{name} has no readable package.json"))?;
    let entries = js_entries(&package);
    if entries.is_empty() {
        return Err(format!("package.json of {name} has no `bin`, so there is no command to take over"));
    }
    let (entry_definition, entry_expression) = entry_code(&entries);
    let entry = if entry_expression == "JS_ENTRY" {
        format!("`{}`", entries[0].1)
    } else {
        "the JavaScript file of the command it was started as".to_string()
    };
    let crate_name = project.crate_name.clone().unwrap_or_else(|| project.name.clone());
    let commands: Vec<String> = match &package["bin"] {
        Json::Object(map) => map.keys().cloned().collect(),
        _ => vec![package["name"].as_str().unwrap_or(&crate_name).to_string()],
    };
    let license = package["license"].as_str().unwrap_or("MIT");
    let description = package["description"].as_str().unwrap_or("").replace('\\', "\\\\").replace('"', "\\\"");
    let root_env = format!("{}_PACKAGE_ROOT", crate_name.to_uppercase().replace(['-', '.'], "_"));
    let cargo_toml = format!(
        "[package]\nname = \"{crate_name}\"\nversion = \"0.0.0\"\nedition = \"2021\"\ndescription = \"{description}\"\nlicense = \"{license}\"\n\n[[bin]]\nname = \"{crate_name}\"\npath = \"src/main.rs\"\n\n[profile.release]\nopt-level = 3\nlto = \"thin\"\nstrip = true\n"
    );
    let templates = home.join("templates/rust");
    let main_rs = fs::read_to_string(templates.join("main.rs"))
        .expect("templates/rust/main.rs")
        .replace("__NAME__", &crate_name)
        .replace("__ENV__", &crate_name.to_uppercase().replace(['-', '.'], "_"))
        .replace("__JS_ENTRY_DEFINITION__\n", &entry_definition)
        .replace("__JS_ENTRY_EXPRESSION__", &entry_expression);
    let fallback = fs::read_to_string(templates.join("js_fallback.rs"))
        .expect("templates/rust/js_fallback.rs")
        .replace("\"RUSTIFY_PACKAGE_ROOT\"", &format!("\"{root_env}\""));
    let mut files = vec![
        (crate_dir.join("Cargo.toml"), cargo_toml.into_bytes()),
        (crate_dir.join("src/main.rs"), main_rs.into_bytes()),
        (crate_dir.join("src/js_fallback.rs"), fallback.into_bytes()),
    ];
    let gitignore = crate_dir.join(".gitignore");
    let ignored = match fs::read(&gitignore) {
        Ok(existing) => ignoring_target(&existing),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => ignoring_target(b""),
        Err(_) => None,
    };
    let kept = match ignored {
        Some(text) => {
            files.push((gitignore, text));
            None
        }
        None => Some(gitignore),
    };
    let bins: Vec<String> = commands.iter().map(|c| format!("\"{c}\": \"{crate_name}\"")).collect();
    let next = format!(
        "\nThe binary hands every command to {entry}, so nothing changes for users yet.\n\nNext:\n  1. add to package.json:\n       \"rustify\": {{ \"mode\": \"hybrid\", \"bins\": {{ {} }}, \"rootEnv\": \"{root_env}\" }}\n  2. set `manifest = \"{manifest}\"` and `rust = [...]` for {name} in projects.toml\n  3. `rustify vendor {name}` adds the release workflow\n  4. build it (`cargo build --release --manifest-path {manifest}`) and commit Cargo.lock\nNothing was committed.",
        bins.join(", ")
    );
    Ok(CratePlan { files, kept, next })
}

fn scaffold(args: &[String]) -> i32 {
    let dry = args.iter().any(|a| a == "--dry-run");
    let names = positional(args);
    let Some(name) = names.first().copied() else {
        eprintln!("usage: rustify scaffold <project> [--at <checkout>] [--dry-run]");
        return 2;
    };
    let home = home();
    let registry = load_registry(&home);
    let Some(project) = registry.project.iter().find(|p| &p.name == name) else {
        eprintln!("rustify: no project named {name} in projects.toml");
        return 2;
    };
    let Some(dir) = at(args).filter(|d| d.is_dir()).or_else(|| locate(project, &checkout_root(&home))) else {
        eprintln!("rustify: no checkout of {name} found");
        return 1;
    };
    let plan = match plan_crate(project, &home, &dir) {
        Ok(plan) => plan,
        Err(e) => {
            eprintln!("rustify: {e}");
            return 1;
        }
    };
    for (file, content) in &plan.files {
        if !dry {
            fs::create_dir_all(file.parent().unwrap()).expect("create crate directory");
            fs::write(file, content).expect("write crate file");
        }
        say!("{} {}", if dry { "would write" } else { "wrote      " }, file.display());
    }
    if let Some(file) = &plan.kept {
        say!(
            "{} {} — it cannot be added to safely (UTF-16, or unreadable): make it ignore /target yourself",
            if dry { "would keep " } else { "kept       " },
            file.display()
        );
    }
    say!("{}", plan.next);
    0
}

fn vendor(args: &[String]) -> i32 {
    let dry = args.iter().any(|a| a == "--dry-run");
    let names = positional(args);
    let Some(name) = names.first().copied() else {
        eprintln!("usage: rustify vendor <project> [--at <checkout>] [--dry-run]");
        return 2;
    };
    let home = home();
    let registry = load_registry(&home);
    let Some(project) = registry.project.iter().find(|p| &p.name == name) else {
        eprintln!("rustify: no project named {name} in projects.toml");
        return 2;
    };
    let Some(dir) = at(args).filter(|d| d.is_dir()).or_else(|| locate(project, &checkout_root(&home))) else {
        eprintln!("rustify: no checkout of {name} found");
        return 1;
    };
    // projects.toml may not know about a crate that was only just scaffolded.
    let default_manifest = "rs/Cargo.toml".to_string();
    let manifest = match &project.manifest {
        Some(manifest) => manifest,
        None if dir.join(&default_manifest).is_file() => &default_manifest,
        None => {
            eprintln!("rustify: {name} has no crate yet (no `manifest` in projects.toml, no rs/Cargo.toml) — run `rustify scaffold {name}` first");
            return 1;
        }
    };
    let workflow = dir.join(".github/workflows").join(WORKFLOW);
    if workflow.exists() {
        say!("kept        {} (adapted per project, never overwritten)", workflow.display());
        return 0;
    }

    // Fill the template from what the project already declares.
    let cargo: Option<toml::Value> =
        fs::read_to_string(dir.join(manifest)).ok().and_then(|t| toml::from_str(&t).ok());
    let package: Option<Json> =
        fs::read_to_string(dir.join("package.json")).ok().and_then(|t| serde_json::from_str(&t).ok());
    let mapped = package.as_ref().and_then(|p| p["rustify"]["bins"].as_object());
    let mut bins: Vec<String> = match mapped {
        Some(map) => map.values().filter_map(|v| v.as_str().map(String::from)).collect(),
        None => cargo
            .as_ref()
            .and_then(|c| c.get("bin")?.as_array().cloned())
            .map(|bins| bins.iter().filter_map(|b| b.get("name")?.as_str().map(String::from)).collect())
            .unwrap_or_default(),
    };
    bins.sort();
    bins.dedup();
    if bins.is_empty() {
        bins.push(project.name.clone());
    }
    let command = mapped.and_then(|map| map.keys().next().cloned()).unwrap_or_else(|| bins[0].clone());
    let template = fs::read_to_string(home.join("templates/github").join(WORKFLOW)).expect("workflow template");
    let text = template
        .replace("__MANIFEST__", manifest)
        .replace("__BINS__", &bins.join(" "))
        .replace("__SMOKE__", &format!("{command} --version"))
        .replace("      - \"__RUST_DIR__/**\"", &rust_paths(manifest, &project.rust))
        .replace("__TS_PATHS__", &ts_paths(&project.ts));
    if !dry {
        fs::create_dir_all(workflow.parent().unwrap()).expect("create workflows directory");
        fs::write(&workflow, text).expect("write workflow");
    }
    say!(
        "{} {} — check the values under `with:`",
        if dry { "would write" } else { "wrote      " },
        workflow.display()
    );
    say!("\nNothing was committed. Next: `rustify audit {name}` lists what is still missing.");
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_names_match_across_naming_styles() {
        assert_eq!(module_key("ts/pidStore.ts"), module_key("rs/src/pid_store.rs"));
        assert_eq!(module_key("ts/agentShare.bun.spec.ts"), "agentshare");
        assert_ne!(module_key("ts/todoStore.ts"), module_key("rs/src/pid_store.rs"));
    }

    #[test]
    fn tests_are_told_apart_from_sources() {
        assert!(is_test_path("ts/pidStore.spec.ts"));
        assert!(is_test_path("tests/send.test.ts"));
        assert!(is_test_path("web/src/__tests__/runtime.test.ts"));
        assert!(!is_test_path("ts/attest.ts"));
        assert!(!is_test_path("ts/cli.ts"));
    }

    #[test]
    fn paths_are_matched_by_whole_components() {
        assert!(is_under("ts/vendor/x.ts", "ts/vendor"));
        assert!(!is_under("ts/vendored.ts", "ts/vendor"));
        assert!(is_under("anything.ts", "."));
    }

    #[test]
    fn ledger_locations_split_into_paths() {
        let found: Vec<&str> = locations("ts/tail.ts; ts/cli.ts:8860 dispatch").collect();
        assert_eq!(found, ["ts/tail.ts", "ts/cli.ts"]);
        assert_eq!(locations("rs/src/main.rs").collect::<Vec<_>>(), ["rs/src/main.rs"]);
        assert_eq!(locations(" ; ").count(), 0);
        let found: Vec<&str> = locations("rs/parity.json 600 cases; a write-up follows; tests/x.test.ts").collect();
        assert_eq!(found, ["rs/parity.json", "tests/x.test.ts"]);
    }

    #[test]
    fn the_published_bin_is_the_js_entry() {
        let entries = |text: &str| js_entries(&serde_json::from_str(text).unwrap());
        // npm publishes `bin` and ignores publishConfig.bin.
        assert_eq!(
            entries(r#"{"bin":{"slack":"./ts/cli.ts"},"publishConfig":{"bin":{"slack":"./dist/cli.js"}}}"#),
            [("slack".to_string(), "ts/cli.ts".to_string())]
        );
        assert_eq!(entries(r#"{"name":"@me/x","bin":"cli.mjs"}"#), [("x".to_string(), "cli.mjs".to_string())]);
        assert!(entries(r#"{"name":"x"}"#).is_empty());
    }

    #[test]
    fn typescript_directories_become_workflow_paths() {
        assert_eq!(ts_paths(&["src".to_string(), "bin/".to_string()]), "      - \"src/**\"\n      - \"bin/**\"");
        // At the root, every extension the audit counts: `**.ts` alone would
        // miss a project written in .tsx or .mjs.
        let root = ts_paths(&["./".to_string()]);
        assert_eq!(root.lines().count(), SCRIPT_EXTENSIONS.len());
        assert!(root.starts_with("      - \"**.ts\"\n      - \"**.tsx\"\n"), "{root}");
        assert!(root.ends_with("      - \"**.cjs\""), "{root}");
    }

    #[test]
    fn the_crate_becomes_workflow_paths() {
        let dirs = |list: &[&str]| list.iter().map(|d| d.to_string()).collect::<Vec<_>>();
        assert_eq!(rust_paths("rs/Cargo.toml", &dirs(&["rs/src"])), "      - \"rs/**\"");
        assert_eq!(rust_paths("tools/cli/Cargo.toml", &[]), "      - \"tools/cli/**\"");
        // A crate at the repository root has no directory of its own to name.
        let root = "      - \"Cargo.toml\"\n      - \"Cargo.lock\"\n      - \"build.rs\"\n";
        assert_eq!(rust_paths("Cargo.toml", &dirs(&["src"])), format!("{root}      - \"src/**\""));
        assert_eq!(rust_paths("./Cargo.toml", &[]), format!("{root}      - \"src/**\""));
        assert_eq!(
            rust_paths("Cargo.toml", &dirs(&["rs", "crates/"])),
            format!("{root}      - \"rs/**\"\n      - \"crates/**\"")
        );
        assert_eq!(rust_paths("Cargo.toml", &dirs(&["."])), format!("{root}      - \"**.rs\""));
        // The line of the template these replace.
        let template = include_str!("../templates/github/rust-npm-release.yml");
        assert!(template.contains("\n      - \"__RUST_DIR__/**\"\n__TS_PATHS__\n"));
    }

    #[test]
    fn one_entry_is_a_constant_and_several_are_a_lookup() {
        let same = [("rech".to_string(), "r.ts".to_string()), ("rechrome".to_string(), "r.ts".to_string())];
        let (definition, expression) = entry_code(&same);
        assert!(definition.contains("const JS_ENTRY: &str = \"r.ts\";"));
        assert_eq!(expression, "JS_ENTRY");
        let different = [("feat".to_string(), "dist/feat.js".to_string()), ("fix".to_string(), "dist/fix.js".to_string())];
        let (definition, expression) = entry_code(&different);
        assert!(definition.contains("\"fix\" => \"dist/fix.js\","));
        assert!(definition.contains("_ => \"dist/feat.js\", // feat"));
        assert_eq!(expression, "js_entry(&command())");
    }

    #[test]
    fn scaffolding_adds_to_a_gitignore_that_is_already_there() {
        let merged = |existing: &[u8]| ignoring_target(existing).map(|text| String::from_utf8_lossy(&text).into_owned());
        assert_eq!(merged(b"").unwrap(), "/target\n");
        assert_eq!(merged(b"node_modules\n.env").unwrap(), "node_modules\n.env\n/target\n");
        assert_eq!(merged(b"node_modules\n/target/\n.env\n").unwrap(), "node_modules\n/target/\n.env\n");
        assert_eq!(merged(b"node_modules\r\n/target\r\n").unwrap(), "node_modules\r\n/target\r\n");
        // In the file's own line ending.
        assert_eq!(merged(b"node_modules\r\n.env").unwrap(), "node_modules\r\n.env\r\n/target\r\n");
        // Bytes that are not UTF-8 (a Latin-1 comment) are kept as they are.
        assert_eq!(ignoring_target(b"# caf\xe9\ndist\n").unwrap(), b"# caf\xe9\ndist\n/target\n");
        // UTF-16 is left alone.
        let utf16: Vec<u8> = "\u{feff}node_modules\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(ignoring_target(&utf16), None);
    }

    #[test]
    fn scaffolding_writes_the_project_gitignore_with_its_own_lines_kept() {
        let checkout = Scratch::new();
        checkout.write("package.json", "{ \"name\": \"w\", \"bin\": { \"w\": \"cli.ts\" } }\n");
        let home = Path::new(env!("CARGO_MANIFEST_DIR"));
        let written = |block: &str, file: &str| -> Option<Vec<u8>> {
            let plan = plan_crate(&project(block), home, &checkout.dir).expect("a plan");
            assert!(plan.files.iter().any(|(path, _)| path.ends_with("src/main.rs")));
            plan.files.into_iter().find(|(path, _)| *path == checkout.dir.join(file)).map(|(_, text)| text)
        };

        // A crate at the repository root shares the project's .gitignore.
        fs::write(checkout.dir.join(".gitignore"), b"node_modules\n# caf\xe9\ndist\n.env\n").unwrap();
        let root = "name = \"w\"\nmanifest = \"Cargo.toml\"";
        assert_eq!(written(root, ".gitignore").unwrap(), b"node_modules\n# caf\xe9\ndist\n.env\n/target\n");
        let utf16: Vec<u8> = "\u{feff}node_modules\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
        fs::write(checkout.dir.join(".gitignore"), &utf16).unwrap();
        assert_eq!(written(root, ".gitignore"), None);
        let plan = plan_crate(&project(root), home, &checkout.dir).unwrap();
        assert_eq!(plan.kept, Some(checkout.dir.join(".gitignore")));

        // A crate in a directory of its own gets a .gitignore of its own.
        assert_eq!(written("name = \"w\"", "rs/.gitignore").unwrap(), b"/target\n");
        assert_eq!(written("name = \"w\"", ".gitignore"), None);
    }

    #[test]
    fn at_and_positional_arguments_are_told_apart() {
        let args: Vec<String> = ["--at", "/w/x", "genvx", "--dry-run"].iter().map(|s| s.to_string()).collect();
        assert_eq!(at(&args), Some(PathBuf::from("/w/x")));
        assert_eq!(positional(&args), [&"genvx".to_string()]);
        let args: Vec<String> = ["genvx".to_string()].to_vec();
        assert_eq!(at(&args), None);
        assert_eq!(positional(&args).len(), 1);
    }

    #[test]
    fn numbers_get_thousands_separators() {
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(44306), "44,306");
        assert_eq!(thousands(1234567), "1,234,567");
    }

    #[test]
    fn the_platform_list_is_six_complete_entries() {
        let platforms: BTreeMap<String, Json> = serde_json::from_str(PLATFORMS_JSON).unwrap();
        assert_eq!(platforms.len(), 6);
        for (key, platform) in &platforms {
            assert!(platform["triple"].is_string(), "{key} has no triple");
            assert!(platform["os"].is_array() && platform["cpu"].is_array(), "{key} lacks os/cpu");
        }
    }

    #[test]
    fn a_directory_may_be_spelled_with_a_leading_dot_or_a_trailing_slash() {
        assert!(is_under("src/cli.ts", "./src/"));
        assert!(is_under("cli.ts", "./"));
        assert!(!is_under("srcs/cli.ts", "./src"));
        let dirs = [".".to_string(), "./rs/".to_string(), "rs/src".to_string(), "docs".to_string()];
        assert_eq!(deepest("rs/src/main.rs", &dirs), Some(2));
        assert_eq!(deepest("rs/build.rs", &dirs), Some(1));
        assert_eq!(deepest("cli.ts", &dirs), Some(0));
        assert_eq!(deepest("cli.ts", &dirs[1..]), None);
    }

    /// A project as one `[[project]]` block of projects.toml declares it.
    fn project(block: &str) -> Project {
        toml::from_str(block).expect("project block")
    }

    #[test]
    fn rust_listed_inside_an_ignored_directory_is_still_rust() {
        let p = project(
            r#"
            name = "dede"
            ts = ["."]
            rust = ["rs/src"]
            ignore = ["rs", "skills", "rs/src/generated"]
            "#,
        );
        assert!(p.is_rust("rs/src/main.rs"));
        assert!(p.is_rust("rs/src/commands/get.rs"));
        // An ignore entry inside the rust directory is still honoured.
        assert!(!p.is_rust("rs/src/generated/table.rs"));
        // Only what `rust` lists comes back out of the ignored directory.
        assert!(!p.is_rust("rs/build.rs"));
        assert!(!p.is_rust("skills/tool/src/main.rs"));
        assert!(!p.is_rust("rs/src/main.rs.txt"));
        // The port's own scripts stay out of the TypeScript count.
        assert!(p.replaces("dede.ts"));
        assert!(p.replaces("dede.test.ts"));
        assert!(!p.replaces("rs/parity.gen.mjs"));
        assert!(!p.replaces("rs/src/vectors.mjs"));
        assert!(!p.replaces("skills/setup/run.mjs"));
        assert!(!p.replaces("primitives.d.ts"));
        assert!(!p.replaces("package.json"));
        // A file that is merely called like an extension is not a script.
        assert!(!p.replaces("ts"));
        assert!(!p.replaces("bin/js"));

        // The same directory under both: listing it under `rust` wins.
        let p = project("name = \"x\"\nts = [\"ts\"]\nrust = [\"rs\"]\nignore = [\"rs\"]");
        assert!(p.is_rust("rs/main.rs"));
    }

    #[test]
    fn a_crate_that_shares_its_directories_with_the_typescript_hides_none_of_it() {
        // The crate at the repository root, the TypeScript in its own directory.
        let p = project("name = \"x\"\nmanifest = \"Cargo.toml\"\nts = [\"ts\"]\nrust = [\".\"]\nignore = [\"vendor\"]");
        assert!(p.replaces("ts/cli.ts"));
        assert!(p.is_rust("src/main.rs"));
        assert!(p.is_rust("build.rs"));
        assert!(!p.is_rust("vendor/dep/src/lib.rs"));
        assert!(!p.replaces("vendor/dep/index.js"));

        // Both at the root, and both in the same directory: the extension decides.
        for dir in [".", "src"] {
            let p = project(&format!("name = \"x\"\nmanifest = \"Cargo.toml\"\nts = [\"{dir}\"]\nrust = [\"{dir}\"]"));
            assert!(p.replaces("src/cli.ts"), "{dir}");
            assert!(p.is_rust("src/main.rs"), "{dir}");
        }

        // The TypeScript at the root and a crate at the root whose sources
        // are in src, beside the TypeScript's own (winrpc has all of its
        // TypeScript in src).
        for manifest in ["manifest = \"Cargo.toml\"\n", "manifest = \"./Cargo.toml\"\n", ""] {
            let p = project(&format!("name = \"x\"\n{manifest}ts = [\".\"]\nrust = [\"src\"]"));
            assert!(p.replaces("src/index.ts"), "{manifest}");
            assert!(p.replaces("src/gen.mjs"), "{manifest}");
            assert!(p.is_rust("src/main.rs"), "{manifest}");
        }

        // A package directory that holds both the TypeScript and the crate.
        let p = project(
            "name = \"x\"\nmanifest = \"packages/cli/Cargo.toml\"\nts = [\"packages/cli\"]\nrust = [\"packages/cli/src\"]",
        );
        assert!(p.replaces("packages/cli/src/index.ts"));
        assert!(p.is_rust("packages/cli/src/main.rs"));

        // A `rust` directory that holds the whole repository.
        let p = project("name = \"x\"\nmanifest = \"rs/Cargo.toml\"\nts = [\".\"]\nrust = [\".\"]");
        assert!(p.replaces("cli.ts"));
    }

    #[test]
    fn scripts_in_the_rust_directories_of_a_crate_of_its_own_belong_to_the_port() {
        // The TypeScript at the root and the crate in rs/, with or without a
        // manifest in projects.toml (`rustify scaffold` puts the crate in rs/).
        for manifest in ["manifest = \"rs/Cargo.toml\"\n", ""] {
            let p = project(&format!(
                "name = \"x\"\n{manifest}ts = [\".\"]\nrust = [\"rs/src\"]\nkeep_ts = {{ \"extension\" = \"runs in the browser\" }}"
            ));
            assert!(p.replaces("cli.ts"), "{manifest}");
            assert!(p.replaces("lib/util.mjs"), "{manifest}");
            assert!(!p.replaces("rs/src/vectors.mjs"), "{manifest}");
            // Outside the `rust` directories only `ignore = ["rs"]` takes it out.
            assert!(p.replaces("rs/parity.gen.mjs"), "{manifest}");
            assert!(!p.replaces("extension/background.js"), "{manifest}");
            assert!(p.is_rust("rs/src/main.rs"), "{manifest}");
        }
        // The same below a `ts` directory other than the root.
        let p = project("name = \"x\"\nmanifest = \"pkg/rs/Cargo.toml\"\nts = [\"pkg\"]\nrust = [\"pkg/rs/src\"]");
        assert!(p.replaces("pkg/cli.ts"));
        assert!(!p.replaces("pkg/rs/src/vectors.mjs"));
    }

    #[test]
    fn the_typescript_of_a_project_with_its_crate_at_the_root_is_counted() {
        let repo = Scratch::new();
        repo.git(&["init", "--quiet"]);
        repo.write("src/index.ts", "export const a = 1;\n");
        repo.write("src/rpc.ts", "export const b = 1;\nexport const c = 2;\n");
        repo.write("test/a.test.ts", "test(\"x\", () => {});\n");
        repo.write("package.json", "{ \"name\": \"w\" }\n");
        repo.write("Cargo.toml", "[package]\nname = \"w\"\nversion = \"0.0.0\"\n");
        repo.write("src/main.rs", "fn main() {}\n");
        repo.commit("the TypeScript and a crate");
        let home = Scratch::new();
        let p = project("name = \"w\"\nmanifest = \"Cargo.toml\"\nts = [\".\"]\nrust = [\"src\"]");
        let section = audit_project(&p, &home.dir, &home.dir, true, Some(&repo.dir));
        let body = &section.body;
        assert!(body.contains("TypeScript/JS to replace: 3 lines in 2 files; its tests: 1 lines"), "{body}");
        assert!(body.contains("Rust: 1 lines in 1 files"), "{body}");
        assert!(!body.contains("no TypeScript left"), "{body}");
        assert_eq!(section.next.as_deref(), Some("write the parity ledger"));
    }

    /// A directory of its own in the temp directory, removed when dropped.
    struct Scratch {
        dir: PathBuf,
    }

    impl Scratch {
        fn new() -> Scratch {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            loop {
                let n = NEXT.fetch_add(1, Ordering::Relaxed);
                let dir = env::temp_dir().join(format!("rustify-audit-test-{}-{n}", std::process::id()));
                match fs::create_dir(&dir) {
                    Ok(()) => return Scratch { dir },
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(e) => panic!("cannot create {}: {e}", dir.display()),
                }
            }
        }

        fn write(&self, path: &str, text: &str) {
            let file = self.dir.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, text).unwrap();
        }

        fn git(&self, args: &[&str]) -> String {
            let out = git_command(&self.dir)
                .args(["-c", "user.name=rustify test", "-c", "user.email=test@example.invalid"])
                .args(["-c", "commit.gpgsign=false"])
                .args(args)
                .output()
                .expect("git");
            assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        }

        /// Commits everything in the directory and returns the short commit id.
        fn commit(&self, message: &str) -> String {
            self.git(&["add", "--all"]);
            self.git(&["commit", "--quiet", "--no-verify", "--message", message]);
            self.git(&["rev-parse", "--short", "HEAD"])
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    /// A repository shaped like a small tool whose TypeScript is at the root
    /// and whose port lives in `rs/`: the first commit is the TypeScript, the
    /// second adds the port. Returns it with the id of the first commit.
    fn ported_repository() -> (Scratch, String) {
        let repo = Scratch::new();
        repo.git(&["init", "--quiet"]);
        repo.write("dede.ts", "#!/usr/bin/env bun\nconsole.log(1);\n");
        repo.write("dede.test.ts", "test(\"prints\", () => {});\n");
        repo.write("备注 notes.ts", "export {};\nexport {};\n");
        repo.write("primitives.d.ts", "export {};\n");
        repo.write("package.json", "{ \"name\": \"dede\", \"bin\": { \"dede\": \"dede.ts\" } }\n");
        let first = repo.commit("the TypeScript");
        repo.write(
            "package.json",
            "{ \"name\": \"dede\", \"bin\": { \"dede\": \"dede.ts\" }, \"rustify\": { \"bins\": { \"dede\": \"dede\" } } }\n",
        );
        repo.write(".github/workflows/rust-npm-release.yml", "name: rust-npm-release\n");
        repo.write("README.md", "# dede\n");
        repo.write("rs/Cargo.toml", "[package]\nname = \"dede\"\nversion = \"0.0.0\"\n");
        repo.write("rs/src/main.rs", "fn main() {}\n");
        repo.write("rs/src/dede.rs", "pub fn get() {}\n#[test]\nfn gets() {}\n");
        repo.write("rs/src/generated/table.rs", "pub const TABLE: &[u8] = &[];\n");
        repo.write("rs/parity.gen.mjs", "console.log('cases');\n");
        repo.write("rs/parity.json", "[]\n");
        repo.write("skills/setup/run.mjs", "console.log('skill');\n");
        repo.commit("the port");
        (repo, first)
    }

    const PORTED_PROJECT: &str = r#"
        name = "dede"
        manifest = "rs/Cargo.toml"
        ts = ["."]
        rust = ["rs/src"]
        ignore = ["rs", "skills", "rs/src/generated"]
    "#;

    #[test]
    fn the_counts_are_made_of_tracked_files_whatever_their_names() {
        let (repo, _) = ported_repository();
        let p = project(PORTED_PROJECT);
        let counted = |wanted: &dyn Fn(&str) -> bool| -> Vec<(String, usize)> {
            sources(&repo.dir, wanted).into_iter().map(|f| (f.path, f.lines)).collect()
        };
        // git prints the last of these quoted and escaped unless asked not to.
        assert_eq!(
            counted(&|path| p.replaces(path)),
            [("dede.test.ts".to_string(), 1), ("dede.ts".to_string(), 2), ("备注 notes.ts".to_string(), 2)]
        );
        assert_eq!(
            counted(&|path| p.is_rust(path)),
            [("rs/src/dede.rs".to_string(), 3), ("rs/src/main.rs".to_string(), 1)]
        );
    }

    /// The audit of the ported repository, with a ledger of one verified
    /// feature that was reconciled at the repository's first commit.
    fn audit_of_ported_repository() -> (Section, String) {
        let (repo, first) = ported_repository();
        let home = Scratch::new();
        home.write(
            "parity/dede.toml",
            &format!(
                "reconciled = \"{first}\"\n\n[[feature]]\nname = \"get\"\nstatus = \"verified\"\n\
                 ts = \"dede.ts:1 get; dede.ts:2 dispatch\"\nrs = \"rs/src/dede.rs get\"\n\
                 proof = \"rs/parity.json cases `get: …`\"\n"
            ),
        );
        (audit_project(&project(PORTED_PROJECT), &home.dir, &home.dir, true, Some(&repo.dir)), first)
    }

    #[test]
    fn the_audit_sees_a_port_that_lives_in_an_ignored_directory() {
        let (section, _) = audit_of_ported_repository();
        let body = &section.body;
        assert!(
            body.contains("TypeScript/JS to replace: 4 lines in 2 files; its tests: 1 lines, about 1 cases"),
            "{body}"
        );
        assert!(body.contains("Rust: 4 lines in 2 files, 1 tests"), "{body}");
        assert!(!body.contains("no Rust port exists yet"), "{body}");
        assert_eq!(section.port, "1 verified, 0 ported, 0 partial, 0 missing of 1");
    }

    #[test]
    fn the_audit_reads_the_checkout_it_is_given_when_run_from_a_git_hook() {
        // A hook of another repository runs with these two set. The test
        // above runs again in a process of its own that has them.
        let other = Scratch::new();
        other.git(&["init", "--quiet"]);
        let out = Command::new(env::current_exe().unwrap())
            .args(["--exact", "tests::the_audit_sees_a_port_that_lives_in_an_ignored_directory"])
            .env("GIT_DIR", other.dir.join(".git"))
            .env("GIT_INDEX_FILE", other.dir.join(".git/index"))
            .output()
            .expect("the test binary");
        let report = String::from_utf8_lossy(&out.stdout);
        assert!(out.status.success() && report.contains(" 1 passed;"), "{report}");
    }

    #[test]
    fn a_port_branch_that_left_the_typescript_alone_keeps_the_ledger_current() {
        // package.json, the workflow, the README and the port's own scripts
        // changed after the ledger was reconciled; no TypeScript did.
        let (section, first) = audit_of_ported_repository();
        let body = &section.body;
        assert!(
            body.contains(&format!("ledger is current (reconciled at `{first}`, no TypeScript changed since)")),
            "{body}"
        );
        assert!(!body.contains("`warn`"), "{body}");
        assert_ne!(section.next.as_deref(), Some("reconcile the parity ledger"));
    }

    #[test]
    fn only_typescript_sources_count_as_changed_since_the_ledger() {
        let repo = Scratch::new();
        repo.git(&["init", "--quiet"]);
        let files = [
            "cli.ts",
            "cli.test.ts",
            "types.d.ts",
            "lib/moved.ts",
            "lib/deleted.ts",
            "lib/untouched.ts",
            "备注 notes.ts",
            "extension/background.js",
            "vendor/dep.js",
            "package.json",
        ];
        for file in files {
            repo.write(file, &format!("// {file}\nexport const first = 1;\nexport const second = 2;\n"));
        }
        let reconciled = repo.commit("the TypeScript");
        let edited =
            ["cli.ts", "cli.test.ts", "types.d.ts", "备注 notes.ts", "extension/background.js", "vendor/dep.js", "package.json"];
        for file in edited {
            repo.write(file, &format!("// {file}, edited\n"));
        }
        // Moved into an ignored directory with its content unchanged, which
        // git would otherwise report as a rename, under the new name only.
        repo.git(&["mv", "lib/moved.ts", "vendor/moved.ts"]);
        repo.git(&["rm", "--quiet", "lib/deleted.ts"]);
        repo.write("lib/added.tsx", "export {};\n");
        repo.write("README.md", "# x\n");
        repo.write(".github/workflows/ci.yml", "name: ci\n");
        repo.write("rs/Cargo.toml", "[package]\nname = \"x\"\n");
        repo.write("rs/src/main.rs", "fn main() {}\n");
        repo.write("rs/src/vectors.mjs", "export {};\n");
        repo.write("rs/parity.gen.mjs", "export {};\n");
        repo.commit("the port, and some TypeScript");

        let p = project(
            r#"
            name = "x"
            ts = ["."]
            rust = ["rs/src"]
            ignore = ["rs", "vendor"]
            keep_ts = { "extension" = "runs in the browser" }
            "#,
        );
        assert_eq!(
            changed_typescript(&p, &repo.dir, &reconciled).unwrap(),
            ["cli.ts", "lib/added.tsx", "lib/deleted.ts", "lib/moved.ts", "备注 notes.ts"]
        );
        assert!(changed_typescript(&p, &repo.dir, "HEAD").unwrap().is_empty());
        assert!(changed_typescript(&p, &repo.dir, "no-such-commit").is_none());

        // The same files the count is made of, whatever the layout.
        let p = project("name = \"x\"\nts = [\"lib\"]\nrust = [\".\"]");
        assert_eq!(
            changed_typescript(&p, &repo.dir, &reconciled).unwrap(),
            ["lib/added.tsx", "lib/deleted.ts", "lib/moved.ts"]
        );

        // A checkout that is a directory inside a repository: both lists are
        // of its own files, by their paths below it.
        let lib = repo.dir.join("lib");
        let p = project("name = \"x\"\nts = [\".\"]");
        let counted: Vec<String> = sources(&lib, |path| p.replaces(path)).into_iter().map(|f| f.path).collect();
        assert_eq!(counted, ["added.tsx", "untouched.ts"]);
        assert_eq!(changed_typescript(&p, &lib, &reconciled).unwrap(), ["added.tsx", "deleted.ts", "moved.ts"]);
    }

    #[test]
    fn files_the_typescript_runs_count_as_changed_under_a_named_directory() {
        let repo = Scratch::new();
        repo.git(&["init", "--quiet"]);
        for file in ["src/index.ts", "src/setup-repo.sh", "src/templates/config.yaml", "src/main.rs", "setup.sh", "README.md"] {
            repo.write(file, "one\n");
        }
        repo.write("Cargo.toml", "[package]\nname = \"x\"\n");
        let reconciled = repo.commit("the TypeScript");
        for file in ["src/setup-repo.sh", "src/templates/config.yaml", "src/main.rs", "setup.sh", "README.md", "Cargo.toml"] {
            repo.write(file, "two\n");
        }
        repo.commit("a script, a template, the Rust and the rest");

        // A crate at the root shares src/ with the TypeScript: the shell
        // script and the template count, the Rust and the root files do not.
        let p = project("name = \"x\"\nmanifest = \"Cargo.toml\"\nts = [\"src\"]\nrust = [\"src\"]");
        assert_eq!(changed_typescript(&p, &repo.dir, &reconciled).unwrap(), ["src/setup-repo.sh", "src/templates/config.yaml"]);

        // At the repository root only scripts count, or every commit to the
        // README or a workflow would ask for a new reconciliation.
        let p = project("name = \"x\"\nts = [\".\"]");
        assert!(changed_typescript(&p, &repo.dir, &reconciled).unwrap().is_empty());

        // keep_ts and ignore leave non-scripts out as they do scripts.
        let p = project("name = \"x\"\nts = [\"src\"]\nkeep_ts = { \"src/templates\" = \"page\" }\nignore = [\"src/setup-repo.sh\"]");
        assert!(changed_typescript(&p, &repo.dir, &reconciled).unwrap().is_empty());
    }

    #[test]
    fn no_largest_module_is_named_when_every_module_has_a_namesake() {
        let (repo, _) = ported_repository();
        let home = Scratch::new();
        let audit = |block: &str| audit_project(&project(block), &home.dir, &home.dir, true, Some(&repo.dir)).body;
        // dede.ts has rs/src/dede.rs; the notes file has no namesake.
        let body = audit(PORTED_PROJECT);
        assert!(body.contains("1 of 2 TypeScript modules have no Rust module of the same name"), "{body}");
        assert!(body.contains("organised differently. Largest: `备注 notes.ts` (2)\n"), "{body}");
        let body = audit(&PORTED_PROJECT.replace("\"skills\"", "\"skills\", \"备注 notes.ts\""));
        assert!(body.contains("0 of 1 TypeScript modules have no Rust module of the same name"), "{body}");
        assert!(body.contains("organised differently.\n"), "{body}");
    }
}
