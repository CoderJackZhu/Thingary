// Foreign-currency item prices: the original price is kept beside the converted CNY price and never outlives it.
use thingary_lib::{
    catalog::{Details, PriceOrigin, PriceOriginSave, SaveAsset},
    domain::Save,
    storage::Store,
};

const TODAY: &str = "2026-09-10";
fn save(
    s: &mut Store,
    id: Option<(String, i64)>,
    price: &str,
) -> thingary_lib::catalog::AssetRecord {
    s.save_asset(
        &SaveAsset {
            options: None,
            base: Save {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                asset_id: id.as_ref().map(|i| i.0.clone()),
                expected_revision: id.map(|i| i.1),
                name: "虚构相机".into(),
                price_cents: Some(price.into()),
                purchase_date: Some("2026-01-01".into()),
            },
            details: Details::default(),
            photos: None,
            classification: None,
        },
        TODAY,
    )
    .unwrap()
}
fn origin(code: &str, minor: &str, rate: &str) -> PriceOrigin {
    PriceOrigin {
        currency: code.into(),
        original_minor: minor.into(),
        fx_rate_micro: rate.into(),
    }
}

#[test]
fn origin_must_convert_to_the_saved_price_and_is_hidden_once_the_price_moves() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    // 1,299.00 USD at 7.1234 CNY = 9,253.30 CNY (rounded half up).
    let a = save(&mut s, None, "925330");
    let set = |s: &mut Store, o: Option<PriceOrigin>| {
        s.set_price_origin(&PriceOriginSave {
            generation: s.generation(),
            asset_id: a.asset.id.clone(),
            origin: o,
        })
    };
    assert!(set(&mut s, Some(origin("USD", "129900", "7123400"))).is_ok());
    assert_eq!(
        s.record(&a.asset.id).unwrap().unwrap().price_origin,
        Some(origin("USD", "129900", "7123400"))
    );
    // A wrong rate, CNY itself and a bad code are refused.
    assert!(set(&mut s, Some(origin("USD", "129900", "7000000"))).is_err());
    assert!(set(&mut s, Some(origin("CNY", "129900", "1000000"))).is_err());
    assert!(set(&mut s, Some(origin("usd", "129900", "7123400"))).is_err());
    // Changing the CNY price elsewhere hides the now-unexplained original.
    let b = save(
        &mut s,
        Some((a.asset.id.clone(), a.asset.revision)),
        "900000",
    );
    assert_eq!(s.record(&a.asset.id).unwrap().unwrap().price_origin, None);
    assert_eq!(b.price_origin, None);
    // Clearing removes it.
    assert!(set(&mut s, None).is_ok());
}

#[test]
fn zero_decimal_currency_uses_whole_units() {
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    // 150,000 JPY at 0.0471 CNY = 7,065.00 CNY.
    let a = save(&mut s, None, "706500");
    let r = s.set_price_origin(&PriceOriginSave {
        generation: s.generation(),
        asset_id: a.asset.id.clone(),
        origin: Some(origin("JPY", "150000", "47100")),
    });
    assert!(r.is_ok(), "{r:?}");
}

#[test]
fn expense_amount_origin_must_explain_the_amount() {
    use thingary_lib::catalog::{AmountKind, AmountOriginSave};
    let root = tempfile::tempdir().unwrap();
    let mut s = Store::open(root.path()).unwrap();
    let missing = s.set_amount_origin(&AmountOriginSave {
        generation: s.generation(),
        kind: AmountKind::Expense,
        record_id: "none".into(),
        origin: Some(origin("USD", "100", "7000000")),
    });
    assert!(missing.is_err());
    assert_eq!(s.amount_origin(AmountKind::Expense, "none").unwrap(), None);
}
