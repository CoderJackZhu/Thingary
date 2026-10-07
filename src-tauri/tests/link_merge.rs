//! 旧订阅合并发现（步骤二）：只列名称规范化后唯一对应的候选，用户确认才挂接，
//! 不按名称自动合并、不删除记录，合并前的单次价格保留在档案备注。全部虚构资料。

use thingary_lib::{
    link::LinkView,
    link_merge::{MergePick, MergeSave},
    recurring::{PlanFields, PlanSave},
    storage::Store,
};
const T: &str = "2026-10-08";

fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn plan(s: &mut Store, name: &str) -> (String, i64) {
    let p = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: PlanFields {
                    auto_renew: true,
                    service_start: Some("2026-08-01".into()),
                    coverage_start: Some("2026-08-01".into()),
                    interval_days: None,
                    trial_days: None,
                    name: name.into(),
                    category: "subscription".into(),
                    amount_cents: "5000".into(),
                    interval_months: 1,
                    first_due: "2026-09-01".into(),
                    end_date: None,
                    paused: false,
                    notes: String::new(),
                },
            },
            T,
        )
        .unwrap();
    (p.id, p.revision)
}

/// 升级前的旧版订阅档案：kind=subscription、没有计划，原金额是单次价格。
fn legacy(s: &Store, name: &str, price: Option<i64>) -> String {
    let asset = id();
    s.conn_for_test()
        .unwrap()
        .execute(
            "INSERT INTO virtual_assets(id,name,kind,billing,label_id,pay_method,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,perpetual,revision,created_at,updated_at) VALUES(?1,?2,'subscription','single',NULL,'','虚构提供方',NULL,?3,NULL,NULL,'','旧备注',NULL,0,1,'2026-01-01','2026-01-01')",
            rusqlite::params![asset, name, price],
        )
        .unwrap();
    asset
}

fn pick(p: &thingary_lib::link_merge::MergePair) -> MergePick {
    MergePick {
        asset_id: p.asset_id.clone(),
        asset_expected_revision: p.asset_revision,
        plan_id: p.plan_id.clone(),
        plan_expected_revision: p.plan_revision,
    }
}

#[test]
fn only_unique_normalized_name_matches_are_offered() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (cloud, _) = plan(&mut s, "虚构云盘");
    plan(&mut s, "只有计划");
    plan(&mut s, "重名服务");
    legacy(&s, "  虚构云盘 ", Some(60000));
    legacy(&s, "只有档案", None);
    legacy(&s, "重名服务", None);
    legacy(&s, "重名服务", None);
    let view = s.link_merge_view().unwrap();
    assert_eq!(view.pairs.len(), 1, "{:?}", view.pairs);
    assert_eq!(view.pairs[0].plan_id, cloud);
    assert_eq!(view.pairs[0].asset_price_cents.as_deref(), Some("60000"));
}

#[test]
fn merge_links_without_deleting_and_keeps_the_old_price_in_notes() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (plan_id, _) = plan(&mut s, "虚构云盘");
    let asset = legacy(&s, "虚构云盘", Some(60000));
    let pair = s.link_merge_view().unwrap().pairs.remove(0);
    let mut stale = pick(&pair);
    stale.asset_expected_revision += 1;
    let request = MergeSave {
        request_id: id(),
        generation: s.generation(),
        pairs: vec![pick(&pair)],
    };
    let err = s
        .link_merge(
            &MergeSave {
                request_id: id(),
                generation: s.generation(),
                pairs: vec![stale],
            },
            T,
        )
        .unwrap_err();
    assert_eq!(err.code, "REVISION_CONFLICT");
    assert_eq!(
        s.link_merge_view().unwrap().pairs.len(),
        1,
        "failed merge writes nothing"
    );

    assert_eq!(s.link_merge(&request, T).unwrap(), "1");
    // 同一请求重放得到同一结果，不再次修改。
    assert_eq!(s.link_merge(&request, T).unwrap(), "1");
    let view: LinkView = s.link_view("plan", &plan_id).unwrap();
    assert_eq!(view.relation, "linked");
    assert_eq!(view.asset.as_ref().unwrap().id, asset);
    assert!(s.link_merge_view().unwrap().pairs.is_empty());
    let (notes, price, revision): (String, Option<i64>, i64) = s
        .conn_for_test()
        .unwrap()
        .query_row(
            "SELECT notes,price_cents,revision FROM virtual_assets WHERE id=?1",
            [&asset],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert!(
        notes.starts_with("旧备注\n") && notes.contains("单次价格 ¥600.00"),
        "{notes}"
    );
    assert_eq!(price, None);
    assert_eq!(revision, 2);
}
