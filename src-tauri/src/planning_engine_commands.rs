//! Pure calculation IPC; no store, filesystem, or financial record writes.
#[tauri::command]
pub async fn planning_engine_evaluate(
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if serde_json::to_vec(&request)
        .map_err(|e| e.to_string())?
        .len()
        > 64 * 1024 * 1024
    {
        return Err("测算输入过大".into());
    }
    tauri::async_runtime::spawn_blocking(move || thingary_planning_engine::dispatch(request))
        .await
        .map_err(|e| format!("计算任务未完成：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::planning_engine_evaluate;
    use serde_json::json;

    #[test]
    fn native_calculation_command_uses_the_shared_dispatch_without_store() {
        let request = json!({"op":"retirement_step", "balance":100, "growth":1,
            "lump":0, "spend":40, "income":10});
        let expected = thingary_planning_engine::dispatch(request.clone()).unwrap();
        let actual = tauri::async_runtime::block_on(planning_engine_evaluate(request)).unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn native_calculation_errors_are_returned() {
        let result = tauri::async_runtime::block_on(planning_engine_evaluate(json!({
            "op":"retirement_step", "balance":0, "growth":-1,
            "lump":0, "spend":0, "income":0
        })));
        assert!(result.is_err());
    }
}
