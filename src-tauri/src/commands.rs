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
#[derive(Default)]
pub struct LibraryGuard(pub AtomicBool);
#[tauri::command]
pub fn set_library_busy(busy: bool, guard: tauri::State<'_, LibraryGuard>) {
    guard.0.store(busy, Ordering::SeqCst);
}
#[tauri::command]
pub async fn demo_status(
    worker: tauri::State<'_, Worker>,
    pending_generation: Option<String>,
) -> Result<crate::worker::DemoStatus> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(generation) = pending_generation {
            w.resume_library(generation)?;
        }
        w.demo_status()
    })
    .await
    .map_err(|_| Error::new("WORKER", "无法读取样例状态"))?
}
#[tauri::command]
pub async fn reset_demo(
    request_id: String,
    worker: tauri::State<'_, Worker>,
    guard: tauri::State<'_, EditGuard>,
    library_guard: tauri::State<'_, LibraryGuard>,
) -> Result<crate::worker::DemoStatus> {
    if guard.0.load(Ordering::SeqCst) || library_guard.0.load(Ordering::SeqCst) {
        return Err(Error::new("EDITING", "请先完成或取消当前编辑"));
    }
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.reset_demo(request_id))
        .await
        .map_err(|_| Error::new("WORKER", "重置结果未返回，请核对本次操作"))?
}
#[tauri::command]
pub async fn switch_demo(
    demo: bool,
    worker: tauri::State<'_, Worker>,
    guard: tauri::State<'_, EditGuard>,
    library_guard: tauri::State<'_, LibraryGuard>,
) -> Result<crate::worker::DemoStatus> {
    if guard.0.load(Ordering::SeqCst) || library_guard.0.load(Ordering::SeqCst) {
        return Err(Error::new("EDITING", "请先完成或取消当前编辑"));
    }
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.switch_demo(demo))
        .await
        .map_err(|_| Error::new("WORKER", "无法切换样例状态"))?
}
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

/// The native ⌘N/⌘F items, renamed to what the current page will do.
pub struct PageMenu {
    pub new: tauri::menu::MenuItem<tauri::Wry>,
    pub find: tauri::menu::MenuItem<tauri::Wry>,
}

/// `None` means the page takes no such shortcut: show a neutral text, disable the item.
#[tauri::command]
pub fn set_page_menu(
    new_label: Option<String>,
    find_label: Option<String>,
    menu: tauri::State<'_, PageMenu>,
) -> Result<()> {
    for (item, label, neutral) in [
        (&menu.new, new_label, "新增"),
        (&menu.find, find_label, "搜索"),
    ] {
        item.set_text(label.as_deref().unwrap_or(neutral))
            .map_err(|_| Error::new("MENU", "菜单更新失败"))?;
        item.set_enabled(label.is_some())
            .map_err(|_| Error::new("MENU", "菜单更新失败"))?;
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
pub async fn list_trash(
    query: crate::trash::TrashQuery,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::trash::TrashPage> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.list_trash(&query)))
        .await
        .map_err(|_| Error::new("WORKER", "最近删除读取失败，请重试"))?
}

#[tauri::command]
pub async fn change_record_trash(
    input: crate::trash::RecordChange,
    worker: tauri::State<'_, Worker>,
) -> Result<AssetRecord> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.change_record_trash(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到操作结果，请核对本次请求"))?
}

#[tauri::command]
pub async fn saved_record_trash_request(
    input: crate::trash::RecordChange,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<AssetRecord>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.saved_record_trash_request(
                &input,
                &chrono::Local::now().format("%Y-%m-%d").to_string(),
            )
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "无法核对删除或恢复结果，请重试"))?
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
pub async fn import_photo_bytes(
    name: String,
    bytes: Vec<u8>,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::photos::Photo> {
    if bytes.len() > crate::files::MAX_IMAGE_BYTES {
        return Err(Error::new("IMAGE_SIZE", "请选择不超过 20 MiB 的图片"));
    }
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.stage_photo(&name, &bytes, &generation, None))
    })
    .await
    .map_err(|_| Error::new("WORKER", "图片未能读取，请重新选择"))?
}
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrepareMaterial {
    pub id: String,
    pub generation: String,
}
#[tauri::command]
pub async fn prepare_material(
    input: PrepareMaterial,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::photos::Photo> {
    // Only catalog ids and stored material ids reach storage; bytes come from
    // the app bundle or the managed library, never from client paths.
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.prepare_material(&input.id, &input.generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "素材准备失败，请重试"))?
}

