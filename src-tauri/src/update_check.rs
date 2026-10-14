//! Opt-in update check: the only network request the app can make, and only
//! when the user presses the button. One read of the public release list of
//! each of two mirrors (Gitee, which many users in China can reach, and
//! GitHub); nothing about the user, the machine or the library is sent.
//!
//! The requests go through the system `curl` so the webview stays closed to
//! the network (the CSP is unchanged) and no HTTP client joins the build.
//! Installer names and URLs must match our fixed repository and packaging
//! contract. Downloads are opened in the browser, never installed here.
use crate::domain::{Error, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, process::Command};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Gitee,
    Github,
}
impl Source {
    const ALL: [Source; 2] = [Source::Gitee, Source::Github];
    fn api(self) -> &'static str {
        match self {
            Source::Gitee => {
                "https://gitee.com/api/v5/repos/CoderJackZhu/thingary/releases?page=1&per_page=30"
            }
            Source::Github => {
                "https://api.github.com/repos/CoderJackZhu/Thingary/releases?per_page=30"
            }
        }
    }
    fn page(self) -> &'static str {
        match self {
            Source::Gitee => "https://gitee.com/CoderJackZhu/thingary/releases/tag/v",
            Source::Github => "https://github.com/CoderJackZhu/Thingary/releases/tag/v",
        }
    }
    fn timeout(self) -> &'static str {
        match self {
            Source::Gitee => "8",
            Source::Github => "6",
        }
    }
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.name() == name)
    }
    pub fn name(self) -> &'static str {
        match self {
            Source::Gitee => "gitee",
            Source::Github => "github",
        }
    }
}

const MAX_BYTES: usize = 2_000_000;
const NOTES_CHARS: usize = 3000;

