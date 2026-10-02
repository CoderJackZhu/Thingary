pub mod auto_backup;
pub mod backup;
pub mod batch;
pub mod catalog;
pub mod choices;
mod commands;
pub mod csv_export;
pub mod csv_import;
pub mod demo;
mod demo_finance;
pub mod domain;
pub mod expenses;
pub mod files;
pub mod insights;
pub mod lifecycle;
pub mod maintenance;
pub mod materials;
pub mod modules;
pub mod native_images;
pub mod photos;
pub mod preferences;
pub mod purge;
mod recovery;
pub mod recurring;
pub mod reminders;
pub mod review;
pub mod sales;
pub mod source;
pub mod storage;
pub mod tag_investment;
pub mod taxonomy;
pub mod timeline;
pub mod trash;
pub mod virtual_assets;
pub mod warranty;
pub mod wealth;
pub mod wish_plan;
pub mod wishlist;
pub mod worker;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            reminders::enable();
            app.manage(worker::Worker::start(
                app.path().app_data_dir()?.join("library"),
            )?);
            // Periodic automatic backups (D20): a plain thread that ends with
            // the process. Quitting never waits for or triggers a backup, and
            // an interrupted one is made up on a later launch.
            {
                let worker = app.state::<worker::Worker>().inner().clone();
                std::thread::Builder::new()
                    .name("possio-auto-backup".into())
                    .spawn(move || loop {
                        std::thread::sleep(std::time::Duration::from_secs(30));
                        let policy = worker::Policy::production();
                        match worker.auto_backup_tick(&policy) {
                            Ok(worker::TickOutcome::BackedUp(published)) => {
                                worker.auto_backup_extra_now(&published);
                            }
                            Ok(_) => {}
                            Err(error) => eprintln!("自动备份未完成：{error}"),
                        }
                    })?;
            }
            app.manage(commands::EditGuard::default());
            app.manage(commands::LibraryGuard::default());
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as Item, Submenu};
            let quit =
                MenuItem::with_id(app, "quit-possio", "退出物谱", true, Some("CmdOrCtrl+Q"))?;
            let app_menu = Submenu::with_items(
                app,
                "物谱",
                true,
                &[
                    &Item::about(
                        app,
                        Some("关于物谱"),
                        Some(
                            tauri::menu::AboutMetadataBuilder::new()
                                .name(Some("物谱 Thingary"))
                                .credits(Some("物品档案与家底回顾\nYour things, over time\n许可证 GPL-3.0-or-later"))
                                .build(),
                        ),
                    )?,
                    &Item::separator(app)?,
                    &MenuItem::with_id(app, "open-settings", "设置…", true, Some("CmdOrCtrl+,"))?,
                    &Item::separator(app)?,
                    &Item::hide(app, Some("隐藏物谱"))?,
                    &Item::hide_others(app, Some("隐藏其他"))?,
                    &Item::show_all(app, Some("显示全部"))?,
                    &Item::separator(app)?,
                    &quit,
                ],
            )?;
            // ⌘N/⌘F are dispatched by the current page; the page renames them (U12).
            let new_item =
                MenuItem::with_id(app, "new-asset", "新增物品", true, Some("CmdOrCtrl+N"))?;
            let find_item =
                MenuItem::with_id(app, "find-asset", "搜索物品", true, Some("CmdOrCtrl+F"))?;
            app.manage(commands::PageMenu {
                new: new_item.clone(),
                find: find_item.clone(),
            });
            let file_menu = Submenu::with_items(
                app,
                "文件",
                true,
                &[&new_item, &Item::close_window(app, Some("关闭窗口"))?],
            )?;
            let edit_menu = Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    // The page decides: text undo in a field, else the deletion undo bar.
                    &MenuItem::with_id(app, "undo", "撤销", true, Some("CmdOrCtrl+Z"))?,
                    &Item::redo(app, Some("重做"))?,
                    &Item::separator(app)?,
                    &Item::cut(app, Some("剪切"))?,
                    &Item::copy(app, Some("复制"))?,
                    &Item::paste(app, Some("粘贴"))?,
                    // Like 撤销: the page selects text in a field, else every matching item.
                    &MenuItem::with_id(app, "select-all", "全选", true, Some("CmdOrCtrl+A"))?,
                    &Item::separator(app)?,
                    &find_item,
                    &MenuItem::with_id(app, "edit-asset", "编辑资料", true, Some("CmdOrCtrl+E"))?,
                ],
            )?;
            let view_menu = Submenu::with_items(
                app,
                "显示",
                true,
                &[&MenuItem::with_id(
                    app,
                    "toggle-appearance",
                    "切换浅色／深色",
                    true,
                    Some("CmdOrCtrl+Shift+D"),
                )?],
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
                &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
            )?)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::notification_permission,
            commands::modules_get,
            commands::modules_set,
            commands::wealth_accounts,
            commands::wealth_account_save,
            commands::wealth_snapshot,
            commands::wealth_snapshot_draft,
            commands::wealth_snapshot_save,
            commands::wealth_request_result,
            commands::wealth_summary,
            commands::wealth_compare,
            commands::wealth_account_history,
            commands::wealth_trash,
            commands::purge_trash,
            commands::asset_ids,
            commands::asset_counts,
            commands::batch_rows,
            commands::batch_change,
            commands::batch_undo,
            commands::expense,
            commands::expense_save,
            commands::expense_view,
            commands::recurring_overview,
            commands::recurring_plan_save,
            commands::recurring_payment_save,
            commands::virtual_overview,
            commands::virtual_save,
            commands::open_notification_settings,
            commands::notification_status,
            commands::choice_list,
            commands::choice_change,
            commands::saved_wish_feature,
            commands::save_wish_plan,
            commands::save_wish_savings,
            commands::snapshot,
            commands::taxonomy_snapshot,
            commands::change_taxonomy,
            commands::taxonomy_request,
            commands::save_sample,
            commands::demo_status,
            commands::switch_demo,
            commands::reset_demo,
            commands::list_assets,
            commands::tag_investment_view,
            commands::read_asset,
            commands::save_asset,
            commands::change_trash,
            commands::list_trash,
            commands::change_record_trash,
            commands::saved_record_trash_request,
            commands::change_lifecycle,
            commands::change_sale,
            commands::change_maintenance,
            commands::change_warranty,
            commands::list_wishlist,
            commands::read_wishlist,
            commands::change_wishlist,
            commands::saved_wishlist_request,
            commands::convert_wishlist,
            commands::stage_wishlist_cover,
            commands::list_timeline,
            commands::timeline_view,
            commands::validate_source,
            commands::overview,
            commands::review_overview,
            commands::stats_snapshot,
            commands::purchase_trend,
            commands::holding,
            commands::resale_rate,
            commands::create_backup,
            commands::inspect_backup,
            commands::restore_backup,
            commands::auto_backup_status,
            commands::auto_backup_set_enabled,
            commands::auto_backup_choose_extra,
            commands::auto_backup_clear_extra,
            commands::auto_backup_open_folder,
            commands::inspect_auto_backup,
            commands::export_csv,
            commands::save_csv_template,
            commands::inspect_csv_import,
            commands::commit_csv_import,
            commands::saved_request,
            commands::set_editing,
            commands::set_library_busy,
            commands::finish_close,
            commands::set_appearance,
            commands::set_page_menu,
            commands::pick_photo,
            commands::import_photo_bytes,
            commands::photo_preview,
            commands::prepare_material,
            commands::list_materials,
            commands::add_material,
            commands::material_upload_result,
            commands::remove_material,
            commands::material_preview
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .on_menu_event(|app, event| {
            let action = event.id().as_ref();
            if matches!(
                action,
                "new-asset"
                    | "find-asset"
                    | "edit-asset"
                    | "open-settings"
                    | "undo"
                    | "select-all"
                    | "toggle-appearance"
            ) {
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
        .expect("Cannot start Thingary preview")
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