#[tauri::command]
pub async fn list_materials(
    worker: tauri::State<'_, Worker>,
) -> Result<Vec<crate::materials::MaterialEntry>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(|s| s.material_entries()))
        .await
        .map_err(|_| Error::new("WORKER", "素材读取失败，请重试"))?
}

#[tauri::command]
pub async fn add_material(
    app: tauri::AppHandle,
    generation: String,
    request: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::materials::MaterialEntry> {
    let w = worker.inner().clone();
    let check_request = request.clone();
    let check_generation = generation.clone();
    if let Some(entry) = tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.material_upload_result(&check_request, &check_generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "请核对上传结果"))??
    {
        return Ok(entry);
    }
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
            None => Err(Error::new("PICKER", "已取消，未上传素材。")),
            Some(path) => w.call(move |s| s.add_material_once(&path, &generation, &request)),
        }
    })
    .await
    .map_err(|_| Error::new("WORKER", "素材上传失败，请重试"))?
}

#[tauri::command]
pub async fn material_upload_result(
    request: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<crate::materials::MaterialEntry>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.material_upload_result(&request, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "上传结果暂时无法核对"))?
}

#[tauri::command]
pub async fn remove_material(
    id: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Vec<crate::materials::MaterialEntry>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.remove_material(&id, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "素材删除失败，请重试"))?
}

#[tauri::command]
pub async fn material_preview(
    id: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<tauri::ipc::Response> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.material_preview(&id, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "素材预览失败"))?
    .map(tauri::ipc::Response::new)
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

#[tauri::command]
pub async fn change_maintenance(
    input: crate::maintenance::Change,
    worker: tauri::State<'_, Worker>,
) -> Result<AssetRecord> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.change_maintenance(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到维护保存结果，请核对本次请求"))?
}

#[tauri::command]
pub async fn change_warranty(
    input: crate::warranty::Change,
    worker: tauri::State<'_, Worker>,
) -> Result<AssetRecord> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.change_warranty(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到保障保存结果，请核对本次请求"))?
}

#[tauri::command]
pub async fn list_wishlist(
    query: crate::wishlist::Query,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::wishlist::Page> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.query_wishlist(&query)))
        .await
        .map_err(|_| Error::new("WORKER", "心愿清单读取失败，请重试"))?
}

#[tauri::command]
pub async fn read_wishlist(
    id: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<crate::wishlist::WishlistItem>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.wishlist_item(&id)))
        .await
        .map_err(|_| Error::new("WORKER", "心愿读取失败，请重试"))?
}

#[tauri::command]
pub async fn change_wishlist(
    input: crate::wishlist::Change,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::wishlist::WishlistItem> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.change_wishlist(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "未收到心愿保存结果，请核对本次请求"))?
}

#[tauri::command]
pub async fn saved_wishlist_request(
    input: crate::wishlist::Change,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<crate::wishlist::WishlistItem>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.saved_wishlist_request(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "无法核对心愿保存结果，请重试"))?
}

#[tauri::command]
pub async fn convert_wishlist(
    input: crate::wishlist::Convert,
    worker: tauri::State<'_, Worker>,
) -> Result<AssetRecord> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.convert_wishlist(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到转换结果，请检查该次提交"))?
}

#[tauri::command]
pub async fn stage_wishlist_cover(
    wishlist_id: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::photos::Photo> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.stage_wishlist_cover(&wishlist_id, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "心愿封面准备失败，请重试"))?
}

#[tauri::command]
pub async fn list_timeline(
    query: crate::timeline::Query,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::timeline::Timeline> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.timeline(&query, &chrono::Local::now().format("%Y-%m-%d").to_string()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "时间轴读取失败，请重试"))?
}

#[tauri::command]
pub async fn overview(
    scope: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::insights::Overview> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.overview(&scope, &chrono::Local::now().format("%Y-%m-%d").to_string()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "总览读取失败，请重试"))?
}

#[tauri::command]
pub async fn stats_snapshot(
    period: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::insights::StatsSnapshot> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.stats_snapshot(
                &period,
                &chrono::Local::now().format("%Y-%m-%d").to_string(),
            )
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "统计读取失败，请重试"))?
}

