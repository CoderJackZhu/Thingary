pub mod backup;
pub mod catalog;
mod commands;
pub mod domain;
pub mod files;
pub mod native_images;
pub mod photos;
mod recovery;
pub mod storage;
pub mod trash;
pub mod worker;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(worker::Worker::start(
                app.path().app_data_dir()?.join("library"),
            )?);
            app.manage(commands::EditGuard::default());
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as Item, Submenu};
            let quit =
                MenuItem::with_id(app, "quit-possio", "退出物志", true, Some("CmdOrCtrl+Q"))?;
            let app_menu = Submenu::with_items(
                app,
                "物志",
                true,
                &[
                    &Item::about(app, Some("关于物志"), None)?,
                    &Item::separator(app)?,
                    &Item::hide(app, Some("隐藏物志"))?,
                    &Item::hide_others(app, Some("隐藏其他"))?,
                    &Item::show_all(app, Some("显示全部"))?,
                    &Item::separator(app)?,
                    &quit,
                ],
            )?;
            let file_menu = Submenu::with_items(
                app,
                "文件",
                true,
                &[
                    &MenuItem::with_id(app, "new-asset", "新增物品", true, Some("CmdOrCtrl+N"))?,
                    &Item::close_window(app, Some("关闭窗口"))?,
                ],
            )?;
            let edit_menu = Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &Item::undo(app, Some("撤销"))?,
                    &Item::redo(app, Some("重做"))?,
                    &Item::separator(app)?,
                    &Item::cut(app, Some("剪切"))?,
                    &Item::copy(app, Some("复制"))?,
                    &Item::paste(app, Some("粘贴"))?,
                    &Item::select_all(app, Some("全选"))?,
                    &Item::separator(app)?,
                    &MenuItem::with_id(app, "find-asset", "搜索物品", true, Some("CmdOrCtrl+F"))?,
                    &MenuItem::with_id(app, "edit-asset", "编辑资料", true, Some("CmdOrCtrl+E"))?,
                ],
            )?;
            let window_menu = Submenu::with_items(
                app,
                "窗口",
                true,
                &[
                    &Item::minimize(app, Some("最小化"))?,
                    &Item::maximize(app, Some("缩放"))?,
                ],
            )?;
            app.set_menu(Menu::with_items(
                app,
                &[&app_menu, &file_menu, &edit_menu, &window_menu],
            )?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::snapshot,
            commands::save_sample,
            commands::list_assets,
            commands::read_asset,
            commands::save_asset,
            commands::change_trash,
            commands::saved_request,
            commands::set_editing,
            commands::finish_close,
            commands::set_appearance,
            commands::pick_photo,
            commands::photo_preview
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .on_menu_event(|app, event| {
            let action = event.id().as_ref();
            if matches!(action, "new-asset" | "find-asset" | "edit-asset") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                    let _ = w.emit("asset-action", action);
                }
            }
            if action == "quit-possio" {
                if app.state::<commands::EditGuard>().0.load(Ordering::SeqCst) {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.emit("close-intent", true);
                    }
                } else {
                    app.exit(0);
                }
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window
                    .state::<commands::EditGuard>()
                    .0
                    .load(Ordering::SeqCst)
                {
                    let _ = window.emit("close-intent", false);
                } else {
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Cannot start Possio preview")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                if app.state::<commands::EditGuard>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.emit("close-intent", true);
                    }
                }
            }
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
