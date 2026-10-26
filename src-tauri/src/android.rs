//! Android-only platform bridge. The Kotlin plugin owns window flags; the
//! JavaScript side only sends the privacy-cover preference.
use crate::domain::{Error, Result};
use serde_json::json;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

struct AndroidPlugin<R: Runtime>(PluginHandle<R>);

/// Package of the Kotlin plugin classes. It is the source package, not the application id,
/// so a release build can ship under another applicationId without breaking plugin lookup.
pub(crate) const PLUGIN_PACKAGE: &str = "local.thingary.preview";

/// Registers the Kotlin `ThingaryPlugin` under the app's identifier, so a
/// release build with a different package path still resolves its class.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("thingary")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_PACKAGE, "ThingaryPlugin")?;
            app.manage(AndroidPlugin(handle));
            Ok(())
        })
        .build()
}

/// Adds or clears `FLAG_SECURE`; while set, screenshots, screen recordings and
/// the recent-apps thumbnail hide the window content.
pub fn set_privacy_cover(app: &AppHandle, enabled: bool) -> Result<()> {
    let plugin = app
        .try_state::<AndroidPlugin<tauri::Wry>>()
        .ok_or_else(|| Error::new("ANDROID_PLATFORM", "Android 插件尚未就绪，请重试"))?;
    plugin
        .0
        .run_mobile_plugin("setPrivacyCover", json!({ "enabled": enabled }))
        .map_err(|error| {
            Error::new(
                "ANDROID_PLATFORM",
                &format!("无法设置屏幕隐私遮挡：{error}"),
            )
        })
}
