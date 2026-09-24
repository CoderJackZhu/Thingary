use crate::{
    domain::{Asset, Error, Result, Save},
    worker::Worker,
};
use serde::Serialize;
#[derive(Serialize)]
pub struct Snapshot {
    pub generation: String,
    pub asset: Option<Asset>,
    pub sqlite_version: String,
}
#[tauri::command]
pub async fn snapshot(worker: tauri::State<'_, Worker>) -> Result<Snapshot> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(|s| {
            Ok(Snapshot {
                generation: s.generation(),
                asset: s.first_asset()?,
                sqlite_version: s.sqlite_version()?,
            })
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "无法读取验证资料"))?
}
#[tauri::command]
pub async fn save_sample(input: Save, worker: tauri::State<'_, Worker>) -> Result<Asset> {
    // This experiment only accepts a known synthetic fixture; no real-data form yet.
    if !["虚构相机 · 初始记录", "虚构相机 · 补录记录"].contains(&input.name.as_str())
    {
        return Err(Error::new("FIXTURE", "验证版只接受内置虚构样例"));
    }
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.save(&input, &chrono::Local::now().format("%Y-%m-%d").to_string()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到保存结果，请重试"))?
}

use crate::catalog::{AssetRecord, Page, Query, SaveAsset};
use std::sync::atomic::{AtomicBool, Ordering};
#[derive(Default)]
pub struct EditGuard(pub AtomicBool);
#[tauri::command]
pub async fn list_assets(query: Query, worker: tauri::State<'_, Worker>) -> Result<Page> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.query_assets(&query, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "读取失败，请重试"))?
}
#[tauri::command]
pub async fn read_asset(
    id: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<AssetRecord>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.record(&id)))
        .await
        .map_err(|_| Error::new("WORKER", "读取失败，请重试"))?
}
#[tauri::command]
pub async fn save_asset(input: SaveAsset, worker: tauri::State<'_, Worker>) -> Result<AssetRecord> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.save_asset(&input, &chrono::Local::now().format("%Y-%m-%d").to_string()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到保存结果，请检查该次提交"))?
}
#[tauri::command]
pub async fn saved_request(
    request: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<AssetRecord>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.saved_request(&request, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "无法核对保存结果，请重试"))?
}
#[tauri::command]
pub fn set_editing(editing: bool, guard: tauri::State<'_, EditGuard>) {
    guard.0.store(editing, Ordering::SeqCst);
}
#[tauri::command]
pub fn finish_close(
    quit: bool,
    app: tauri::AppHandle,
    guard: tauri::State<'_, EditGuard>,
) -> Result<()> {
    guard.0.store(false, Ordering::SeqCst);
    if quit {
        app.exit(0);
    } else {
        use tauri::Manager;
        if let Some(w) = app.get_webview_window("main") {
            w.hide().map_err(|_| Error::new("WINDOW", "无法关闭窗口"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_appearance(appearance: String, window: tauri::WebviewWindow) -> Result<()> {
    let theme = match appearance.as_str() {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        "system" => None,
        _ => return Err(Error::new("THEME", "不支持的外观")),
    };
    window
        .set_theme(theme)
        .map_err(|_| Error::new("THEME", "外观切换失败"))
}

#[tauri::command]
pub async fn change_trash(
    input: crate::trash::TrashChange,
    worker: tauri::State<'_, Worker>,
) -> Result<AssetRecord> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.change_trash(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "未收到操作结果，请核对本次请求"))?
}

#[tauri::command]
pub async fn pick_photo(
    app: tauri::AppHandle,
    generation: String,
    repair: Option<String>,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<crate::photos::Photo>> {
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(crate::native_images::pick());
    })
    .map_err(|_| Error::new("PICKER", "无法打开图片选择器"))?;
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = receive
            .recv()
            .map_err(|_| Error::new("PICKER", "图片选择器未返回结果"))?;
        match path {
            None => Ok(None),
            Some(path) => w.call(move |s| {
                s.stage_photo_path(&path, &generation, repair.as_deref())
                    .map(Some)
            }),
        }
    })
    .await
    .map_err(|_| Error::new("WORKER", "图片未能读取，请重新选择"))?
}
#[tauri::command]
pub async fn photo_preview(
    id: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<tauri::ipc::Response> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.photo_preview(&id, &generation)))
        .await
        .map_err(|_| Error::new("WORKER", "图片预览失败"))?
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn taxonomy_snapshot(
    worker: tauri::State<'_, Worker>,
) -> Result<crate::taxonomy::Snapshot> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(|s| s.taxonomy_snapshot()))
        .await
        .map_err(|_| Error::new("WORKER", "分类与渠道读取失败"))?
}
#[tauri::command]
pub async fn change_taxonomy(
    input: crate::taxonomy::Change,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::taxonomy::Snapshot> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.change_taxonomy(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "未收到结果，请核对本次请求"))?
}
#[tauri::command]
pub async fn taxonomy_request(
    request: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<bool> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.taxonomy_request(&request, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "无法核对本次请求"))?
}

#[tauri::command]
pub async fn change_lifecycle(
    input: crate::lifecycle::Change,
    worker: tauri::State<'_, Worker>,
) -> Result<AssetRecord> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.change_lifecycle(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到状态保存结果，请核对本次操作"))?
}

#[tauri::command]
pub async fn change_sale(
    input: crate::sales::Change,
    worker: tauri::State<'_, Worker>,
) -> Result<AssetRecord> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.change_sale(&input, &chrono::Local::now().format("%Y-%m-%d").to_string()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到售出操作结果，请核对本次请求"))?
}
