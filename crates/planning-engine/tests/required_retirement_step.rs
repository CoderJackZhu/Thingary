use serde_json::{json, Value};
use thingary_planning_engine::{dispatch, evaluate_bytes};

const FIELDS: [&str; 5] = ["balance", "growth", "lump", "income", "spend"];

fn full_request() -> Value {
    json!({
        "op": "retirement_step",
        "balance": 40,
        "growth": 1.5,
        "lump": 10,
        "income": 6,
        "spend": 20
    })
}

fn byte_response(request: &Value) -> Value {
    let input = serde_json::to_vec(request).unwrap();
    serde_json::from_slice(&evaluate_bytes(&input)).unwrap()
}

fn assert_byte_error(request: &Value) -> String {
    let response = byte_response(request);
    assert_eq!(response["ok"], false, "request: {request}");
    assert!(response.get("value").is_none());
    let error = response["error"].as_str().unwrap();
    assert!(!error.is_empty());
    error.to_owned()
}

#[test]
fn native_rejects_each_omitted_required_field() {
    for field in FIELDS {
        let mut request = full_request();
        request.as_object_mut().unwrap().remove(field);
        let error = dispatch(request).expect_err(field);
        assert!(error.contains(field), "{field}: {error}");
    }
    assert!(dispatch(json!({"op": "retirement_step"})).is_err());
}

#[test]
fn bytes_reject_each_omitted_required_field() {
    for field in FIELDS {
        let mut request = full_request();
        request.as_object_mut().unwrap().remove(field);
        let error = assert_byte_error(&request);
        assert!(error.contains(field), "{field}: {error}");
    }
    assert_byte_error(&json!({"op": "retirement_step"}));
}

// Expectations follow cash arithmetic: (40 + 10) * 1.5 + 6 - 20 = 61.
// Each zero below changes exactly one term of that full-input example.
fn zero_cases() -> Vec<(Value, Value)> {
    let mut cases = Vec::new();
    for (field, a, withdrawal, gap) in [
        ("balance", 1., 14., 0.),
        ("growth", 0., 0., 14.),
        ("lump", 46., 14., 0.),
        ("income", 55., 20., 0.),
        ("spend", 81., 0., 0.),
    ] {
        let mut request = full_request();
        request[field] = json!(0);
        cases.push((
            request,
            json!({"a": a, "withdrawal": withdrawal, "gap": gap}),
        ));
    }
    cases.push((
        json!({"op": "retirement_step", "balance": 0, "growth": 0, "lump": 0, "income": 0, "spend": 0}),
        json!({"a": 0., "withdrawal": 0., "gap": 0.}),
    ));
    cases.push((
        json!({"op": "retirement_step", "balance": 100, "growth": 1, "lump": 0, "income": 0, "spend": 0}),
        json!({"a": 100., "withdrawal": 0., "gap": 0.}),
    ));
    cases.push((
        json!({"op": "retirement_step", "balance": 100, "growth": 0, "lump": 10, "income": 20, "spend": 7}),
        json!({"a": 13., "withdrawal": 0., "gap": 0.}),
    ));
    cases
}

#[test]
fn native_accepts_each_explicit_zero_with_existing_arithmetic() {
    for (request, expected) in zero_cases() {
        assert_eq!(dispatch(request.clone()).unwrap(), expected, "{request}");
    }
}

#[test]
fn bytes_accept_each_explicit_zero_with_existing_arithmetic() {
    for (request, expected) in zero_cases() {
        assert_eq!(
            byte_response(&request),
            json!({"ok": true, "value": expected}),
            "{request}"
        );
    }
}

#[test]
fn native_rejects_null_text_and_other_nonnumbers_for_each_field() {
    for field in FIELDS {
        for invalid in [
            Value::Null,
            json!("0"),
            json!("1"),
            json!(true),
            json!([]),
            json!({}),
        ] {
            let mut request = full_request();
            request[field] = invalid;
            assert!(dispatch(request.clone()).is_err(), "{field}: {request}");
        }
    }
}

#[test]
fn bytes_reject_null_text_and_other_nonnumbers_for_each_field() {
    for field in FIELDS {
        for invalid in [
            Value::Null,
            json!("0"),
            json!("1"),
            json!(true),
            json!([]),
            json!({}),
        ] {
            let mut request = full_request();
            request[field] = invalid;
            assert_byte_error(&request);
        }
    }
}

