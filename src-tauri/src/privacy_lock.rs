//! Screen privacy only: this bridge does not open a Store or encrypt files.
use crate::domain::{Error, Result};
#[cfg(target_os = "ios")]
extern "C" {
    fn thingary_auth_method() -> i32;
}

pub(crate) fn auth_name() -> &'static str {
    #[cfg(target_os = "ios")]
    match unsafe { thingary_auth_method() } {
        2 => return "面容 ID",
        1 => return "触控 ID",
        _ => {}
    }
    #[cfg(target_os = "android")]
    {
        "设备解锁"
    }
    #[cfg(not(target_os = "android"))]
    {
        "身份验证"
    }
}
#[cfg(any(target_os = "macos", target_os = "ios"))]
use std::ffi::{c_char, c_void, CStr};

#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" {
    fn thingary_auth_available() -> i32;
    fn thingary_auth(reason: *const c_char) -> *mut c_char;
    fn thingary_free(ptr: *mut c_void);
}

fn unavailable() -> Error {
    #[cfg(target_os = "android")]
    {
        Error::new("AUTH_UNAVAILABLE", "这台设备没有设置锁屏口令或生物识别")
    }
    #[cfg(not(target_os = "android"))]
    if cfg!(target_os = "macos") {
        Error::new("AUTH_UNAVAILABLE", "这台 Mac 没有设置登录密码或 Touch ID")
    } else if cfg!(target_os = "ios") {
        Error::new(
            "AUTH_UNAVAILABLE",
            "这台 iPhone 没有设置设备密码或面容／触控 ID",
        )
    } else {
        Error::new("UNSUPPORTED", "当前平台暂不支持验证身份")
    }
}

fn available() -> bool {
    #[cfg(target_os = "android")]
    {
        crate::android_biometric::available().unwrap_or(false)
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        unsafe { thingary_auth_available() == 1 }
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
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
        #[cfg(target_os = "android")]
        {
            crate::android_biometric::authenticate()
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
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
        #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
        Err(unavailable())
    })
}

#[tauri::command]
pub async fn privacy_auth_available() -> Result<bool> {
    #[cfg(target_os = "android")]
    {
        // A broken bridge is an error, not "this device has no screen lock": the
        // frontend disables the lock when the answer is a definite false.
        tauri::async_runtime::spawn_blocking(|| {
            crate::android_biometric::available()
                .ok_or_else(|| Error::new("AUTH_FAILED", "无法检查身份验证能力，请重试。"))
        })
        .await
        .map_err(|_| Error::new("AUTH_FAILED", "无法检查身份验证能力，请重试。"))?
    }
    #[cfg(not(target_os = "android"))]
    {
        tauri::async_runtime::spawn_blocking(available)
            .await
            .map_err(|_| Error::new("AUTH_FAILED", "无法检查身份验证能力，请重试。"))
    }
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

    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    #[test]
    fn unsupported_platform_does_not_prompt() {
        assert!(!available());
        assert_eq!(authenticate().unwrap_err().code, "UNSUPPORTED");
    }
}
