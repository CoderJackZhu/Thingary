use crate::{
    domain::{Error, Result},
    worker::Worker,
};
#[tauri::command]
pub async fn plan_assumptions_read(
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::plan_assumptions::Read> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.plan_assumptions_read(&generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "假设读取失败"))?
}
#[tauri::command]
pub async fn plan_assumptions_save(
    input: crate::plan_assumptions::Save,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::plan_profile::Saved> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.plan_assumptions_save(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "保存结果未知，请核对原请求"))?
}

#[tauri::command]
pub async fn movement_accounts(
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<serde_json::Value> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.movement_accounts(&generation)))
        .await
        .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn movement_list(
    query: crate::cash_movement::Query,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<serde_json::Value> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.movement_list(&query, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn movement_sources(
    query: crate::cash_movement::SourceQuery,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<serde_json::Value> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.movement_sources(&query, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn movement_save(
    input: crate::cash_movement::Save,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::cash_movement::Saved> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| {
            s.movement_save(&input, &chrono::Local::now().format("%Y-%m-%d").to_string())
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn movement_trash(
    input: crate::cash_movement::Trash,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::cash_movement::Saved> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.movement_trash(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn followup_review_read(
    pair: crate::planning_flow_review::Pair,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<serde_json::Value> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.followup_review_read(&pair, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn followup_review_preview(
    pair: crate::planning_flow_review::Pair,
    draft: crate::planning_flow_review::Draft,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<serde_json::Value> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.followup_review_preview(&pair, &draft, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn followup_review_list(
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<serde_json::Value> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.followup_review_list(&generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn followup_review_save(
    input: crate::planning_flow_review::Save,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::cash_movement::Saved> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.followup_review_save(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn followup_review_trash(
    input: crate::cash_movement::Trash,
    worker: tauri::State<'_, Worker>,
) -> Result<crate::cash_movement::Saved> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.followup_review_trash(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}

#[tauri::command]
pub async fn followup_receipt(
    request: String,
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<Option<crate::cash_movement::Saved>> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.followup_receipt(&request, &generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "资金流动请求未返回，请核对原请求"))?
}
