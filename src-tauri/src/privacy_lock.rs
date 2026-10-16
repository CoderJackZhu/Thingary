//! Screen privacy only: this bridge does not open a Store or encrypt files.
use crate::domain::{Error, Result};
#[cfg(target_os = "macos")]
use std::ffi::{c_char, c_void, CStr};

#[cfg(target_os = "macos")]
extern "C" {
    fn thingary_auth_available() -> i32;
    fn thingary_auth(reason: *const c_char) -> *mut c_char;
    fn thingary_free(ptr: *mut c_void);
}

fn unavailable() -> Error {
    if cfg!(target_os = "macos") {
        Error::new("AUTH_UNAVAILABLE", "这台 Mac 没有设置登录密码或 Touch ID")
    } else {
        Error::new("UNSUPPORTED", "当前平台暂不支持验证身份")
    }
}

fn available() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { thingary_auth_available() == 1 }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn authenticate_if_available(
    can_auth: bool,
    authenticate: impl FnOnce() -> Result<()>,
) -> Result<()> {
    if !can_auth {
        return Err(unavailable());
    }
    authenticate()
}

fn authenticate() -> Result<()> {
    authenticate_if_available(available(), || {
        #[cfg(target_os = "macos")]
        {
            let result = unsafe { thingary_auth(c"解锁物谱，查看本机资料".as_ptr()) };
            if result.is_null() {
                return Err(Error::new("AUTH_FAILED", "身份验证暂不可用，请重试。"));
            }
            let message = unsafe { CStr::from_ptr(result) }
                .to_string_lossy()
                .into_owned();
            unsafe { thingary_free(result.cast()) };
            if message.is_empty() {
                Ok(())
            } else {
                Err(Error::new("AUTH_FAILED", &message))
            }
        }
        #[cfg(not(target_os = "macos"))]
        Err(unavailable())
    })
}

#[tauri::command]
pub async fn privacy_auth_available() -> Result<bool> {
    tauri::async_runtime::spawn_blocking(available)
        .await
        .map_err(|_| Error::new("AUTH_FAILED", "无法检查身份验证能力，请重试。"))
}

#[tauri::command]
pub async fn privacy_authenticate() -> Result<()> {
    tauri::async_runtime::spawn_blocking(authenticate)
        .await
        .map_err(|_| Error::new("AUTH_FAILED", "身份验证未完成，请重试。"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_never_attempts_authentication() {
        let error = authenticate_if_available(false, || panic!("must not prompt")).unwrap_err();
        assert_eq!(error.code, unavailable().code);
        assert!(!error.message.is_empty());
    }

    #[test]
    fn authentication_result_is_preserved() {
        assert!(authenticate_if_available(true, || Ok(())).is_ok());
        let error = authenticate_if_available(true, || Err(Error::new("AUTH_FAILED", "虚构取消")))
            .unwrap_err();
        assert_eq!(error.message, "虚构取消");
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_platform_does_not_prompt() {
        assert!(!available());
        assert_eq!(authenticate().unwrap_err().code, "UNSUPPORTED");
    }
}
