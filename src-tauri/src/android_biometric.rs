//! Device-owner authentication only; no Store, credentials or biometric details.
use crate::domain::{Error, Result};
use serde::Deserialize;
use serde_json::json;
use std::sync::OnceLock;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};

// Keep the existing parameterless privacy commands unchanged on every platform.
static PLUGIN: OnceLock<PluginHandle<tauri::Wry>> = OnceLock::new();

pub fn plugin() -> TauriPlugin<tauri::Wry> {
    Builder::new("thingary-biometric")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin(&app.config().identifier, "BiometricPlugin")?;
            let _ = PLUGIN.set(handle);
            Ok(())
        })
        .build()
}

#[derive(Deserialize)]
struct Availability {
    available: bool,
}

#[derive(Deserialize)]
struct Authentication {
    status: String,
}

pub fn available() -> bool {
    PLUGIN
        .get()
        .and_then(|plugin| {
            plugin
                .run_mobile_plugin::<Availability>("available", json!({}))
                .ok()
        })
        .is_some_and(|result| result.available)
}

pub fn authenticate() -> Result<()> {
    let result = PLUGIN
        .get()
        .ok_or_else(|| Error::new("AUTH_FAILED", "身份验证暂不可用，请重试。"))?
        .run_mobile_plugin::<Authentication>("authenticate", json!({}))
        // Never include platform errors or authentication details in logs/messages.
        .map_err(|_| Error::new("AUTH_FAILED", "身份验证未完成，请重试。"))?;
    let message = match result.status.as_str() {
        "success" => return Ok(()),
        "unavailable" => {
            return Err(Error::new(
                "AUTH_UNAVAILABLE",
                "这台设备没有设置锁屏口令或生物识别",
            ));
        }
        "cancelled" => "已取消身份验证，请点解锁重试。",
        "failed" => "身份验证未通过，请重试。",
        "timeout" => "身份验证已超时，请点解锁重试。",
        _ => "暂时无法验证身份，请重试或使用设备密码。",
    };
    Err(Error::new("AUTH_FAILED", message))
}
