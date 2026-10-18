use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
struct State {
    inputs: HashMap<usize, Box<[u8]>>,
    output: Vec<u8>,
}
static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| {
    Mutex::new(State {
        inputs: HashMap::new(),
        output: Vec::new(),
    })
});
const MAX_INPUT: u32 = crate::MAX_INPUT_BYTES as u32;
/// Caller owns input until release; invalid length returns zero.
#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn alloc(len: u32) -> usize {
    if len == 0 || len > MAX_INPUT {
        return 0;
    }
    let Ok(mut s) = STATE.lock() else { return 0 };
    let mut b = vec![0; len as usize].into_boxed_slice();
    // usize is an i32 address on wasm32 and preserves native test-host pointers.
    let ptr = b.as_mut_ptr() as usize;
    s.inputs.insert(ptr, b);
    ptr
}
/// Only exact registered allocations are released. Output is engine-owned.
#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn release(ptr: usize, len: u32) {
    if let Ok(mut s) = STATE.lock() {
        if s.inputs.get(&ptr).is_some_and(|b| b.len() == len as usize) {
            s.inputs.remove(&ptr);
        }
    }
}
/// Output is UTF-8 JSON, owned by engine and valid until next evaluation.
#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn evaluate(ptr: usize, len: u32) -> usize {
    let Ok(mut s) = STATE.lock() else { return 0 };
    let bytes = if len > MAX_INPUT {
        b"{\"ok\":false,\"error\":\"input exceeds 64 MiB transport limit\"}".to_vec()
    } else if let Some(b) = s.inputs.get(&ptr).filter(|b| len as usize <= b.len()) {
        crate::evaluate_bytes(&b[..len as usize])
    } else {
        b"{\"ok\":false,\"error\":\"invalid input allocation\"}".to_vec()
    };
    s.output = bytes;
    s.output.as_ptr() as usize
}
#[cfg_attr(target_arch = "wasm32", no_mangle)]
pub extern "C" fn result_len() -> u32 {
    STATE.lock().map(|s| s.output.len() as u32).unwrap_or(0)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn abi_allocation_ownership_and_rejected_pointers() {
        assert_eq!(alloc(0), 0);
        assert_eq!(alloc(MAX_INPUT + 1), 0);
        let data =
            br#"{"op":"retirement_step","balance":100,"growth":1,"lump":0,"spend":30,"income":10}"#;
        // Exactly 64 MiB is accepted; whitespace keeps the boundary test practical.
        let boundary = alloc(MAX_INPUT);
        assert_ne!(boundary, 0);
        {
            let mut state = STATE.lock().unwrap();
            let input = state.inputs.get_mut(&boundary).unwrap();
            // The ABI must preserve the whole address, including on native test hosts.
            assert_eq!(boundary, input.as_ptr() as usize);
            input.fill(b' ');
            input[..data.len()].copy_from_slice(data);
        }
        evaluate(boundary, MAX_INPUT);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&STATE.lock().unwrap().output).unwrap()
                ["ok"],
            true
        );
        evaluate(boundary, MAX_INPUT + 1);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&STATE.lock().unwrap().output).unwrap()
                ["ok"],
            false
        );
        release(boundary, MAX_INPUT);
        let ptr = alloc(data.len() as u32);
        STATE
            .lock()
            .unwrap()
            .inputs
            .get_mut(&ptr)
            .unwrap()
            .copy_from_slice(data);
        evaluate(ptr, data.len() as u32);
        let bytes = STATE.lock().unwrap().output.clone();
        assert_eq!(result_len(), bytes.len() as u32);
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["value"]["a"], 80.);
        release(ptr, data.len() as u32 + 1);
        assert!(STATE.lock().unwrap().inputs.contains_key(&ptr));
        release(ptr, data.len() as u32);
        assert!(!STATE.lock().unwrap().inputs.contains_key(&ptr));
        // Releasing input keeps output alive until another evaluation.
        assert_eq!(STATE.lock().unwrap().output, bytes);
        evaluate(ptr, data.len() as u32);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&STATE.lock().unwrap().output).unwrap()
                ["ok"],
            false
        );
    }
}
