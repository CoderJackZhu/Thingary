//! Opt-in update check: the only network request the app can make, and only
//! when the user presses the button. One read of the public release list of
//! each of two mirrors (Gitee, which many users in China can reach, and
//! GitHub); nothing about the user, the machine or the library is sent.
//!
//! The requests go through the system `curl` so the webview stays closed to
//! the network (the CSP is unchanged) and no HTTP client joins the build.
//! Nothing from a response is trusted beyond version numbers and display
//! text: the release page to open is rebuilt from a validated version.
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

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Release {
    pub version: String,
    pub published_at: String,
    /// Plain text for display only; never rendered as markup.
    pub notes: String,
    /// Mirrors that list this version, in lookup order.
    pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Outcome {
    pub current: String,
    pub latest: Option<Release>,
    pub update_available: bool,
    /// Mirrors that could not be read; the answer then comes from the others.
    pub unreachable: Vec<Source>,
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
pub fn parse_releases(source: Source, json: &str) -> Result<Vec<Release>> {
    let raw: Vec<Raw> = serde_json::from_str(json)
        .map_err(|_| Error::new("UPDATE_CHECK", "更新服务返回的内容无法识别，请稍后再试"))?;
    let mut found: Vec<((u64, u64, u64), Release)> = raw
        .into_iter()
        .filter(|r| !r.draft)
        .filter_map(|r| {
            let version = r.tag_name.strip_prefix('v')?.to_owned();
            let key = parse_version(&version)?;
            Some((
                key,
                Release {
                    version,
                    published_at: r.published_at.or(r.created_at).unwrap_or_default(),
                    notes: trim_notes(r.body.as_deref().unwrap_or("")),
                    sources: vec![source],
                },
            ))
        })
        .collect();
    found.sort_by_key(|r| std::cmp::Reverse(r.0));
    Ok(found.into_iter().map(|(_, r)| r).collect())
}

/// Highest version across the mirrors that answered. A version listed by
/// several mirrors keeps the first mirror's text and records them all.
fn merge(answers: Vec<Vec<Release>>) -> Option<Release> {
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
            }
            None => {
                by_version.insert(key, release);
            }
        }
    }
    by_version.into_values().next_back()
}

/// Looks every mirror up through `fetch` and combines what answered. Fails only
/// when none answered, so one unreachable site never blocks the check.
pub fn check_with(
    current: &str,
    fetch: &mut dyn FnMut(Source) -> Result<String>,
) -> Result<Outcome> {
    let mine =
        parse_version(current).ok_or_else(|| Error::new("UPDATE_CHECK", "当前版本号无法识别"))?;
    let (mut answers, mut unreachable) = (Vec::new(), Vec::new());
    for source in Source::ALL {
        match fetch(source).and_then(|json| parse_releases(source, &json)) {
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
    let latest = merge(answers);
    let update_available = latest
        .as_ref()
        .and_then(|r| parse_version(&r.version))
        .is_some_and(|v| v > mine);
    Ok(Outcome {
        current: current.to_owned(),
        latest,
        update_available,
        unreachable,
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
    let url = format!("{}{version}", source.page());
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|_| Error::new("UPDATE_CHECK", "无法打开浏览器，请手动访问发布页"))
    }
    #[cfg(target_os = "macos")]
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
        let releases = parse_releases(Source::Github, GITHUB).unwrap();
        let versions: Vec<_> = releases.iter().map(|r| r.version.as_str()).collect();
        assert_eq!(versions, ["0.0.10", "0.0.9"]);
        assert_eq!(releases[0].notes, "ten\nlines");
        assert_eq!(releases[0].published_at, "2026-10-13T00:00:00Z");
        assert_eq!(releases[0].sources, [Source::Github]);
        let gitee = parse_releases(Source::Gitee, GITEE).unwrap();
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
        let release = parse_releases(Source::Github, &json).unwrap().remove(0);
        assert!(release.notes.starts_with("<script>"));
        assert_eq!(release.notes.chars().count(), NOTES_CHARS + 1);
        assert!(release.notes.ends_with('…'));
    }

    fn run(current: &str, gitee: Option<&str>, github: Option<&str>) -> Result<Outcome> {
        check_with(current, &mut |s| match (s, gitee, github) {
            (Source::Gitee, Some(j), _) | (Source::Github, _, Some(j)) => Ok(j.to_owned()),
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
}
