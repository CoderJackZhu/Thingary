use crate::{
    domain::{Error, Result},
    savings_goals::{Goal, Read, Save, Trash},
    worker::Worker,
};

#[tauri::command]
pub async fn savings_goals_read(
    generation: String,
    year: Option<i32>,
    worker: tauri::State<'_, Worker>,
) -> Result<Read> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call_with_runtime_modules(move |s, m| {
            s.savings_goals_read(
                &generation,
                year,
                &chrono::Local::now().format("%Y-%m-%d").to_string(),
                &m,
            )
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "暂时无法读取存钱目标"))?
}
#[tauri::command]
pub async fn savings_goals_save(input: Save, worker: tauri::State<'_, Worker>) -> Result<Goal> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call_with_runtime_modules(move |s, m| {
            s.savings_goals_save(
                &input,
                &chrono::Local::now().format("%Y-%m-%d").to_string(),
                m.modules.wealth,
            )
        })
    })
    .await
    .map_err(|_| Error::new("WORKER", "保存结果未返回，请核对原请求"))?
}
#[tauri::command]
pub async fn savings_goals_trash(input: Trash, worker: tauri::State<'_, Worker>) -> Result<()> {
    let w = worker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.call_with_runtime_modules(move |s, m| s.savings_goals_trash(&input, m.modules.wealth))
    })
    .await
    .map_err(|_| Error::new("WORKER", "删除或恢复结果未返回，请核对原请求"))?
}
