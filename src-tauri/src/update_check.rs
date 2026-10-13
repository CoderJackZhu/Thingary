//! Opt-in update check: the only network request the app can make, and only
//! when the user presses the button. One read of GitHub's public release list;
//! nothing about the user, the machine or the library is sent.
//!
//! The request goes through the system `curl` so the webview stays closed to
//! the network (the CSP is unchanged) and no HTTP client joins the build.
//! Nothing from the response is trusted beyond version numbers and display
//! text: the release page to open is rebuilt from a validated version.
use crate::domain::{Error, Result};
use serde::{Deserialize, Serialize};
use std::process::Command;

const RELEASES_URL: &str =
    "https://api.github.com/repos/CoderJackZhu/Thingary/releases?per_page=30";
const RELEASE_PAGE: &str = "https://github.com/CoderJackZhu/Thingary/releases/tag/v";
const MAX_BYTES: usize = 2_000_000;
const NOTES_CHARS: usize = 3000;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Release {
    pub version: String,
    pub published_at: String,
    /// Plain text for display only; never rendered as markup.
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Outcome {
    pub current: String,
    pub latest: Option<Release>,
    pub update_available: bool,
}

#[derive(Deserialize)]
struct Raw {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    published_at: Option<String>,
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

/// Published releases with a clean version tag, newest first.
pub fn parse_releases(json: &str) -> Result<Vec<Release>> {
    let raw: Vec<Raw> = serde_json::from_str(json)
        .map_err(|_| Error::new("UPDATE_CHECK", "GitHub 返回的内容无法识别，请稍后再试"))?;
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
                    published_at: r.published_at.unwrap_or_default(),
                    notes: trim_notes(r.body.as_deref().unwrap_or("")),
                },
            ))
        })
        .collect();
    found.sort_by_key(|r| std::cmp::Reverse(r.0));
    Ok(found.into_iter().map(|(_, r)| r).collect())
}

pub fn outcome(current: &str, json: &str) -> Result<Outcome> {
    let mine =
        parse_version(current).ok_or_else(|| Error::new("UPDATE_CHECK", "当前版本号无法识别"))?;
    let latest = parse_releases(json)?.into_iter().next();
    let update_available = latest
        .as_ref()
        .and_then(|r| parse_version(&r.version))
        .is_some_and(|v| v > mine);
    Ok(Outcome {
        current: current.to_owned(),
        latest,
        update_available,
    })
}

fn fetch() -> Result<String> {
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
            "10",
            "--proto",
            "=https",
            "--user-agent",
            concat!("Thingary/", env!("CARGO_PKG_VERSION")),
            "--header",
            "Accept: application/vnd.github+json",
            RELEASES_URL,
        ])
        .output()
        .map_err(|_| Error::new("UPDATE_CHECK", "无法启动网络请求，请稍后再试"))?;
    if !output.status.success() {
        // 22 is an HTTP error such as the public rate limit; the rest are network failures.
        let message = if output.status.code() == Some(22) {
            "GitHub 暂时不可用或请求次数受限，请稍后再试"
        } else {
            "无法连接到 GitHub，请检查网络后重试"
        };
        return Err(Error::new("UPDATE_CHECK", message));
    }
    if output.stdout.len() > MAX_BYTES {
        return Err(Error::new("UPDATE_CHECK", "GitHub 返回的内容过大，已忽略"));
    }
    String::from_utf8(output.stdout)
        .map_err(|_| Error::new("UPDATE_CHECK", "GitHub 返回的内容无法识别，请稍后再试"))
}

/// Runs the one request. Blocking: call from a blocking task.
pub fn check() -> Result<Outcome> {
    outcome(env!("CARGO_PKG_VERSION"), &fetch()?)
}

/// Opens the release page for a version we validated ourselves.
pub fn open_release_page(version: &str) -> Result<()> {
    parse_version(version).ok_or_else(|| Error::new("UPDATE_CHECK", "版本号无效"))?;
    let status = Command::new("open")
        .arg(format!("{RELEASE_PAGE}{version}"))
        .status()
        .map_err(|_| Error::new("UPDATE_CHECK", "无法打开浏览器，请手动访问 GitHub Releases"))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::new(
            "UPDATE_CHECK",
            "无法打开浏览器，请手动访问 GitHub Releases",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"[
      {"tag_name":"v0.0.9","draft":false,"published_at":"2026-10-01T00:00:00Z","body":"nine"},
      {"tag_name":"v0.0.10","draft":false,"published_at":"2026-10-13T00:00:00Z","body":"ten\r\nlines"},
      {"tag_name":"v0.0.11","draft":true,"published_at":null,"body":"unpublished draft"},
      {"tag_name":"v0.1.0-beta.1","draft":false,"published_at":"2026-10-04T00:00:00Z","body":"suffix"},
      {"tag_name":"0.0.99","draft":false,"published_at":"2026-10-05T00:00:00Z","body":"no v"},
      {"tag_name":"v1.2","draft":false,"published_at":null,"body":null}
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
        let releases = parse_releases(LIST).unwrap();
        let versions: Vec<_> = releases.iter().map(|r| r.version.as_str()).collect();
        assert_eq!(versions, ["0.0.10", "0.0.9"]);
        assert_eq!(releases[0].notes, "ten\nlines");
        assert_eq!(releases[0].published_at, "2026-10-13T00:00:00Z");
    }

    #[test]
    fn long_notes_are_cut_and_markup_is_left_as_text() {
        let body = format!("<script>alert(1)</script>{}", "字".repeat(5000));
        let json = format!(
            r#"[{{"tag_name":"v1.0.0","draft":false,"body":{}}}]"#,
            serde_json::to_string(&body).unwrap()
        );
        let release = parse_releases(&json).unwrap().remove(0);
        assert!(release.notes.starts_with("<script>"));
        assert_eq!(release.notes.chars().count(), NOTES_CHARS + 1);
        assert!(release.notes.ends_with('…'));
    }

    #[test]
    fn an_update_is_offered_only_for_a_higher_version() {
        assert!(outcome("0.0.5", LIST).unwrap().update_available);
        let same = outcome("0.0.10", LIST).unwrap();
        assert!(!same.update_available);
        assert_eq!(same.latest.unwrap().version, "0.0.10");
        let ahead = outcome("0.0.11", LIST).unwrap();
        assert!(
            !ahead.update_available,
            "a development build ahead of the releases is not outdated"
        );
        let empty = outcome("0.0.5", "[]").unwrap();
        assert!(empty.latest.is_none() && !empty.update_available);
    }

    #[test]
    fn unreadable_answers_and_versions_are_reported_not_guessed() {
        assert_eq!(
            outcome("0.0.5", "not json").unwrap_err().code,
            "UPDATE_CHECK"
        );
        assert_eq!(
            outcome("0.0.5", r#"{"message":"rate limited"}"#)
                .unwrap_err()
                .code,
            "UPDATE_CHECK"
        );
        assert_eq!(outcome("dev", "[]").unwrap_err().code, "UPDATE_CHECK");
    }

    #[test]
    fn only_a_validated_version_can_build_the_page_to_open() {
        for bad in ["", "1.2", "1.2.3/../../x", "1.2.3 --help", "latest"] {
            assert_eq!(
                open_release_page(bad).unwrap_err().code,
                "UPDATE_CHECK",
                "{bad:?}"
            );
        }
    }
}
