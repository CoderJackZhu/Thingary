//! Android-only external-link bridge. Callers pass only fixed help
//! destinations from `support::destination`; the Kotlin side accepts nothing
//! but `https://` and `mailto:` as a second boundary.
use crate::domain::{Error, Result};
use serde_json::json;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

struct AndroidLinksPlugin<R: Runtime>(PluginHandle<R>);

/// Registers the Kotlin `LinksPlugin` under the app's identifier, so a
/// release build with a different package path still resolves its class.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("thingary-links")
        .setup(|app, api| {
            let identifier = app.config().identifier.clone();
            let handle = api.register_android_plugin(&identifier, "LinksPlugin")?;
            app.manage(AndroidLinksPlugin(handle));
            Ok(())
        })
        .build()
}

/// Hands one already-allowlisted URL to the system browser or mail app.
pub fn open_url(app: &AppHandle, url: &str) -> Result<()> {
    let plugin = app
        .try_state::<AndroidLinksPlugin<tauri::Wry>>()
        .ok_or_else(|| Error::new("ANDROID_PLATFORM", "Android 插件尚未就绪，请重试"))?;
    plugin
        .0
        .run_mobile_plugin("openUrl", json!({ "url": url }))
        .map_err(|_| Error::new("SUPPORT", "无法打开浏览器。"))
}
