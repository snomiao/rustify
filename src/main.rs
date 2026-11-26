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

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().ok()?;
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

fn is_under(path: &str, dir: &str) -> bool {
    let dir = dir.trim_end_matches('/');
    dir == "." || path == dir || path.starts_with(&format!("{dir}/"))
}

fn is_test_path(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.contains(".spec.")
        || name.contains(".test.")
        || path.split('/').any(|part| matches!(part, "tests" | "test" | "__tests__" | "e2e"))
}

/// Tracked files under `roots` with one of `extensions`, minus `skip`.
fn sources(dir: &Path, roots: &[String], extensions: &[&str], skip: &[&String]) -> Vec<SourceFile> {
    let mut files = Vec::new();
    if roots.is_empty() {
        return files;
    }
    let listed = git(dir, &["ls-files"]).unwrap_or_default();
    for path in listed.lines() {
        let extension = path.rsplit('.').next().unwrap_or("");
        if !extensions.contains(&extension) || path.ends_with(".d.ts") {
            continue;
        }
        if !roots.iter().any(|r| is_under(path, r)) || skip.iter().any(|s| is_under(path, s)) {
            continue;
        }
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
    let mut skip: Vec<&String> = project.ignore.iter().collect();
    skip.extend(project.keep_ts.keys());
    skip.extend(project.rust.iter());
    let ts = sources(&dir, &project.ts, SCRIPT_EXTENSIONS, &skip);
    let rs = sources(&dir, &project.rust, &["rs"], &project.ignore.iter().collect::<Vec<_>>());
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
        s.info(format!(
            "by file name, {} of {} TypeScript modules have no Rust module of the same name ({} lines). \
             A rough signal only: Rust code is often organised differently. Largest: {}",
            unmatched.len(),
            ts_src.len(),
            thousands(unmatched_lines),
            unmatched
                .iter()
                .take(8)
                .map(|f| format!("`{}` ({})", f.path, thousands(f.lines)))
                .collect::<Vec<_>>()
                .join(", ")
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
        .filter_map(|part| part.trim().split([':', ' ']).next())
        .filter(|file| !file.is_empty())
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
        Some(commit) => {
            let mut args = vec!["diff".to_string(), "--name-only".into(), format!("{commit}..HEAD"), "--".into()];
            args.extend(project.ts.iter().cloned());
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            match git(dir, &refs) {
                None => s.warn(format!("ledger was reconciled at `{commit}`, which this checkout does not have")),
                Some(changed) => {
                    let changed: Vec<&str> = changed
                        .lines()
                        .filter(|p| !is_test_path(p) && !project.ignore.iter().any(|i| is_under(p, i)))
                        .collect();
                    if changed.is_empty() {
                        s.ok(format!("ledger is current (reconciled at `{commit}`, no TypeScript changed since)"));
                    } else {
                        s.todo(
                            format!(
                                "{} TypeScript file(s) changed since the ledger was reconciled at `{commit}`: {}",
                                changed.len(),
                                changed.iter().take(10).map(|p| format!("`{p}`")).collect::<Vec<_>>().join(", ")
                            ),
                            "reconcile the parity ledger",
                        );
                    }
                }
            }
        }
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

/// The JavaScript file a package runs for its first command, as published.
fn js_entry(package: &Json) -> Option<String> {
    let bin = match &package["publishConfig"]["bin"] {
        Json::Null => &package["bin"],
        published => published,
    };
    let entry = match bin {
        Json::String(file) => file.clone(),
        Json::Object(map) => map.values().next()?.as_str()?.to_string(),
        _ => return None,
    };
    Some(entry.trim_start_matches("./").to_string())
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
    let manifest = project.manifest.clone().unwrap_or_else(|| "rs/Cargo.toml".to_string());
    let crate_dir = dir.join(&manifest).parent().map(Path::to_path_buf).unwrap_or_else(|| dir.clone());
    if dir.join(&manifest).exists() {
        eprintln!("rustify: {} already exists — nothing to scaffold", dir.join(&manifest).display());
        return 1;
    }
    let package: Json = match fs::read_to_string(dir.join("package.json")).ok().and_then(|t| serde_json::from_str(&t).ok()) {
        Some(package) => package,
        None => {
            eprintln!("rustify: {name} has no readable package.json");
            return 1;
        }
    };
    let Some(entry) = js_entry(&package) else {
        eprintln!("rustify: package.json of {name} has no `bin`, so there is no command to take over");
        return 1;
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
        .replace("__JS_ENTRY__", &entry);
    let fallback = fs::read_to_string(templates.join("js_fallback.rs"))
        .expect("templates/rust/js_fallback.rs")
        .replace("\"RUSTIFY_PACKAGE_ROOT\"", &format!("\"{root_env}\""));
    let files = [
        (crate_dir.join("Cargo.toml"), cargo_toml),
        (crate_dir.join("src/main.rs"), main_rs),
        (crate_dir.join("src/js_fallback.rs"), fallback),
        (crate_dir.join(".gitignore"), "/target\n".to_string()),
    ];
    for (file, content) in &files {
        if !dry {
            fs::create_dir_all(file.parent().unwrap()).expect("create crate directory");
            fs::write(file, content).expect("write crate file");
        }
        say!("{} {}", if dry { "would write" } else { "wrote      " }, file.display());
    }
    let bins: Vec<String> = commands.iter().map(|c| format!("\"{c}\": \"{crate_name}\"")).collect();
    say!(
        "\nThe binary hands every command to `{entry}`, so nothing changes for users yet.\n\nNext:\n  1. add to package.json:\n       \"rustify\": {{ \"mode\": \"hybrid\", \"bins\": {{ {} }}, \"rootEnv\": \"{root_env}\" }}\n  2. set `manifest = \"{manifest}\"` and `rust = [...]` for {name} in projects.toml\n  3. `rustify vendor {name}` adds the release workflow\n  4. build it (`cargo build --release --manifest-path {manifest}`) and commit Cargo.lock\nNothing was committed.",
        bins.join(", ")
    );
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
    let Some(manifest) = &project.manifest else {
        eprintln!("rustify: {name} has no `manifest` in projects.toml — there is no crate to release yet");
        return 1;
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
    let rust_dir = Path::new(manifest).parent().map(|p| p.display().to_string()).unwrap_or_default();
    let template = fs::read_to_string(home.join("templates/github").join(WORKFLOW)).expect("workflow template");
    let text = template
        .replace("__MANIFEST__", manifest)
        .replace("__BINS__", &bins.join(" "))
        .replace("__SMOKE__", &format!("{command} --version"))
        .replace("\"__RUST_DIR__/**\"", &format!("\"{}\"", if rust_dir.is_empty() { "src/**".to_string() } else { format!("{rust_dir}/**") }));
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
    }

    #[test]
    fn the_published_bin_is_the_js_entry() {
        let package: Json = serde_json::from_str(
            r#"{"bin":{"slack":"./ts/cli.ts"},"publishConfig":{"bin":{"slack":"./dist/cli.js"}}}"#,
        )
        .unwrap();
        assert_eq!(js_entry(&package).as_deref(), Some("dist/cli.js"));
        let package: Json = serde_json::from_str(r#"{"name":"x","bin":"cli.mjs"}"#).unwrap();
        assert_eq!(js_entry(&package).as_deref(), Some("cli.mjs"));
        let package: Json = serde_json::from_str(r#"{"name":"x"}"#).unwrap();
        assert_eq!(js_entry(&package), None);
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
}
