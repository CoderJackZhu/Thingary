use crate::domain::{Error, Result};

/// Fixed public destinations. Opening them never reads the library or builds
/// a URL from records, device metadata, free text, or arbitrary IPC input.
pub fn destination(target: &str) -> Result<&'static str> {
    match target {
        "author" => Ok("https://github.com/CoderJackZhu"),
        "project" => Ok("https://github.com/CoderJackZhu/Thingary"),
        "guide" => Ok("https://thingary.jackzhu.top/guide/"),
        "site" => Ok("https://thingary.jackzhu.top/"),
        "feedback" => {
            Ok("https://github.com/CoderJackZhu/Thingary/issues/new?template=usage_feedback.yml")
        }
        "backup" => Ok("https://thingary.jackzhu.top/guide/backup/"),
        "update" => Ok("https://thingary.jackzhu.top/guide/update/"),
        "sources" => Ok("https://github.com/CoderJackZhu/Thingary/blob/main/SOURCE_NOTICES.md"),
        "mail" => Ok("mailto:feedback@jackzhu.top?subject=%E7%89%A9%E8%B0%B1%E5%8F%8D%E9%A6%88"),
        _ => Err(Error::new("SUPPORT", "帮助入口无效")),
    }
}

/// Only the fixed mail destination accepts a body. Encoding keeps body text
/// from changing the recipient, subject, or adding mail headers.
pub fn destination_with_body(target: &str, body: Option<&str>) -> Result<String> {
    let destination = destination(target)?;
    let Some(body) = body else {
        return Ok(destination.to_owned());
    };
    if target != "mail" || body.len() > 4096 || body.contains('\0') {
        return Err(Error::new("SUPPORT", "反馈邮件内容无效"));
    }
    let mut url =
        tauri::Url::parse(destination).map_err(|_| Error::new("SUPPORT", "帮助入口无效"))?;
    let body = body.replace("\r\n", "\n").replace('\n', "\r\n");
    url.query_pairs_mut().append_pair("body", &body);
    // mailto uses percent-encoded spaces, rather than form encoding's `+`.
    Ok(url.as_str().replace('+', "%20"))
}

/// Android needs the `AppHandle` for the native bridge.
#[cfg(target_os = "android")]
pub fn open(app: &tauri::AppHandle, target: &str, body: Option<&str>) -> Result<()> {
    let url = destination_with_body(target, body)?;
    crate::android_links::open_url(app, &url)
}

#[cfg(not(target_os = "android"))]
pub fn open(target: &str, body: Option<&str>) -> Result<()> {
    if cfg!(target_os = "ios") && target == "update" {
        return Err(Error::new("UNSUPPORTED", "iOS 更新由 App Store 管理"));
    }
    let url = destination_with_body(target, body)?;
    // Windows Explorer launches the user's default browser asynchronously;
    // its exit status is not a browser-launch success signal.
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|_| Error::new("SUPPORT", "无法打开浏览器。"))
    }
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/open")
            .arg(url)
            .status()
            .map_err(|_| Error::new("SUPPORT", "无法打开浏览器。"))?;
        if status.success() {
            Ok(())
        } else {
            Err(Error::new("SUPPORT", "无法打开浏览器。"))
        }
    }
    #[cfg(target_os = "ios")]
    {
        crate::ios::open_url(&url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_targets() {
        assert!(destination("unknown").is_err());
        assert!(destination("author-other").is_err());
    }

    #[test]
    fn mail_body_cannot_change_recipient_or_headers() {
        let body = "问题 + 建议 &bcc=other@example.com\n版本：0.1.0";
        let encoded = destination_with_body("mail", Some(body)).unwrap();
        assert!(!encoded.contains('+'));
        let url = tauri::Url::parse(&encoded).unwrap();
        assert_eq!(url.scheme(), "mailto");
        assert_eq!(url.path(), "feedback@jackzhu.top");
        let pairs: Vec<_> = url.query_pairs().collect();
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, "subject");
        assert_eq!(pairs[0].1, "物谱反馈");
        assert_eq!(pairs[1].0, "body");
        assert_eq!(pairs[1].1, body.replace('\n', "\r\n"));
        assert_eq!(
            destination_with_body("guide", None).unwrap(),
            destination("guide").unwrap()
        );
        assert!(destination_with_body("guide", Some(body)).is_err());
        assert!(destination_with_body("mail", Some(&"x".repeat(4097))).is_err());
        assert!(destination_with_body("mail", Some("bad\0body")).is_err());
    }

    #[test]
    fn rejects_urls_paths_and_unrecognised_targets_before_opening() {
        for target in [
            "",
            "https://example.com",
            "file:///tmp/test",
            "--args",
            "../LICENSE",
            "guide?data=secret",
        ] {
            assert!(destination(target).is_err());
        }
    }
}
