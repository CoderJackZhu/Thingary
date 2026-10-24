pub mod account_groups;
#[cfg(target_os = "android")]
mod android;
#[cfg(any(target_os = "android", test))]
mod android_files;
pub mod auto_backup;
pub mod backup;
pub mod backup_crypto;
mod backup_jobs;
pub mod backup_security;
pub mod backup_task;
pub mod batch;
pub mod cash_movement;
pub mod catalog;
pub mod checkin_reminder;
pub mod choices;
mod commands;
pub mod csv_export;
pub mod csv_import;
pub use financial_import_parser::{currency, holdings};
pub mod demo;
mod demo_finance;
pub mod domain;
pub mod expenses;
pub mod files;
pub mod finance_sources;
pub mod financial_import;
pub mod financial_import_parser;
pub mod goal_progress;
pub mod insights;
pub mod investment_review;
mod investment_review_commands;
pub mod investment_review_component;
#[cfg(target_os = "ios")]
mod ios;
#[cfg(any(target_os = "ios", test))]
mod ios_exports;
pub mod lifecycle;
pub mod link;
pub mod link_merge;
pub mod maintenance;
pub mod materials;
pub mod modules;
pub mod native_images;
pub mod photos;
pub mod plan_assumptions;
pub mod plan_basic;
pub mod plan_core;
pub mod plan_income;
mod plan_migration;
pub mod plan_profile;
pub mod plan_savings;
pub mod plan_simplified;
mod planning_engine_commands;
pub mod planning_flow_review;
mod planning_followup_commands;
pub mod preferences;
pub mod privacy_lock;
pub mod purge;
mod recovery;
pub mod recurring;
pub mod reminders;
pub mod review;
pub mod sales;
mod savings_goal_commands;
pub mod savings_goals;
pub mod search;
pub mod source;
pub mod spreadsheet;
pub mod storage;
// The Android shell has no external-link bridge yet; commands reports it as unsupported.
#[cfg(not(target_os = "android"))]
mod support;
pub mod sync;
pub mod tag_investment;
pub mod taxonomy;
pub mod timeline;
mod toast_activation;
pub mod trash;
pub mod update_check;
pub mod update_state;
pub mod virtual_assets;
pub mod warranty;
pub mod wealth;
#[cfg(desktop)]
mod window_size;
#[cfg(any(windows, test))]
mod windows_exit;
pub mod wish_plan;
pub mod wishlist;
pub mod worker;
#[cfg(desktop)]
use std::sync::atomic::Ordering;
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;
// Windows exits when the window closes, so page-owned work must also be
// protected. It has no generic discard path; App-owned editing keeps its own.
#[cfg(any(target_os = "windows", test))]
fn windows_close_event(editing: bool, close_blocked: bool) -> Option<&'static str> {
    if close_blocked {
        Some("close-blocked")
    } else if editing {
        Some("close-intent")
    } else {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "android")]
    let builder = tauri::Builder::default()
        .plugin(android::plugin())
        .plugin(android_files::plugin());
    #[cfg(not(target_os = "android"))]
    let builder = tauri::Builder::default();
    let builder = builder
        .setup(|app| {
            #[cfg(desktop)]
            window_size::restore(app.handle());
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows_core::Interface;
                    // The controller and settings belong to this WebView UI thread.
                    let result = unsafe {
                        webview
                            .controller()
                            .CoreWebView2()
                            .and_then(|view| view.Settings())
                            .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
                            .and_then(|settings| {
                                settings.SetAreBrowserAcceleratorKeysEnabled(false)
                            })
                    };
                    if let Err(error) = result {
                        eprintln!("无法关闭浏览器快捷键：{error}");
                    }
                })?;
            }
            #[cfg(target_os = "ios")]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|webview| {
                    use objc2::{msg_send, runtime::AnyObject};
                    // WKWebView defaults to no edge-swipe history navigation; the mobile UI pops pages on popstate.
                    let view = webview.inner().cast::<AnyObject>();
                    if view.is_null() {
                        eprintln!("无法开启边缘返回手势：WKWebView 不可用");
                        return;
                    }
                    // SAFETY: with_webview runs on the main thread and `inner` is the live WKWebView.
                    unsafe {
                        let _: () = msg_send![view, setAllowsBackForwardNavigationGestures: true];
                    }
                })?;
            }
            #[cfg(target_os = "windows")]
            reminders::set_app_identifier(&app.config().identifier)?;
            #[cfg(target_os = "ios")]
            {
                ios_exports::configure(app.handle())?;
                ios::init();
            }
            reminders::enable();
            // A toast click cannot open an unpackaged app until the COM
            // activator is registered; this only restores basic wake-up.
            #[cfg(target_os = "windows")]
            toast_activation::enable(app.handle());
            app.manage(worker::Worker::start(
                app.path().app_local_data_dir()?.join("library"),
            )?);
            app.manage(std::sync::Arc::new(sync::commands::SyncRuntime::new(
                app.path().app_config_dir()?.join("sync"),
                app.path().app_local_data_dir()?.join("sync-staging"),
            )?));
            // Update discovery (D5) shares the app-identity preference folder
            // with the other machine-local files; never the library database.
            app.manage(std::sync::Arc::new(update_state::UpdateState::new(
                app.path().app_local_data_dir()?.join("library"),
            )));
            // Periodic automatic backups (D20): a plain thread that ends with
            // the process. Quitting never waits for or triggers a backup, and
            // an interrupted one is made up on a later launch.
            {
                let worker = app.state::<worker::Worker>().inner().clone();
                std::thread::Builder::new()
                    .name("thingary-auto-backup".into())
                    .spawn(move || loop {
                        std::thread::sleep(std::time::Duration::from_secs(30));
                        let policy = worker::Policy::production();
                        match worker.auto_backup_tick(&policy) {
                            Ok(
                                worker::TickOutcome::BackedUp(published)
                                | worker::TickOutcome::ExtraPending(published),
                            ) => {
                                worker.auto_backup_extra_now(&published);
                            }
                            Ok(_) => {}
                            Err(error) => eprintln!("自动备份未完成：{error}"),
                        }
                    })?;
            }
            #[cfg(windows)]
            app.manage(windows_exit::ExitState::default());
            app.manage(commands::EditGuard::default());
            app.manage(commands::LibraryGuard::default());
            app.manage(commands::FinancialImportJobs::default());
            #[cfg(desktop)]
            use tauri::menu::MenuItem;
            #[cfg(target_os = "macos")]
            use tauri::menu::{Menu, PredefinedMenuItem as Item, Submenu};
            // ⌘N/⌘F are dispatched by the current page; the page renames them (U12).
            #[cfg(target_os = "macos")]
            let new_item =
                MenuItem::with_id(app, "new-asset", "新增物品", true, Some("CmdOrCtrl+N"))?;
            #[cfg(target_os = "macos")]
            let find_item =
                MenuItem::with_id(app, "find-asset", "搜索物品", true, Some("CmdOrCtrl+F"))?;
            #[cfg(desktop)]
            #[cfg(not(target_os = "macos"))]
            let new_item = MenuItem::with_id(app, "new-asset", "新增物品", true, None::<&str>)?;
            #[cfg(desktop)]
            #[cfg(not(target_os = "macos"))]
            let find_item = MenuItem::with_id(app, "find-asset", "搜索物品", true, None::<&str>)?;
            #[cfg(desktop)]
            app.manage(commands::PageMenu {
                new: new_item.clone(),
                find: find_item.clone(),
            });
            #[cfg(target_os = "macos")]
            {
                let quit =
                    MenuItem::with_id(app, "quit-thingary", "退出物谱", true, Some("CmdOrCtrl+Q"))?;
                let app_menu = Submenu::with_items(
                    app,
                    "物谱",
                    true,
                    &[
                        &MenuItem::with_id(app, "open-about", "关于物谱", true, None::<&str>)?,
                        &MenuItem::with_id(app, "open-updates", "检查更新…", true, None::<&str>)?,
                        &Item::separator(app)?,
                        &MenuItem::with_id(
                            app,
                            "open-settings",
                            "设置…",
                            true,
                            Some("CmdOrCtrl+,"),
                        )?,
                        &Item::separator(app)?,
                        &Item::hide(app, Some("隐藏物谱"))?,
                        &Item::hide_others(app, Some("隐藏其他"))?,
                        &Item::show_all(app, Some("显示全部"))?,
                        &Item::separator(app)?,
                        &quit,
                    ],
                )?;
                let global_search_item = MenuItem::with_id(
                    app,
                    "global-search",
                    "搜索全部资料",
                    true,
                    Some("CmdOrCtrl+Shift+F"),
                )?;
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
                        &global_search_item,
                        &MenuItem::with_id(
                            app,
                            "edit-asset",
                            "编辑资料",
                            true,
                            Some("CmdOrCtrl+E"),
                        )?,
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
                let help_menu = Submenu::with_items(
                    app,
                    "帮助",
                    true,
                    &[
                        &MenuItem::with_id(app, "open-help", "物谱帮助", true, None::<&str>)?,
                        &Item::separator(app)?,
                        &MenuItem::with_id(app, "open-backup", "备份与恢复…", true, None::<&str>)?,
                    ],
                )?;
                app.set_menu(Menu::with_items(
                    app,
                    &[
                        &app_menu,
                        &file_menu,
                        &edit_menu,
                        &view_menu,
                        &window_menu,
                        &help_menu,
                    ],
                )?)?;
            }
            #[cfg(mobile)]
            app.manage(commands::PageMenu {});
            // Android starts the page as soon as its window exists, which can be before
            // Worker::start finishes the first-run sample library; commands arriving then
            // fail with "state not managed". The window is configured with create:false and
            // built here, once everything above is managed.
            #[cfg(target_os = "android")]
            for window in app.config().app.windows.iter().filter(|w| !w.create) {
                tauri::WebviewWindowBuilder::from_config(app.handle(), window)?.build()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::platform_capabilities,
            commands::ios_privacy_cover_set,
            commands::ios_share_file,
            commands::ios_share_text,
            commands::ios_export_pdf,
            planning_engine_commands::planning_engine_evaluate,
            privacy_lock::privacy_auth_available,
            privacy_lock::privacy_authenticate,
            commands::notification_permission,
            commands::modules_get,
            commands::modules_set,
            commands::wealth_accounts,
            commands::wealth_account_save,
            commands::account_groups_list,
            commands::account_group_save,
            commands::account_group_delete,
            commands::account_groups_reorder,
            commands::wealth_snapshot,
            commands::wealth_snapshot_draft,
            commands::wealth_snapshot_save,
            commands::wealth_quick_update,
            commands::wealth_request_result,
            savings_goal_commands::savings_goals_read,
            savings_goal_commands::savings_goals_save,
            savings_goal_commands::savings_goals_trash,
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
            commands::link_create,
            commands::link_delete_preview,
            commands::link_merge,
            commands::link_merge_view,
            commands::link_reconcile,
            commands::link_repair_preview,
            commands::link_restore,
            commands::link_purge_preview,
            commands::purge_all_preview,
            commands::link_restore_preview,
            commands::link_save,
            commands::link_trash,
            commands::link_view,
            commands::plan_income_list,
            commands::plan_income_defaults,
            commands::plan_income_save,
            investment_review_commands::investment_review_read,
            investment_review_commands::investment_review_list,
            investment_review_commands::investment_review_save,
            investment_review_commands::investment_review_trash,
            commands::plan_profile,
            commands::plan_profile_save,
            commands::plan_profile_update,
            planning_followup_commands::plan_assumptions_read,
            planning_followup_commands::plan_assumptions_save,
            planning_followup_commands::movement_accounts,
            planning_followup_commands::movement_list,
            planning_followup_commands::movement_sources,
            planning_followup_commands::movement_save,
            planning_followup_commands::movement_trash,
            planning_followup_commands::followup_review_read,
            planning_followup_commands::followup_review_preview,
            planning_followup_commands::followup_review_list,
            planning_followup_commands::followup_review_save,
            planning_followup_commands::followup_review_trash,
            planning_followup_commands::followup_receipt,
            commands::planning_sources,
            commands::finance_sources,
            commands::plan_review,
            commands::plan_interval_reasons,
            commands::plan_baseline_mark,
            commands::recurring_overview,
            commands::recurring_detail,
            commands::recurring_resume,
            commands::recurring_cancel_resumption,
            commands::recurring_plan_save,
            commands::recurring_payment_save,
            commands::recurring_payment_range_save,
            commands::virtual_overview,
            commands::virtual_save,
            commands::virtual_topup_save,
            commands::virtual_balance_save,
            commands::virtual_reminder_save,
            commands::open_notification_settings,
            commands::notification_status,
            commands::checkin_reminder_status,
            commands::app_version,
            commands::support_open,
            commands::update_state_get,
            commands::update_consent_set,
            commands::update_check_request,
            commands::update_mark_seen,
            commands::update_ignore_version,
            commands::update_open_release,
            commands::update_open_download,
            commands::goal_progress_list,
            commands::goal_progress_record,
            commands::checkin_reminder_set,
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
            commands::set_price_origin,
            commands::set_amount_origin,
            commands::get_amount_origin,
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
            commands::link_wish_asset,
            commands::verify_legacy_wish,
            commands::list_timeline,
            commands::timeline_view,
            commands::validate_source,
            commands::search_all,
            commands::overview,
            commands::review_overview,
            commands::stats_snapshot,
            commands::purchase_trend,
            commands::holding,
            commands::resale_rate,
            commands::backup_task_begin,
            commands::backup_task_cancel,
            commands::create_backup,
            commands::inspect_backup,
            commands::unlock_backup_session,
            commands::cancel_backup_session,
            commands::restore_backup_session,
            commands::backup_session_result,
            commands::backup_security_status,
            commands::backup_security_choose_plaintext,
            commands::backup_security_begin_setup,
            commands::backup_security_cancel_setup,
            commands::backup_security_export_key,
            commands::backup_security_confirm_setup,
            commands::backup_security_disable,
            commands::backup_security_enable_from_key,
            commands::auto_backup_status,
            commands::auto_backup_set_enabled,
            commands::auto_backup_choose_extra,
            commands::auto_backup_clear_extra,
            commands::auto_backup_open_folder,
            commands::inspect_auto_backup,
            commands::export_workbook,
            commands::save_spreadsheet_template,
            commands::inspect_item_workbook,
            commands::financial_import_read_workbook,
            commands::financial_import_template,
            commands::financial_import_preview,
            commands::financial_import_commit,
            commands::financial_import_receipt,
            commands::financial_import_cancel,
            commands::financial_import_progress,
            commands::commit_item_workbook,
            commands::item_import_receipt,
            commands::saved_request,
            commands::set_editing,
            commands::set_library_busy,
            commands::finish_close,
            commands::windows_exit_reminders_choice,
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
            commands::material_preview,
            sync::commands::sync_config_get,
            sync::commands::sync_config_set,
            sync::commands::sync_test_connection,
            sync::commands::sync_disable,
            sync::commands::sync_status,
            sync::commands::sync_unlock,
            sync::commands::sync_push,
            sync::commands::sync_pull_inspect,
            sync::commands::sync_resolve_conflict
        ]);
    #[cfg(desktop)]
    let builder = builder
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
                    | "global-search"
                    | "edit-asset"
                    | "open-settings"
                    | "open-about"
                    | "open-help"
                    | "open-backup"
                    | "open-updates"
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
            if action == "quit-thingary" {
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
                window_size::save(window.app_handle());
                api.prevent_close();
                #[cfg(target_os = "windows")]
                {
                    let editing = window
                        .state::<commands::EditGuard>()
                        .0
                        .load(Ordering::SeqCst);
                    let busy = window
                        .state::<commands::LibraryGuard>()
                        .1
                        .load(Ordering::SeqCst);
                    if let Some(event) = windows_close_event(editing, busy) {
                        let _ = window.emit(event, true);
                    } else {
                        window.app_handle().exit(0);
                    }
                }
                #[cfg(target_os = "macos")]
                if window
                    .state::<commands::EditGuard>()
                    .0
                    .load(Ordering::SeqCst)
                {
                    let _ = window.emit("close-intent", cfg!(target_os = "windows"));
                } else {
                    let _ = window.hide();
                }
            }
        });
    builder
        .build(tauri::generate_context!())
        .expect("Cannot start Thingary preview")
        .run(|app, event| {
            #[cfg(mobile)]
            let _ = (app, event);
            #[cfg(desktop)]
            if let tauri::RunEvent::ExitRequested { ref api, .. } = event {
                #[cfg(desktop)]
                window_size::save(app);
                #[cfg(target_os = "windows")]
                if let Some(event) = windows_close_event(
                    app.state::<commands::EditGuard>().0.load(Ordering::SeqCst),
                    app.state::<commands::LibraryGuard>()
                        .1
                        .load(Ordering::SeqCst),
                ) {
                    api.prevent_exit();
                    windows_exit::cancel(app);
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.emit(event, true);
                    }
                } else if !windows_exit::take_permit(app) {
                    api.prevent_exit();
                    windows_exit::begin(app);
                }
                #[cfg(target_os = "macos")]
                if app.state::<commands::EditGuard>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.emit("close-intent", true);
                    }
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

#[cfg(test)]
#[path = "../tests/helpers/planning_migration.rs"]
mod planning_migration_tests;

#[cfg(test)]
mod windows_close_tests {
    use super::windows_close_event;

    #[test]
    fn page_owned_editing_and_tasks_block_exit_without_discard() {
        assert_eq!(windows_close_event(false, true), Some("close-blocked"));
        assert_eq!(windows_close_event(true, true), Some("close-blocked"));
        assert_eq!(windows_close_event(false, false), None);
    }

    #[test]
    fn app_owned_editor_keeps_confirmation_and_can_exit_after_confirming() {
        assert_eq!(windows_close_event(true, false), Some("close-intent"));
        assert_eq!(windows_close_event(false, false), None);
    }
}
