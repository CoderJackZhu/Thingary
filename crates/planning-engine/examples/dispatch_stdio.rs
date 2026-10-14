//! Integration transport for native/WASM parity; no calculation logic here.
use std::io::{self, BufRead};
fn main() {
    for line in io::stdin().lock().lines() {
        let line = line.expect("read request");
        let result = thingary_planning_engine::evaluate_bytes(line.as_bytes());
        println!("{}", String::from_utf8(result).expect("JSON is UTF-8"));
    }
}
