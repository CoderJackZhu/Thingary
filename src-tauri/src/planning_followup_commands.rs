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
