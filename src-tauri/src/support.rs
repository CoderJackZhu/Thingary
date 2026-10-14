use crate::domain::{Error, Result};

/// Fixed public destinations. Opening them never reads the library or builds
/// a URL from records, device metadata, free text, or arbitrary IPC input.
pub fn destination(target: &str) -> Result<&'static str> {
    match target {
        "author" => Ok("https://github.com/CoderJackZhu"),
        "project" => Ok("https://github.com/CoderJackZhu/Thingary"),
        "guide" => Ok("https://github.com/CoderJackZhu/Thingary/blob/main/docs/USER_GUIDE.md"),
        "feedback" => Ok("https://github.com/CoderJackZhu/Thingary/issues"),
        "backup" => {
            Ok("https://github.com/CoderJackZhu/Thingary/blob/main/docs/USER_GUIDE.md#backup")
        }
        "update" => {
            Ok("https://github.com/CoderJackZhu/Thingary/blob/main/docs/USER_GUIDE.md#update")
        }
        "sources" => Ok("https://github.com/CoderJackZhu/Thingary/blob/main/SOURCE_NOTICES.md"),
        _ => Err(Error::new("SUPPORT", "帮助入口无效")),
    }
}

pub fn open(target: &str) -> Result<()> {
    let url = destination(target)?;
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
    #[cfg(not(windows))]
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
