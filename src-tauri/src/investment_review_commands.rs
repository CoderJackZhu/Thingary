use crate::{
    domain::{Error, Result},
    investment_review::{List, Save, Trash, View},
    worker::Worker,
};
#[tauri::command]
pub async fn investment_review_read(
    generation: String,
    from_snapshot_id: String,
    to_snapshot_id: String,
    worker: tauri::State<'_, Worker>,
) -> Result<View> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.investment_review_read(&generation, &from_snapshot_id, &to_snapshot_id))
    })
    .await
    .map_err(|_| Error::new("WORKER", "暂时无法读取投资复盘"))?
}
#[tauri::command]
pub async fn investment_review_list(
    generation: String,
    worker: tauri::State<'_, Worker>,
) -> Result<List> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call(move |s| s.investment_review_list(&generation))
    })
    .await
    .map_err(|_| Error::new("WORKER", "暂时无法读取核对记录"))?
}
#[tauri::command]
pub async fn investment_review_save(
    input: Save,
    worker: tauri::State<'_, Worker>,
) -> Result<serde_json::Value> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.investment_review_save(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "保存结果未返回，请核对本次请求"))?
}
#[tauri::command]
pub async fn investment_review_trash(input: Trash, worker: tauri::State<'_, Worker>) -> Result<()> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || w.call(move |s| s.investment_review_trash(&input)))
        .await
        .map_err(|_| Error::new("WORKER", "删除或恢复结果未返回，请核对本次请求"))?
}