#[test]
fn native_rejects_negative_growth_and_growth_overflow() {
    for growth in [-0.0001, -1., -1e300, 1e300] {
        let mut request = full_request();
        request["growth"] = json!(growth);
        assert!(dispatch(request).is_err(), "growth: {growth}");
    }
}

#[test]
fn bytes_reject_negative_growth_and_growth_overflow() {
    for growth in [-0.0001, -1., -1e300, 1e300] {
        let mut request = full_request();
        request["growth"] = json!(growth);
        assert_byte_error(&request);
    }
}

#[test]
fn bytes_reject_nonfinite_json_numbers_for_each_field() {
    // Nonfinite numbers cannot inhabit serde_json::Value; test raw byte parsing.
    for field in FIELDS {
        for token in ["1e400", "-1e400", "NaN", "Infinity", "-Infinity"] {
            let mut request = full_request();
            request[field] = json!("NONFINITE_NUMBER");
            let input = serde_json::to_string(&request)
                .unwrap()
                .replace("\"NONFINITE_NUMBER\"", token);
            let response: Value =
                serde_json::from_slice(&evaluate_bytes(input.as_bytes())).unwrap();
            assert_eq!(response["ok"], false, "{field}: {token}");
            assert!(response["error"]
                .as_str()
                .is_some_and(|error| !error.is_empty()));
            assert!(response.get("value").is_none());
        }
    }
}

fn invalid_amount_cases() -> Vec<Value> {
    let mut cases = Vec::new();
    for field in ["balance", "lump", "income", "spend"] {
        for amount in [-9_000_000_000_000_001., 9_000_000_000_000_001.] {
            let mut request = full_request();
            request[field] = json!(amount);
            cases.push(request);
        }
    }
    for field in ["lump", "income", "spend"] {
        let mut request = full_request();
        request[field] = json!(-1);
        cases.push(request);
    }
    cases
}

#[test]
fn native_preserves_amount_bounds() {
    for request in invalid_amount_cases() {
        assert!(dispatch(request.clone()).is_err(), "{request}");
    }
}

#[test]
fn bytes_preserve_amount_bounds() {
    for request in invalid_amount_cases() {
        assert_byte_error(&request);
    }
}

fn arithmetic_cases() -> Vec<(Value, Value)> {
    vec![
        (
            full_request(),
            json!({"a": 61., "withdrawal": 14., "gap": 0.}),
        ),
        (
            json!({"op": "retirement_step", "balance": -12, "growth": 2, "lump": 0, "income": 20, "spend": 5}),
            json!({"a": 3., "withdrawal": 0., "gap": 0.}),
        ),
        (
            json!({"op": "retirement_step", "balance": 40, "growth": 1, "lump": 0, "income": 5, "spend": 55}),
            json!({"a": 0., "withdrawal": 40., "gap": 10.}),
        ),
        (
            json!({"op": "retirement_step", "balance": 1.25, "growth": 2, "lump": 0.5, "income": 0.25, "spend": 1}),
            json!({"a": 2.75, "withdrawal": 0.75, "gap": 0.}),
        ),
        (
            json!({"op": "retirement_step", "balance": 0, "growth": 1e300, "lump": 0, "income": 0, "spend": 0}),
            json!({"a": 0., "withdrawal": 0., "gap": 0.}),
        ),
        (
            json!({"op": "retirement_step", "balance": 9_000_000_000_000_000_f64, "growth": 1, "lump": 0, "income": 0, "spend": 0}),
            json!({"a": 9_000_000_000_000_000_f64, "withdrawal": 0., "gap": 0.}),
        ),
    ]
}

#[test]
fn native_preserves_full_input_arithmetic() {
    for (request, expected) in arithmetic_cases() {
        assert_eq!(dispatch(request.clone()).unwrap(), expected, "{request}");
    }
}

#[test]
fn bytes_preserve_full_input_arithmetic() {
    for (request, expected) in arithmetic_cases() {
        assert_eq!(
            byte_response(&request),
            json!({"ok": true, "value": expected}),
            "{request}"
        );
    }
}