#[tauri::command]
pub async fn purchase_trend(
    granularity: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::insights::Trend> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.purchase_trend(
                &granularity,
                &chrono::Local::now().format("%Y-%m-%d").to_string(),
            )
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "趋势读取失败，请重试"))?
}

#[tauri::command]
pub async fn holding(
    scope: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::insights::Holding> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.holding(&scope, &chrono::Local::now().format("%Y-%m-%d").to_string()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "持有分析读取失败，请重试"))?
}

fn on_main<T: Send + 'static>(
    app: &tauri::AppHandle,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<std::sync::mpsc::Receiver<T>> {
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(f());
    })
    .map_err(|_| Error::new("PICKER", "无法打开文件面板"))?;
    Ok(receive)
}

#[derive(serde::Serialize)]
pub struct BackupDone {
    pub name: String,
    pub folder: String,
}

/// Cancelling the save panel returns `None` and starts no task (AC34).
#[tauri::command]
pub async fn create_backup(
    app: tauri::AppHandle,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<BackupDone>> {
    worker.require_personal()?;
    // The panel appends ".possio" itself; a suggested extension would be doubled.
    let suggested = format!("家底备份-{}", chrono::Local::now().format("%Y%m%d-%H%M"));
    let receive = on_main(&app, move || {
        crate::native_images::pick_save("保存完整备份", "保存备份", &suggested, "possio")
    })?;
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = receive
            .recv()
            .map_err(|_| Error::new("PICKER", "文件面板未返回结果"))?
        else {
            return Ok(None);
        };
        let folder = path
            .parent()
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        let target = path.clone();
        // The storage worker is serial: edits queued meanwhile wait for the snapshot.
        let name = w
            .call_personal(move |s| s.backup(Some(&target)))?
            .unwrap_or_default();
        Ok(Some(BackupDone { name, folder }))
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到备份结果，请到目标位置核对"))?
}

#[derive(serde::Serialize)]
pub struct Inspected {
    pub path: String,
    pub name: String,
    pub summary: crate::backup::Summary,
}

#[tauri::command]
pub async fn inspect_backup(
    app: tauri::AppHandle,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<Inspected>> {
    worker.require_personal()?;
    let receive = on_main(&app, crate::native_images::pick_backup_open)?;
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = receive
            .recv()
            .map_err(|_| Error::new("PICKER", "文件面板未返回结果"))?
        else {
            return Ok(None);
        };
        let target = path.clone();
        let summary = w.call_personal(move |s| s.inspect_backup(&target))?;
        Ok(Some(Inspected {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            path: path.to_string_lossy().into(),
            summary,
        }))
    })
    .await
    .map_err(|_| Error::new("WORKER", "备份检查未完成，请重试"))?
}

/// Restores only the bytes whose hash the user confirmed; returns the new generation.
#[tauri::command]
pub async fn restore_backup(
    path: String,
    hash: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<String> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call_personal(move |s| s.restore(std::path::Path::new(&path), &hash, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到恢复结果，请重新启动后核对"))?
}

/// Automatic backup state for the settings page; readable in sample mode too.
#[tauri::command]
pub async fn auto_backup_status(
    worker: tauri::State<'_, Worker>,
) -> Result<crate::auto_backup::Status> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.auto_backup_status())
        .await
        .map_err(|_| Error::new("WORKER", "自动备份状态读取失败，请重试"))?
}

#[tauri::command]
pub async fn auto_backup_set_enabled(
    enabled: bool,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::auto_backup::Status> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.auto_backup_set_enabled(enabled))
        .await
        .map_err(|_| Error::new("WORKER", "自动备份设置未保存，请重试"))?
}

/// Opens a folder panel; cancelling keeps the current extra location.
#[tauri::command]
pub async fn auto_backup_choose_extra(
    app: tauri::AppHandle,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<crate::auto_backup::Status>> {
    let receive = on_main(&app, crate::native_images::pick_folder)?;
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = receive
            .recv()
            .map_err(|_| Error::new("PICKER", "文件夹面板未返回结果"))?
        else {
            return Ok(None);
        };
        w.auto_backup_set_extra(path.clone())?;
        // Copy the newest archive right away, outside the worker thread.
        let status = w.auto_backup_status()?;
        if let Some(newest) = status.items.first() {
            let source = std::path::Path::new(&status.folder).join(&newest.name);
            w.auto_backup_extra_now(&source);
        }
        Ok(Some(w.auto_backup_status()?))
    })
    .await
    .map_err(|_| Error::new("WORKER", "额外备份位置未更新，请重试"))?
}

