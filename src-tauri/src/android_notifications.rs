//! Android-only notification bridge. Calls originate on blocking workers;
//! Kotlin owns permission UI, private preferences and AlarmManager scheduling.
use crate::domain::{Error, Result};
use serde::Deserialize;
use std::sync::OnceLock;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};

static PLUGIN: OnceLock<PluginHandle<tauri::Wry>> = OnceLock::new();

pub fn plugin() -> TauriPlugin<tauri::Wry> {
    Builder::new("thingary-notifications")
        .setup(|_app, api| {
            let handle =
                api.register_android_plugin(crate::android::PLUGIN_PACKAGE, "NotificationsPlugin")?;
            PLUGIN.set(handle).map_err(|_| "通知服务已经初始化")?;
            Ok(())
        })
        .build()
}

#[derive(Deserialize)]
struct Reply {
    message: String,
}

fn call(command: &str, args: serde_json::Value) -> Result<()> {
    let plugin = PLUGIN
        .get()
        .ok_or_else(|| Error::new("REMINDER", "通知服务不可用，请重试"))?;
    let reply: Reply = plugin
        .run_mobile_plugin(command, args)
        .map_err(|_| Error::new("REMINDER", "通知服务未及时响应，请重试"))?;
    if reply.message.is_empty() {
        Ok(())
    } else {
        Err(Error::new("REMINDER", &reply.message))
    }
}

pub fn native(json: &str, ask: bool) -> Result<()> {
    call("native", serde_json::json!({ "json": json, "ask": ask }))
}

pub fn open_settings() -> Result<()> {
    call("openSettings", serde_json::json!({}))
}