#[derive(Debug, Clone, Copy)]
pub struct Platform {
    pub os: &'static str,
    pub arch: &'static str,
}
impl Platform {
    fn current() -> Self {
        Self {
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
        }
    }
    fn label(self) -> String {
        match (self.os, self.arch) {
            ("macos", "aarch64") => "Mac · Apple Silicon".into(),
            ("macos", "x86_64") => "Mac · Intel".into(),
            ("windows", "x86_64") => "Windows x64".into(),
            ("windows", "aarch64") => "Windows ARM64".into(),
            _ => "当前应用平台".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Download {
    pub source: Source,
    pub name: String,
    pub label: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Release {
    pub version: String,
    pub published_at: String,
    /// Plain text for display only; never rendered as markup.
    pub notes: String,
    /// Mirrors that list this version, in lookup order.
    pub sources: Vec<Source>,
    pub downloads: Vec<Download>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Outcome {
    pub current: String,
    pub latest: Option<Release>,
    pub update_available: bool,
    /// Mirrors that could not be read; the answer then comes from the others.
    pub unreachable: Vec<Source>,
    pub platform: String,
    /// A newer release exists, but none of its assets match this platform.
    pub newer_unavailable: Option<Release>,
}

#[derive(Deserialize)]
struct Raw {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    // GitHub says published_at, Gitee created_at; both are display text only.
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Assets,
}

#[derive(Default, Deserialize)]
#[serde(untagged)]
enum Assets {
    List(Vec<Asset>),
    Links {
        links: Vec<Asset>,
    },
    #[default]
    Missing,
}
impl Assets {
    fn list(self) -> Vec<Asset> {
        match self {
            Self::List(a) | Self::Links { links: a } => a,
            Self::Missing => vec![],
        }
    }
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    #[serde(default, alias = "url")]
    browser_download_url: String,
    size: Option<u64>,
    state: Option<String>,
}

fn download_url(source: Source, version: &str, name: &str) -> String {
    let repo = match source {
        Source::Github => "https://github.com/CoderJackZhu/Thingary",
        Source::Gitee => "https://gitee.com/CoderJackZhu/thingary",
    };
    // The caller accepts only exact contract filenames, never arbitrary paths.
    let encoded: String = name
        .as_bytes()
        .iter()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.') {
                (*b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    format!("{repo}/releases/download/v{version}/{encoded}")
}

fn asset_url_matches(source: Source, version: &str, name: &str, url: &str) -> bool {
    let expected = download_url(source, version, name);
    // Chinese filenames may be literal or percent-encoded, but the fixed
    // repository, tag and filename must still match exactly.
    url == expected
        || expected
            .rsplit_once('/')
            .is_some_and(|(base, _)| url == format!("{base}/{name}"))
}

/// Returns priority and a user-facing label for an exact compatible filename.
fn installer(platform: Platform, version: &str, name: &str) -> Option<(u8, &'static str)> {
    parse_version(version)?;
    if platform.os == "macos" && matches!(platform.arch, "aarch64" | "x86_64") {
        if name == format!("Thingary-{version}-universal.dmg") {
            return Some((0, "Mac 通用安装包（Apple Silicon 与 Intel）"));
        }
        let (arch, alias, label) = if platform.arch == "aarch64" {
            ("arm64", "aarch64", "Mac 安装包（Apple Silicon）")
        } else {
            ("x86_64", "x64", "Mac 安装包（Intel）")
        };
        if name == format!("Thingary-{version}-{arch}.dmg")
            || name == format!("Thingary-{version}-{alias}.dmg")
        {
            return Some((1, label));
        }
    }
    if platform.os == "windows" {
        let (arch, label) = match platform.arch {
            "x86_64" => ("x64", "Windows 安装包（x64）"),
            "aarch64" => ("arm64", "Windows 安装包（ARM64）"),
            _ => return None,
        };
        for product in ["Thingary", "物谱"] {
            if name == format!("{product}_{version}_{arch}-setup.exe")
                || name == format!("{product}-{version}-windows-{arch}.exe")
            {
                return Some((0, label));
            }
            if name == format!("{product}_{version}_{arch}_en-US.msi")
                || name == format!("{product}-{version}-windows-{arch}.msi")
            {
                return Some((1, label));
            }
        }
    }
    None
}

/// Strictly `major.minor.patch`; anything else (suffixes, odd tags) is not a release we offer.
pub fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.split('.');
    let mut next = || {
        let p = parts.next()?;
        (!p.is_empty() && p.len() <= 9 && p.bytes().all(|b| b.is_ascii_digit()))
            .then(|| p.parse::<u64>().ok())?
    };
    let v = (next()?, next()?, next()?);
    parts.next().is_none().then_some(v)
}

fn trim_notes(body: &str) -> String {
    let text = body.replace("\r\n", "\n");
    let text = text.trim();
    if text.chars().count() <= NOTES_CHARS {
        return text.to_owned();
    }
    let mut cut: String = text.chars().take(NOTES_CHARS).collect();
    cut.push('…');
    cut
}

/// Published releases of one mirror with a clean version tag, newest first.
fn parse_for(source: Source, json: &str, platform: Platform) -> Result<Vec<Release>> {
    let raw: Vec<Raw> = serde_json::from_str(json)
        .map_err(|_| Error::new("UPDATE_CHECK", "更新服务返回的内容无法识别，请稍后再试"))?;
    let mut found: Vec<((u64, u64, u64), Release)> = raw
        .into_iter()
        .filter(|r| !r.draft)
        .filter_map(|r| {
            let version = r.tag_name.strip_prefix('v')?.to_owned();
            let key = parse_version(&version)?;
            let mut assets: Vec<_> = r
                .assets
                .list()
                .into_iter()
                .filter_map(|a| {
                    let (priority, label) = installer(platform, &version, &a.name)?;
                    if a.size == Some(0)
                        || a.state.as_deref().is_some_and(|s| s != "uploaded")
                        || !asset_url_matches(source, &version, &a.name, &a.browser_download_url)
                    {
                        return None;
                    }
                    Some((
                        priority,
                        Download {
                            source,
                            name: a.name,
                            label: label.into(),
                            size: a.size,
                        },
                    ))
                })
                .collect();
            assets.sort_by(|a, b| (a.0, &a.1.name).cmp(&(b.0, &b.1.name)));
            Some((
                key,
                Release {
                    version,
                    published_at: r.published_at.or(r.created_at).unwrap_or_default(),
                    notes: trim_notes(r.body.as_deref().unwrap_or("")),
                    sources: vec![source],
                    downloads: assets.into_iter().take(1).map(|(_, a)| a).collect(),
                },
            ))
        })
        .collect();
    found.sort_by_key(|r| std::cmp::Reverse(r.0));
    Ok(found.into_iter().map(|(_, r)| r).collect())
}

/// Merge mirror metadata and compatible installers, newest version first.
/// A version listed by several mirrors keeps the first mirror's text.
fn merge(answers: Vec<Vec<Release>>, platform: Platform) -> Vec<Release> {
    let mut by_version: BTreeMap<(u64, u64, u64), Release> = BTreeMap::new();
    for release in answers.into_iter().flatten() {
        let Some(key) = parse_version(&release.version) else {
            continue;
        };
        match by_version.get_mut(&key) {
            Some(known) => {
                for s in release.sources {
                    if !known.sources.contains(&s) {
                        known.sources.push(s);
                    }
                }
                if known.notes.is_empty() {
                    known.notes = release.notes;
                }
                for download in release.downloads {
                    if !known.downloads.iter().any(|d| d.source == download.source) {
                        known.downloads.push(download);
                    }
                }
            }
            None => {
                by_version.insert(key, release);
            }
        }
    }
    let mut releases: Vec<_> = by_version.into_values().rev().collect();
    for release in &mut releases {
        release.downloads.sort_by_key(|d| {
            installer(platform, &release.version, &d.name)
                .map(|(priority, _)| priority)
                .unwrap_or(2)
        });
    }
    releases
}

/// Looks every mirror up through `fetch` and combines what answered. Fails only
/// when none answered, so one unreachable site never blocks the check.
pub fn check_with(
    current: &str,
    fetch: &mut dyn FnMut(Source) -> Result<String>,
) -> Result<Outcome> {
    check_for(current, Platform::current(), fetch)
}

fn check_for(
    current: &str,
    platform: Platform,
    fetch: &mut dyn FnMut(Source) -> Result<String>,
) -> Result<Outcome> {
    let mine =
        parse_version(current).ok_or_else(|| Error::new("UPDATE_CHECK", "当前版本号无法识别"))?;
    let (mut answers, mut unreachable) = (Vec::new(), Vec::new());
    for source in Source::ALL {
        match fetch(source).and_then(|json| parse_for(source, &json, platform)) {
            Ok(list) => answers.push(list),
            Err(_) => unreachable.push(source),
        }
    }
    if answers.is_empty() {
        return Err(Error::new(
            "UPDATE_CHECK",
            "无法连接到 Gitee 和 GitHub，请检查网络后重试。也可以直接访问 https://gitee.com/CoderJackZhu/thingary/releases 查看新版本。",
        ));
    }
    let releases = merge(answers, platform);
    let latest = releases.iter().find(|r| !r.downloads.is_empty()).cloned();
    let threshold = latest
        .as_ref()
        .and_then(|r| parse_version(&r.version))
        .unwrap_or(mine)
        .max(mine);
    let newer_unavailable = releases
        .iter()
        .find(|r| {
            r.downloads.is_empty() && parse_version(&r.version).is_some_and(|v| v > threshold)
        })
        .cloned();
    let update_available = latest
        .as_ref()
        .and_then(|r| parse_version(&r.version))
        .is_some_and(|v| v > mine);
    Ok(Outcome {
        current: current.to_owned(),
        latest,
        update_available,
        unreachable,
        platform: platform.label(),
        newer_unavailable,
    })
}

fn fetch(source: Source) -> Result<String> {
    #[cfg(not(windows))]
    let curl = "/usr/bin/curl";
    #[cfg(windows)]
    let curl = "curl.exe";
    let output = Command::new(curl)
        .args([
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            source.timeout(),
            "--proto",
            "=https",
            "--user-agent",
            concat!("Thingary/", env!("CARGO_PKG_VERSION")),
            "--header",
            "Accept: application/json",
            source.api(),
        ])
        .output()
        .map_err(|_| Error::new("UPDATE_CHECK", "无法启动网络请求，请稍后再试"))?;
    if !output.status.success() {
        return Err(Error::new("UPDATE_CHECK", "更新服务暂时不可用"));
    }
    if output.stdout.len() > MAX_BYTES {
        return Err(Error::new("UPDATE_CHECK", "更新服务返回的内容过大，已忽略"));
    }
    String::from_utf8(output.stdout)
        .map_err(|_| Error::new("UPDATE_CHECK", "更新服务返回的内容无法识别，请稍后再试"))
}

/// Runs the lookups. Blocking: call from a blocking task.
pub fn check() -> Result<Outcome> {
    check_with(env!("CARGO_PKG_VERSION"), &mut fetch)
}

/// Opens one mirror's release page for a version we validated ourselves.
pub fn open_release_page(version: &str, source: &str) -> Result<()> {
    parse_version(version).ok_or_else(|| Error::new("UPDATE_CHECK", "版本号无效"))?;
    let source = Source::parse(source).ok_or_else(|| Error::new("UPDATE_CHECK", "下载来源无效"))?;
    open_url(&format!("{}{version}", source.page()))
}

pub fn open_download(version: &str, source: &str, name: &str) -> Result<()> {
    let url = validated_download(Platform::current(), version, source, name)?;
    open_url(&url)
}

fn validated_download(
    platform: Platform,
    version: &str,
    source: &str,
    name: &str,
) -> Result<String> {
    let source = Source::parse(source).ok_or_else(|| Error::new("UPDATE_CHECK", "下载来源无效"))?;
    installer(platform, version, name)
        .ok_or_else(|| Error::new("UPDATE_CHECK", "没有适合当前平台的安装包"))?;
    Ok(download_url(source, version, name))
}

fn open_url(url: &str) -> Result<()> {
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|_| Error::new("UPDATE_CHECK", "无法打开浏览器，请重试或手动访问发布页"))
    }
    #[cfg(not(windows))]
    {
        let status = Command::new("open")
            .arg(url)
            .status()
            .map_err(|_| Error::new("UPDATE_CHECK", "无法打开浏览器，请手动访问发布页"))?;
        if status.success() {
            Ok(())
        } else {
            Err(Error::new(
                "UPDATE_CHECK",
                "无法打开浏览器，请手动访问发布页",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GITHUB: &str = r#"[
      {"tag_name":"v0.0.9","draft":false,"published_at":"2026-10-01T00:00:00Z","body":"nine"},
      {"tag_name":"v0.0.10","draft":false,"published_at":"2026-10-13T00:00:00Z","body":"ten\r\nlines"},
      {"tag_name":"v0.0.11","draft":true,"published_at":null,"body":"unpublished draft"},
      {"tag_name":"v0.1.0-beta.1","draft":false,"published_at":"2026-10-04T00:00:00Z","body":"suffix"},
      {"tag_name":"0.0.99","draft":false,"published_at":"2026-10-05T00:00:00Z","body":"no v"},
      {"tag_name":"v1.2","draft":false,"published_at":null,"body":null}
    ]"#;
    // Gitee's list has no `draft` and dates releases with `created_at`.
    const GITEE: &str = r#"[
      {"tag_name":"v0.0.10","prerelease":true,"created_at":"2026-10-14T00:00:00+08:00","body":"gitee ten"},
      {"tag_name":"v0.0.9","prerelease":true,"created_at":"2026-10-02T00:00:00+08:00","body":""}
    ]"#;

    #[test]
    fn versions_are_strict_and_ordered_numerically() {
        assert_eq!(parse_version("0.0.10"), Some((0, 0, 10)));
        for bad in [
            "",
            "1.2",
            "1.2.3.4",
            "1.2.x",
            "1..3",
            "-1.2.3",
            "1.2.3-beta",
            "v1.2.3",
            "1.2.3/../x",
            "1.2.3 ; rm",
            "9999999999.0.0",
        ] {
            assert_eq!(parse_version(bad), None, "{bad:?}");
        }
        assert!(parse_version("0.0.10") > parse_version("0.0.9"));
    }

    #[test]
    fn only_published_clean_tags_are_offered_newest_first() {
        let releases = parse_for(Source::Github, GITHUB, Platform::current()).unwrap();
        let versions: Vec<_> = releases.iter().map(|r| r.version.as_str()).collect();
        assert_eq!(versions, ["0.0.10", "0.0.9"]);
        assert_eq!(releases[0].notes, "ten\nlines");
        assert_eq!(releases[0].published_at, "2026-10-13T00:00:00Z");
        assert_eq!(releases[0].sources, [Source::Github]);
        let gitee = parse_for(Source::Gitee, GITEE, Platform::current()).unwrap();
        assert_eq!(gitee[0].published_at, "2026-10-14T00:00:00+08:00");
        assert_eq!(gitee[0].sources, [Source::Gitee]);
    }

    #[test]
    fn long_notes_are_cut_and_markup_is_left_as_text() {
        let body = format!("<script>alert(1)</script>{}", "字".repeat(5000));
        let json = format!(
            r#"[{{"tag_name":"v1.0.0","draft":false,"body":{}}}]"#,
            serde_json::to_string(&body).unwrap()
        );
        let release = parse_for(Source::Github, &json, Platform::current())
            .unwrap()
            .remove(0);
        assert!(release.notes.starts_with("<script>"));
        assert_eq!(release.notes.chars().count(), NOTES_CHARS + 1);
        assert!(release.notes.ends_with('…'));
    }

    fn with_installers(source: Source, json: &str) -> String {
        let Ok(mut values) = serde_json::from_str::<Vec<serde_json::Value>>(json) else {
            return json.into();
        };
        for v in &mut values {
            let version = v["tag_name"].as_str().unwrap_or("").trim_start_matches('v');
            let name = if cfg!(windows) {
                format!(
                    "Thingary_{version}_{}-setup.exe",
                    if std::env::consts::ARCH == "aarch64" {
                        "arm64"
                    } else {
                        "x64"
                    }
                )
            } else {
                format!("Thingary-{version}-universal.dmg")
            };
            v["assets"] = serde_json::json!([{ "name": name, "browser_download_url": download_url(source, version, &name), "size": 42, "state":"uploaded" }]);
        }
        serde_json::to_string(&values).unwrap()
    }

    fn run(current: &str, gitee: Option<&str>, github: Option<&str>) -> Result<Outcome> {
        check_with(current, &mut |s| match (s, gitee, github) {
            (Source::Gitee, Some(j), _) | (Source::Github, _, Some(j)) => Ok(with_installers(s, j)),
            _ => Err(Error::new("UPDATE_CHECK", "离线")),
        })
    }

    #[test]
    fn an_update_is_offered_only_for_a_higher_version_and_names_every_mirror_that_has_it() {
        let both = run("0.0.5", Some(GITEE), Some(GITHUB)).unwrap();
        assert!(both.update_available && both.unreachable.is_empty());
        let latest = both.latest.unwrap();
        assert_eq!(latest.version, "0.0.10");
        assert_eq!(latest.sources, [Source::Gitee, Source::Github]);
        assert_eq!(latest.notes, "gitee ten", "the first mirror's text is kept");
        let same = run("0.0.10", Some(GITEE), Some(GITHUB)).unwrap();
        assert!(!same.update_available);
        let ahead = run("0.0.11", Some(GITEE), Some(GITHUB)).unwrap();
        assert!(
            !ahead.update_available,
            "a development build ahead of the releases is not outdated"
        );
        let empty = run("0.0.5", Some("[]"), Some("[]")).unwrap();
        assert!(empty.latest.is_none() && !empty.update_available);
    }

    #[test]
    fn the_newest_version_wins_across_mirrors_even_when_one_lags() {
        let lagging = r#"[{"tag_name":"v0.0.9","prerelease":true,"created_at":"2026-10-02T00:00:00+08:00","body":""}]"#;
        let out = run("0.0.5", Some(lagging), Some(GITHUB)).unwrap();
        let latest = out.latest.unwrap();
        assert_eq!(latest.version, "0.0.10");
        assert_eq!(
            latest.sources,
            [Source::Github],
            "only GitHub has it so far"
        );
    }

    #[test]
    fn one_unreachable_mirror_is_reported_but_never_blocks_the_check() {
        let gitee_only = run("0.0.5", Some(GITEE), None).unwrap();
        assert!(gitee_only.update_available);
        assert_eq!(gitee_only.unreachable, [Source::Github]);
        let github_only = run("0.0.5", None, Some(GITHUB)).unwrap();
        assert_eq!(github_only.unreachable, [Source::Gitee]);
        assert!(github_only.update_available);
        let garbled = run("0.0.5", Some("not json"), Some(GITHUB)).unwrap();
        assert_eq!(
            garbled.unreachable,
            [Source::Gitee],
            "an unreadable answer counts as unreachable"
        );
    }

    #[test]
    fn failing_everywhere_is_reported_with_a_manual_address() {
        let err = run("0.0.5", None, None).unwrap_err();
        assert_eq!(err.code, "UPDATE_CHECK");
        assert!(err
            .message
            .contains("gitee.com/CoderJackZhu/thingary/releases"));
        assert_eq!(
            run("dev", Some("[]"), Some("[]")).unwrap_err().code,
            "UPDATE_CHECK"
        );
        assert!(
            run("0.0.5", Some(r#"{"message":"rate limited"}"#), Some("[]")).is_ok(),
            "one good answer is enough"
        );
        assert!(run(
            "0.0.5",
            Some(r#"{"message":"x"}"#),
            Some(r#"{"message":"y"}"#)
        )
        .is_err());
    }

    #[test]
    fn only_a_validated_version_and_known_mirror_can_build_the_page_to_open() {
        for bad in ["", "1.2", "1.2.3/../../x", "1.2.3 --help", "latest"] {
            assert_eq!(
                open_release_page(bad, "gitee").unwrap_err().code,
                "UPDATE_CHECK",
                "{bad:?}"
            );
        }
        for bad in ["", "evil.example", "GITEE", "https://evil.example/"] {
            assert_eq!(
                open_release_page("1.2.3", bad).unwrap_err().code,
                "UPDATE_CHECK",
                "{bad:?}"
            );
        }
    }
    fn fixture(source: Source, version: &str, names: &[&str]) -> String {
        serde_json::json!([{"tag_name":format!("v{version}"),"assets":names.iter().map(|name| serde_json::json!({"name":name,"browser_download_url":download_url(source,version,name),"size":1234})).collect::<Vec<_>>()}]).to_string()
    }
    fn platform_check(platform: Platform, current: &str, gitee: &str, github: &str) -> Outcome {
        check_for(current, platform, &mut |s| {
            Ok(if s == Source::Gitee { gitee } else { github }.into())
        })
        .unwrap()
    }
    const MAC: Platform = Platform {
        os: "macos",
        arch: "aarch64",
    };
    const INTEL: Platform = Platform {
        os: "macos",
        arch: "x86_64",
    };
    const WIN: Platform = Platform {
        os: "windows",
        arch: "x86_64",
    };

    #[test]
    fn windows_only_release_does_not_mark_mac_outdated_and_inverse() {
        let mac = fixture(Source::Github, "0.0.6", &["Thingary-0.0.6-universal.dmg"]);
        let win = fixture(Source::Gitee, "0.0.7", &["Thingary_0.0.7_x64-setup.exe"]);
        let out = platform_check(MAC, "0.0.6", &win, &mac);
        assert!(!out.update_available);
        assert_eq!(out.latest.unwrap().version, "0.0.6");
        assert_eq!(out.newer_unavailable.unwrap().version, "0.0.7");
        let out = platform_check(WIN, "0.0.5", &win, &mac);
        assert!(out.update_available);
        assert_eq!(out.latest.unwrap().version, "0.0.7");
        let newer_mac = fixture(Source::Github, "0.0.8", &["Thingary-0.0.8-universal.dmg"]);
        let out = platform_check(WIN, "0.0.7", &win, &newer_mac);
        assert!(!out.update_available);
        assert_eq!(out.newer_unavailable.unwrap().version, "0.0.8");
    }
    #[test]
    fn universal_preferred_and_sources_with_missing_assets_not_offered() {
        let gitee = fixture(Source::Gitee, "0.0.7", &["Thingary_0.0.7_x64-setup.exe"]);
        let github = fixture(
            Source::Github,
            "0.0.7",
            &["Thingary-0.0.7-arm64.dmg", "Thingary-0.0.7-universal.dmg"],
        );
        for platform in [MAC, INTEL] {
            let out = platform_check(platform, "0.0.6", &gitee, &github);
            assert!(out.update_available);
            let d = out.latest.unwrap().downloads;
            assert_eq!(d.len(), 1);
            assert_eq!(d[0].source, Source::Github);
            assert_eq!(d[0].name, "Thingary-0.0.7-universal.dmg");
        }
        let gitee = fixture(Source::Gitee, "0.0.7", &["Thingary-0.0.7-arm64.dmg"]);
        let downloads = platform_check(MAC, "0.0.6", &gitee, &github)
            .latest
            .unwrap()
            .downloads;
        assert_eq!(downloads.len(), 2);
        assert_eq!(downloads[0].source, Source::Github);
        assert_eq!(downloads[0].name, "Thingary-0.0.7-universal.dmg");
    }
    #[test]
    fn architecture_and_version_must_match_even_with_installer_extension() {
        let github = fixture(
            Source::Github,
            "0.0.7",
            &["Thingary-0.0.7-arm64.dmg", "Thingary-0.0.6-universal.dmg"],
        );
        assert!(platform_check(MAC, "0.0.6", "[]", &github).update_available);
        let out = platform_check(INTEL, "0.0.6", "[]", &github);
        assert!(!out.update_available && out.latest.is_none());
        let github = fixture(Source::Github, "0.0.7", &["Thingary_0.0.7_arm64-setup.exe"]);
        assert!(!platform_check(WIN, "0.0.6", "[]", &github).update_available);
    }
    #[test]
    fn urls_draft_assets_and_empty_files_are_rejected() {
        let good = fixture(Source::Github, "0.0.7", &["Thingary-0.0.7-universal.dmg"]);
        for bad in ["https://evil.example/Thingary-0.0.7-universal.dmg", "https://github.com/CoderJackZhu/Thingary/releases/download/v0.0.6/Thingary-0.0.7-universal.dmg", "https://github.com/CoderJackZhu/Thingary/releases/download/v0.0.7/Thingary-0.0.7-universal.dmg?redirect=evil"] {
            let mut v:serde_json::Value=serde_json::from_str(&good).unwrap();
            v[0]["assets"][0]["browser_download_url"]=bad.into();
            assert!(!platform_check(MAC,"0.0.6","[]",&v.to_string()).update_available);
        }
        for (field, value) in [
            ("size", serde_json::json!(0)),
            ("state", serde_json::json!("new")),
        ] {
            let mut v: serde_json::Value = serde_json::from_str(&good).unwrap();
            v[0]["assets"][0][field] = value;
            assert!(!platform_check(MAC, "0.0.6", "[]", &v.to_string()).update_available);
        }
        let mut v: serde_json::Value = serde_json::from_str(&good).unwrap();
        v[0]["draft"] = true.into();
        assert!(platform_check(MAC, "0.0.6", "[]", &v.to_string())
            .latest
            .is_none());
        for name in [
            "../Thingary-0.0.7-universal.dmg",
            "Thingary-0.0.7-universal.dmg.exe",
            "Source code.zip",
            "Thingary_0.0.7_x64-setup.exe",
        ] {
            assert!(validated_download(MAC, "0.0.7", "github", name).is_err());
        }
    }
    #[test]
    fn gitee_array_and_link_shapes_and_encoded_windows_names_work() {
        let mut v: serde_json::Value = serde_json::from_str(&fixture(
            Source::Gitee,
            "0.0.7",
            &["物谱_0.0.7_x64-setup.exe"],
        ))
        .unwrap();
        let a = v[0]["assets"].take();
        v[0]["assets"] = serde_json::json!({"links":a});
        let out = platform_check(WIN, "0.0.6", &v.to_string(), "[]");
        assert!(out.update_available);
        assert_eq!(out.latest.unwrap().downloads[0].source, Source::Gitee);
        assert!(
            validated_download(WIN, "0.0.7", "gitee", "物谱_0.0.7_x64-setup.exe")
                .unwrap()
                .contains("%E7%89%A9%E8%B0%B1")
        );
        v[0]["assets"]["links"][0]["browser_download_url"] = "https://gitee.com/CoderJackZhu/thingary/releases/download/v0.0.7/物谱_0.0.7_x64-setup.exe".into();
        assert!(platform_check(WIN, "0.0.6", &v.to_string(), "[]").update_available);
    }
}