#[tauri::command]
pub async fn auto_backup_clear_extra(
    worker: tauri::State<'_, Worker>,
) -> Result<crate::auto_backup::Status> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.auto_backup_clear_extra())
        .await
        .map_err(|_| Error::new("WORKER", "额外备份位置未取消，请重试"))?
}

#[tauri::command]
pub async fn auto_backup_open_folder(worker: tauri::State<'_, Worker>) -> Result<()> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let folder = w.auto_backup_folder()?;
        std::process::Command::new("/usr/bin/open")
            .arg(&folder)
            .spawn()
            .map_err(|_| Error::new("OPEN", "未能打开备份文件夹"))?;
        Ok(())
    })
    .await
    .map_err(|_| Error::new("WORKER", "未能打开备份文件夹"))?
}

/// Inspects one dated automatic backup by name; the restore itself reuses
/// `restore_backup` with the confirmed hash.
#[tauri::command]
pub async fn inspect_auto_backup(
    name: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Inspected> {
    worker.require_personal()?;
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let target = w.auto_backup_resolve(&name)?;
        let path = target.display().to_string();
        let summary = w.call_personal(move |s| s.inspect_backup(&target))?;
        Ok(Inspected {
            name,
            path,
            summary,
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "备份检查未完成，请重试"))?
}

#[derive(serde::Serialize)]
pub struct CsvDone {
    pub name: String,
    pub folder: String,
    pub rows: i64,
}

/// Saves the header-only import template; cancelling writes nothing.
#[tauri::command]
pub async fn save_csv_template(app: tauri::AppHandle) -> Result<Option<String>> {
    let receive = on_main(&app, || {
        crate::native_images::pick_save("下载导入模板", "保存", "家底导入模板", "csv")
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = receive
            .recv()
            .map_err(|_| Error::new("PICKER", "文件面板未返回结果"))?
        else {
            return Ok(None);
        };
        crate::csv_import::write_template(&path)?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "模板未保存，请重试"))?
}

#[derive(serde::Serialize)]
pub struct CsvInspected {
    pub path: String,
    pub name: String,
    pub preview: crate::csv_import::Preview,
}

fn read_import(path: &std::path::Path) -> Result<Vec<u8>> {
    let size = std::fs::metadata(path)
        .map_err(|_| Error::new("CSV_READ", "无法读取所选文件"))?
        .len();
    if size > crate::csv_import::MAX_BYTES as u64 {
        return Err(Error::new("CSV_SIZE", "文件超过 5 MB，请拆分后分批导入"));
    }
    std::fs::read(path).map_err(|_| Error::new("CSV_READ", "无法读取所选文件"))
}

/// Opens a CSV and previews it; nothing is written.
#[tauri::command]
pub async fn inspect_csv_import(
    app: tauri::AppHandle,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<CsvInspected>> {
    worker.require_personal()?;
    let receive = on_main(&app, crate::native_images::pick_csv_open)?;
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = receive
            .recv()
            .map_err(|_| Error::new("PICKER", "文件面板未返回结果"))?
        else {
            return Ok(None);
        };
        let bytes = read_import(&path)?;
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let preview = w.call_personal(move |s| s.preview_csv_import(&bytes, &today))?;
        Ok(Some(CsvInspected {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            path: path.to_string_lossy().into(),
            preview,
        }))
    })
    .await
    .map_err(|_| Error::new("WORKER", "表格检查未完成，请重试"))?
}

#[tauri::command]
pub async fn commit_csv_import(
    worker: tauri::State<'_, Worker>,
    path: String,
    input: crate::csv_import::Commit,
) -> Result<crate::csv_import::Done> {
    let bytes = read_import(std::path::Path::new(&path))?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call_personal(move |s| s.import_csv(&bytes, &input, &today))
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到导入结果，请到物品列表核对"))?
}

/// Cancelling the save panel returns `None` and writes nothing.
#[tauri::command]
pub async fn export_csv(
    app: tauri::AppHandle,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<CsvDone>> {
    worker.require_personal()?;
    let suggested = format!("家底资产表-{}", chrono::Local::now().format("%Y%m%d"));
    let receive = on_main(&app, move || {
        crate::native_images::pick_save("导出资产表", "导出", &suggested, "csv")
    })?;
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = receive
            .recv()
            .map_err(|_| Error::new("PICKER", "文件面板未返回结果"))?
        else {
            return Ok(None);
        };
        let target = path.clone();
        let rows = w.call_personal(move |s| s.export_csv(&target))?;
        Ok(Some(CsvDone {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            folder: path
                .parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
            rows,
        }))
    })
    .await
    .map_err(|_| Error::new("WORKER", "未收到导出结果，请到目标位置核对"))?
}

#[tauri::command]
pub async fn choice_list(
    kind: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::choices::Snapshot> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.choices(&kind)))
        .await
        .map_err(|_| Error::new("WORKER", "选项读取失败"))?
}
#[tauri::command]
pub async fn choice_change(
    input: crate::choices::Change,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::choices::Snapshot> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.change_choices(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "选项保存结果未返回，请重试本次请求"))?
}
#[tauri::command]
pub async fn save_wish_plan(
    input: crate::wish_plan::Save,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::wishlist::WishlistItem> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.save_wish_plan(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "保存结果未返回，请重试本次请求"))?
}
#[tauri::command]
pub async fn save_wish_savings(
    input: crate::wish_plan::Saving,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::wishlist::WishlistItem> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.save_wish_savings(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "攒钱结果未返回，请重试本次请求"))?
}

#[tauri::command]
pub async fn notification_permission(worker: tauri::State<'_, Worker>) -> Result<()> {
    if worker.demo_status()?.active {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(crate::reminders::request_permission)
        .await
        .map_err(|_| Error::new("REMINDER", "通知权限服务不可用"))?
}

#[tauri::command]
pub fn open_notification_settings() -> Result<()> {
    let status = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.notifications")
        .status()
        .map_err(|_| {
            Error::new(
                "REMINDER",
                "无法打开系统设置；请手动打开“系统设置 › 通知 › 家底”",
            )
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::new(
            "REMINDER",
            "无法打开系统设置；请手动打开“系统设置 › 通知 › 家底”",
        ))
    }
}
#[tauri::command]
pub async fn modules_get(worker: tauri::State<'_, Worker>) -> Result<crate::modules::Modules> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.modules())
        .await
        .map_err(|_| Error::new("WORKER", "功能模块读取失败"))?
}
#[tauri::command]
pub async fn modules_set(
    modules: crate::modules::Modules,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::modules::Modules> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.set_modules(modules))
        .await
        .map_err(|_| Error::new("WORKER", "功能模块保存失败"))?
}
#[tauri::command]
pub async fn notification_status(worker: tauri::State<'_, Worker>) -> Result<String> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = w.reminder_snapshot()?;
        crate::reminders::refresh(snapshot);
        Ok(crate::reminders::status())
    })
    .await
    .map_err(|_| Error::new("REMINDER", "通知服务不可用"))?
}
#[tauri::command]
pub async fn saved_wish_feature(
    request: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<crate::wishlist::WishlistItem>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.saved_wish_feature(&request, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "暂时无法核对心愿保存结果"))?
}
fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}
#[tauri::command]
pub async fn wealth_accounts(
    worker: tauri::State<'_, Worker>,
) -> Result<Vec<crate::wealth::Account>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(|s| s.wealth_accounts()))
        .await
        .map_err(|_| Error::new("WORKER", "暂时无法读取账户"))?
}
#[tauri::command]
pub async fn wealth_account_save(
    input: crate::wealth::AccountSave,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::wealth::Account> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.wealth_account_save(&input, &today()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "保存结果未返回，请核对本次请求"))?
}
#[tauri::command]
pub async fn wealth_snapshot(
    id: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<crate::wealth::Snapshot>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.wealth_snapshot(&id)))
        .await
        .map_err(|_| Error::new("WORKER", "暂时无法读取盘点"))?
}
#[tauri::command]
pub async fn wealth_snapshot_draft(
    date: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::wealth::Draft> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.wealth_snapshot_draft(&date)))
        .await
        .map_err(|_| Error::new("WORKER", "暂时无法准备盘点"))?
}
#[tauri::command]
pub async fn wealth_snapshot_save(
    input: crate::wealth::SnapshotSave,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::wealth::Snapshot> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.wealth_snapshot_save(&input, &today()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "保存结果未返回，请核对本次请求"))?
}
#[tauri::command]
pub async fn wealth_request_result(
    request: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<String>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.wealth_request_result(&request, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "暂时无法核对保存结果"))?
}
#[tauri::command]
pub async fn wealth_summary(worker: tauri::State<'_, Worker>) -> Result<crate::wealth::Summary> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(|s| s.wealth_summary()))
        .await
        .map_err(|_| Error::new("WORKER", "暂时无法读取财富概览"))?
}
#[tauri::command]
pub async fn wealth_trash(
    input: crate::wealth::TrashChange,
    worker: tauri::State<'_, Worker>,
) -> Result<()> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.wealth_trash(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "操作结果未返回，请核对本次请求"))?
}
#[tauri::command]
pub async fn asset_ids(query: Query, worker: tauri::State<'_, Worker>) -> Result<Vec<String>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.query_asset_ids(&query, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "读取失败，请重试"))?
}
#[tauri::command]
pub async fn batch_rows(
    ids: Vec<String>,
    worker: tauri::State<'_, Worker>,
) -> Result<Vec<crate::batch::Row>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.batch_rows(&ids)))
        .await
        .map_err(|_| Error::new("WORKER", "读取失败，请重试"))?
}
#[tauri::command]
pub async fn batch_change(
    input: crate::batch::Change,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::batch::Outcome> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.batch_change(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "批量保存结果未返回，请重新读取后核对"))?
}
#[tauri::command]
pub async fn batch_undo(
    input: crate::batch::Undo,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::batch::Outcome> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.batch_undo(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "撤销结果未返回，请重新读取后核对"))?
}
#[tauri::command]
pub async fn purge_trash(
    input: crate::purge::Purge,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::purge::Purged> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.purge_trash(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "操作结果未返回，请核对本次请求"))?
}
#[tauri::command]
pub async fn expense(
    id: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<crate::expenses::Expense>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.expense(&id)))
        .await
        .map_err(|_| Error::new("WORKER", "暂时无法读取支出"))?
}
#[tauri::command]
pub async fn expense_save(
    input: crate::expenses::Save,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::expenses::Expense> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.expense_save(&input, &today())))
        .await
        .map_err(|_| Error::new("WORKER", "保存结果未返回，请核对本次请求"))?
}
#[tauri::command]
pub async fn expense_view(
    year: Option<i32>,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::expenses::View> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.expense_view(year)))
        .await
        .map_err(|_| Error::new("WORKER", "暂时无法读取重要支出"))?
}
#[tauri::command]
pub async fn recurring_overview(
    worker: tauri::State<'_, Worker>,
) -> Result<crate::recurring::Overview> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(|s| s.recurring_overview(&today())))
        .await
        .map_err(|_| Error::new("WORKER", "暂时无法读取周期费用"))?
}
#[tauri::command]
pub async fn recurring_plan_save(
    input: crate::recurring::PlanSave,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::recurring::Plan> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.recurring_plan_save(&input, &today()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "保存结果未返回，请核对本次请求"))?
}
#[tauri::command]
pub async fn recurring_payment_save(
    input: crate::recurring::PaymentSave,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::recurring::Payment> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.recurring_payment_save(&input, &today()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "保存结果未返回，请核对本次请求"))?
}
#[tauri::command]
pub async fn virtual_overview(
    worker: tauri::State<'_, Worker>,
) -> Result<crate::virtual_assets::Overview> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(|s| s.virtual_overview(&today())))
        .await
        .map_err(|_| Error::new("WORKER", "暂时无法读取虚拟资产"))?
}
#[tauri::command]
pub async fn virtual_save(
    input: crate::virtual_assets::Save,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::virtual_assets::VirtualAsset> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.virtual_save(&input, &today())))
        .await
        .map_err(|_| Error::new("WORKER", "保存结果未返回，请核对本次请求"))?
}

#[tauri::command]
pub async fn review_overview(
    year: Option<i32>,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::review::Overview> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.review_overview(year, &today())))
        .await
        .map_err(|_| Error::new("WORKER", "综合回顾读取失败，请重试"))?
}

#[tauri::command]
pub async fn timeline_view(
    query: crate::timeline::Query,
    domain: String,
    year: Option<i32>,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::timeline::Timeline> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.timeline_view(&query, &domain, year, &today()))
    })
    .await
    .map_err(|_| Error::new("WORKER", "时间轴读取失败"))?
}
#[tauri::command]
pub async fn validate_source(
    target: crate::source::Target,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<()> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.validate_source(&target, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "来源读取失败"))?
}
