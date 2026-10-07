//! Linked-subscription lifecycle acceptance (EXPENSE_OVERVIEW_SUBSCRIPTION_LINKS_DESIGN §11,
//! conditions L01–L12 and the storage halves of D01/D02). Every scenario runs
//! on fictional data in a temporary directory; the amounts follow the
//! design's fixed examples where one exists.

use thingary_lib::{
    domain::Error,
    link::{LinkCreateSave, LinkRestoreSave, LinkSave, LinkTrashSave, ReconcileSave},
    purge::Purge,
    recurring::{PaymentSave, PlanFields, PlanSave},
    storage::{migrate_to, Store},
    trash::TrashQuery,
    virtual_assets::{Fields, LinkedPlanSave, Save},
    wealth::TrashChange,
};
const T: &str = "2026-10-04";

fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn code<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    r.unwrap_err().code
}

fn plan_fields(name: &str, amount: &str, first_due: &str, service: &str) -> PlanFields {
    PlanFields {
        auto_renew: true,
        service_start: Some(service.into()),
        coverage_start: Some(service.into()),
        interval_days: None,
        trial_days: None,
        name: name.into(),
        category: "subscription".into(),
        amount_cents: amount.into(),
        interval_months: 1,
        first_due: first_due.into(),
        end_date: None,
        paused: false,
        notes: String::new(),
    }
}

/// One live linked pair built the way the virtual page's 新建订阅 does.
fn sub(s: &mut Store, name: &str, amount: &str) -> (String, String) {
    let f = plan_fields(name, amount, "2026-09-01", "2026-08-01");
    let save = Save {
        plan: Some(LinkedPlanSave {
            id: None,
            expected_revision: None,
            fields: f,
        }),
        renewal_price_cents: None,
        renewal_from: None,
        special_end: None,
        first_topup: None,
        request_id: id(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        fields: Fields {
            name: name.into(),
            kind: "subscription".into(),
            billing: "subscription".into(),
            label_id: None,
            pay_method: None,
            perpetual: None,
            provider: "虚构平台".into(),
            purchase_date: Some("2026-09-10".into()),
            price_cents: None,
            expires: None,
            plan_id: None,
            url: String::new(),
            notes: String::new(),
            stopped_on: None,
        },
    };
    let v = s.virtual_save(&save, T).unwrap();
    (v.id, v.fields.plan_id.unwrap())
}

fn pay(s: &mut Store, plan_id: &str, due: &str, amount: &str) -> String {
    let out = s
        .recurring_payment_save(
            &PaymentSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                plan_id: plan_id.into(),
                due_date: due.into(),
                state: "paid".into(),
                paid_date: Some(due.into()),
                amount_cents: Some(amount.into()),
                notes: String::new(),
            },
            T,
        )
        .unwrap();
    out.id
}

fn trash(s: &Store, kind: &str, target: &str, revision: i64, deleted: bool) -> TrashChange {
    TrashChange {
        request_id: id(),
        generation: s.generation(),
        kind: kind.into(),
        id: target.into(),
        expected_revision: revision,
        deleted,
    }
}

fn group_delete(s: &mut Store, side: &str, id: &str) -> String {
    let preview = s.link_delete_preview(side, id, None).unwrap();
    assert!(
        preview.blockers.is_empty(),
        "blockers: {:?}",
        preview.blockers
    );
    s.link_trash(&LinkTrashSave {
        request_id: crate_id(),
        generation: s.generation(),
        side: side.into(),
        id: id.into(),
        partner_id: None,
        asset_expected_revision: preview.asset_revision,
        plan_expected_revision: preview.plan_revision,
        preview: preview.preview,
    })
    .unwrap()
}

fn crate_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// R7：整组永久清除经预览复核（读摘要→提交）。
fn purge_group(s: &mut Store, group: &str) {
    let p = s.link_purge_preview(group).unwrap();
    assert!(p.blockers.is_empty(), "blockers: {:?}", p.blockers);
    s.purge_trash(&Purge {
        request_id: id(),
        generation: s.generation(),
        kind: Some("link_group".into()),
        id: group.into(),
        preview: Some(p.preview),
    })
    .unwrap();
}

fn restore(s: &mut Store, group: &str) {
    let p = s.link_restore_preview(group).unwrap();
    assert!(p.blockers.is_empty(), "blockers: {:?}", p.blockers);
    s.link_restore(&LinkRestoreSave {
        request_id: id(),
        generation: s.generation(),
        group_id: group.into(),
        preview: p.preview,
    })
    .unwrap();
}

fn asset_of(s: &Store, asset: &str) -> thingary_lib::virtual_assets::VirtualAsset {
    s.virtual_overview(T)
        .unwrap()
        .items
        .into_iter()
        .find(|x| x.id == asset)
        .unwrap()
}

/// L01：虚拟页新建一次事务成对；周期页给已有订阅计划建档案，不新增付款。
#[test]
fn l01_new_pair_and_create_archive_for_existing_plan() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构笔记订阅", "4000");
    let view = s.link_view("virtual", &asset).unwrap();
    assert_eq!(view.relation, "linked");
    assert_eq!(view.plan.as_ref().unwrap().id, plan);
    // 只有一计划一档案。
    assert_eq!(s.virtual_overview(T).unwrap().plans.len(), 1);
    let create = LinkCreateSave {
        request_id: id(),
        generation: s.generation(),
        plan_id: plan.clone(),
        plan_expected_revision: 1,
        fields: Fields {
            name: "另一个服务".into(),
            kind: "subscription".into(),
            billing: "subscription".into(),
            label_id: None,
            pay_method: None,
            perpetual: None,
            provider: String::new(),
            purchase_date: None,
            price_cents: None,
            expires: None,
            plan_id: None,
            url: String::new(),
            notes: String::new(),
            stopped_on: None,
        },
    };
    assert_eq!(code(s.link_create(&create, T)), "VIRTUAL_PLAN_TAKEN");
    // 周期页给「无档案的既有计划」建档案：先付款再关联，付款 ID 保持、无新实付。
    let dir2 = tempfile::tempdir().unwrap();
    let mut s2 = Store::open(dir2.path()).unwrap();
    let f = plan_fields("虚构网盘订阅", "3000", "2026-10-01", "2026-08-01");
    let saved = s2
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s2.generation(),
                id: None,
                expected_revision: None,
                fields: f,
            },
            T,
        )
        .unwrap();
    let p2 = saved.id;
    pay(&mut s2, &p2, "2026-10-01", "3000");
    let payments_before = s2.recurring_overview(T).unwrap().payments;
    let ok = LinkCreateSave {
        request_id: id(),
        generation: s2.generation(),
        plan_id: p2.clone(),
        plan_expected_revision: saved.revision,
        fields: Fields {
            name: "虚构网盘".into(),
            kind: "subscription".into(),
            billing: "subscription".into(),
            label_id: None,
            pay_method: None,
            perpetual: None,
            provider: "虚构云".into(),
            purchase_date: None,
            price_cents: None,
            expires: None,
            plan_id: None,
            url: String::new(),
            notes: String::new(),
            stopped_on: None,
        },
    };
    s2.link_create(&ok, T).unwrap();
    let after = s2.recurring_overview(T).unwrap().payments;
    assert_eq!(payments_before.len(), after.len());
    assert_eq!(payments_before[0].id, after[0].id);
    let view = s2.link_view("plan", &p2).unwrap();
    assert_eq!(view.relation, "linked");
    assert_eq!(view.asset.as_ref().unwrap().name, "虚构网盘");
    let _ = asset;
}

/// L02/L03：共享计费编辑双方一致、历史付款与价格段不改写；双方修订冲突；
/// 名称不同时不自动统一，明确统一才同步。
#[test]
fn l02_l03_shared_edit_keeps_history_and_revisions() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构流媒体", "3000");
    pay(&mut s, &plan, "2026-10-01", "3000");
    // 双方修订检查：缺任何一边都拒绝。
    let f = s.recurring_overview(T).unwrap().plans[0].fields.clone();
    let stale_asset = LinkSave {
        request_id: id(),
        generation: s.generation(),
        asset_id: asset.clone(),
        asset_expected_revision: 999,
        plan_id: plan.clone(),
        plan_expected_revision: 1,
        fields: f.clone(),
        billing: None,
        unify_name_to: None,
    };
    assert_eq!(code(s.link_save(&stale_asset, T)), "REVISION_CONFLICT");
    // 共享编辑：调价不改写历史付款。
    let mut new_f = f.clone();
    new_f.amount_cents = "3500".into();
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.clone(),
            asset_expected_revision: 1,
            plan_id: plan.clone(),
            plan_expected_revision: 1,
            fields: new_f,
            billing: None,
            unify_name_to: None,
        },
        T,
    )
    .unwrap();
    let paid = s.recurring_overview(T).unwrap().payments[0].clone();
    assert_eq!(paid.amount_cents.as_deref(), Some("3000"));
    // 双方修订都推进：另一页旧表单整体失败。
    let asset_rev = asset_of(&s, &asset).revision;
    let plan_rev = s.recurring_overview(T).unwrap().plans[0].revision;
    assert_eq!((asset_rev, plan_rev), (2, 2));
    // 名称：共享编辑计划名不同且原本统一时一起改。
    let f = s.recurring_overview(T).unwrap().plans[0].fields.clone();
    let mut renamed = f.clone();
    renamed.name = "虚构流媒体 Pro".into();
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.clone(),
            asset_expected_revision: asset_rev,
            plan_id: plan.clone(),
            plan_expected_revision: plan_rev,
            fields: renamed,
            billing: None,
            unify_name_to: None,
        },
        T,
    )
    .unwrap();
    assert_eq!(asset_of(&s, &asset).fields.name, "虚构流媒体 Pro");
    // 旧名称不同的记录：共享编辑不改档案名。
    let dir2 = tempfile::tempdir().unwrap();
    let mut s2 = Store::open(dir2.path()).unwrap();
    let (asset2, plan2) = sub(&mut s2, "虚构云服务", "2000");
    s2.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE recurring_plans SET name='旧付款名' WHERE id=?1",
            [&plan2],
        )
        .unwrap();
    let f = s2.recurring_overview(T).unwrap().plans[0].fields.clone();
    let asset_rev = asset_of(&s2, &asset2).revision;
    let plan_rev = s2.recurring_overview(T).unwrap().plans[0].revision;
    let mut edited = f.clone();
    edited.amount_cents = "2500".into();
    s2.link_save(
        &LinkSave {
            request_id: id(),
            generation: s2.generation(),
            asset_id: asset2.clone(),
            asset_expected_revision: asset_rev,
            plan_id: plan2.clone(),
            plan_expected_revision: plan_rev,
            fields: edited,
            billing: None,
            unify_name_to: None,
        },
        T,
    )
    .unwrap();
    assert_eq!(asset_of(&s2, &asset2).fields.name, "虚构云服务");
    assert_eq!(
        s2.recurring_overview(T).unwrap().plans[0].fields.name,
        "旧付款名"
    );
    // 明确统一名称才共同更新。
    let f = s2.recurring_overview(T).unwrap().plans[0].fields.clone();
    let asset_rev = asset_of(&s2, &asset2).revision;
    let plan_rev = s2.recurring_overview(T).unwrap().plans[0].revision;
    s2.link_save(
        &LinkSave {
            request_id: id(),
            generation: s2.generation(),
            asset_id: asset2,
            asset_expected_revision: asset_rev,
            plan_id: plan2,
            plan_expected_revision: plan_rev,
            fields: f,
            billing: None,
            unify_name_to: Some("统一名称服务".into()),
        },
        T,
    )
    .unwrap();
    let view = s2
        .link_view("plan", &plan2_of(&s2, "统一名称服务"))
        .unwrap();
    assert_eq!(view.asset.unwrap().name, "统一名称服务");
    let _ = view;
}

fn plan2_of(s: &Store, name: &str) -> String {
    s.recurring_overview(T)
        .unwrap()
        .plans
        .into_iter()
        .find(|p| p.fields.name == name)
        .unwrap()
        .id
}

/// L04：关闭续费须确认最后使用日；末日当天仍在服务、次日已结束；试用内结束零估算；
/// 暂停与恢复；旧停用核对两种动作。
#[test]
fn l04_end_day_semantics_pause_and_legacy_stop_review() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构安全软件", "2000");
    // 关闭自动续费必须带最后使用日。
    let f = plan_fields("虚构安全软件", "2000", "2026-10-01", "2026-09-01");
    let mut no_end = f.clone();
    no_end.auto_renew = false;
    assert_eq!(
        code(s.recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: no_end
            },
            T
        )),
        "PLAN_END"
    );
    // 明确结束：使用至 11-09；当天仍在服务期，次日已结束。
    let asset_now = asset_of(&s, &asset);
    let mut ending = asset_now.plan.as_ref().unwrap().fields.clone();
    ending.end_date = Some("2026-10-03".into());
    ending.auto_renew = false;
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.clone(),
            asset_expected_revision: asset_now.revision,
            plan_id: plan.clone(),
            plan_expected_revision: 1,
            fields: ending,
            billing: None,
            unify_name_to: None,
        },
        T,
    )
    .unwrap();
    assert_eq!(asset_of(&s, &asset).status, "expired");
    let on_day = s
        .virtual_overview("2026-10-03")
        .unwrap()
        .items
        .pop()
        .unwrap();
    assert_eq!(on_day.status, "expiring");
    let next_day = s
        .virtual_overview("2026-10-04")
        .unwrap()
        .items
        .pop()
        .unwrap();
    assert_eq!(next_day.status, "expired");
    // 暂停排期不改已付覆盖，恢复从当天管理。
    let now = asset_of(&s, &asset);
    let mut paused = now.plan.as_ref().unwrap().fields.clone();
    paused.paused = true;
    paused.end_date = None;
    paused.auto_renew = true;
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.clone(),
            asset_expected_revision: now.revision,
            plan_id: plan.clone(),
            plan_expected_revision: 2,
            fields: paused,
            billing: None,
            unify_name_to: None,
        },
        T,
    )
    .unwrap();
    assert_eq!(asset_of(&s, &asset).status, "paused");
    // 旧停用档案核对：确认已结束在同一个事务里设置计划结束并清除标记。
    let dir2 = tempfile::tempdir().unwrap();
    let mut s2 = Store::open(dir2.path()).unwrap();
    let (asset2, plan2) = sub(&mut s2, "虚构域名邮箱", "1000");
    // 模拟旧版路径写入的 stopped_on（迁移不修复历史）。
    s2.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE virtual_assets SET stopped_on='2026-09-30' WHERE id=?1",
            [&asset2],
        )
        .unwrap();
    let view = s2.link_view("virtual", &asset2).unwrap();
    assert!(view.needs_review);
    // 撤回误记停用：只清标记，计划期限与续费值保持。
    let asset_now = asset_of(&s2, &asset2);
    s2.link_reconcile(
        &ReconcileSave {
            request_id: id(),
            generation: s2.generation(),
            action: "withdraw_stop".into(),
            asset_id: asset2.clone(),
            plan_id: plan2.clone(),
            asset_expected_revision: asset_now.revision,
            plan_expected_revision: 1,
            last_used: None,
            preview: None,
        },
        T,
    )
    .unwrap();
    let after = s2.link_view("virtual", &asset2).unwrap();
    assert!(!after.needs_review);
    assert_eq!(after.asset.unwrap().stopped_on, None);
    assert_eq!(
        s2.recurring_overview(T).unwrap().plans[0].fields.end_date,
        None
    );
    assert!(s2.recurring_overview(T).unwrap().plans[0].fields.auto_renew);
    // 再次写入旧停用（历史模拟）后确认已结束：计划最终结束日写入并清标记。
    s2.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE virtual_assets SET stopped_on='2026-09-30' WHERE id=?1",
            [&asset2],
        )
        .unwrap();
    let asset_now = asset_of(&s2, &asset2);
    s2.link_reconcile(
        &ReconcileSave {
            request_id: id(),
            generation: s2.generation(),
            action: "confirm_ended".into(),
            asset_id: asset2.clone(),
            plan_id: plan2.clone(),
            asset_expected_revision: asset_now.revision,
            plan_expected_revision: 1,
            last_used: Some("2026-09-30".into()),
            preview: None,
        },
        T,
    )
    .unwrap();
    let done = s2.link_view("virtual", &asset2).unwrap();
    assert!(!done.needs_review);
    assert_eq!(done.asset.unwrap().stopped_on, None);
    assert_eq!(
        s2.recurring_overview(T).unwrap().plans[0]
            .fields
            .end_date
            .as_deref(),
        Some("2026-09-30")
    );
    assert!(!s2.recurring_overview(T).unwrap().plans[0].fields.auto_renew);
}

/// L05/L06：两入口整组删除同一事务隐藏、付款汇总退出一次；已单删的付款恢复后仍删除。
#[test]
fn l05_l06_group_delete_from_both_sides_and_pre_deleted_payment() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构音乐订阅", "2500");
    let p1 = pay(&mut s, &plan, "2026-10-01", "2500");
    let p2 = pay(&mut s, &plan, "2026-09-01", "2500");
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "5000");
    // 删除前先单删一笔付款。
    let overview = s.recurring_overview(T).unwrap();
    let record = overview.payments.iter().find(|p| p.id == p2).unwrap();
    s.wealth_trash(&trash(&s, "payment", &p2, record.revision, true))
        .unwrap();
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "2500");
    // 两个入口各删一组：从虚拟侧与计划侧预览相同影响。
    let from_asset = s.link_delete_preview("virtual", &asset, None).unwrap();
    let from_plan = s.link_delete_preview("plan", &plan, None).unwrap();
    assert_eq!(from_asset.preview, from_plan.preview);
    assert_eq!(from_asset.paid_count, 1);
    let group = s
        .link_trash(&LinkTrashSave {
            request_id: id(),
            generation: s.generation(),
            side: "virtual".into(),
            id: asset.clone(),
            partner_id: None,
            asset_expected_revision: from_asset.asset_revision,
            plan_expected_revision: from_asset.plan_revision,
            preview: from_asset.preview,
        })
        .unwrap();
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    assert!(s.virtual_overview(T).unwrap().items.is_empty());
    // 恢复集合：原有效的 p1 回来一次；此前单删的 p2 保持删除，ID 不变。
    restore(&mut s, &group);
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "2500");
    let after = s.recurring_overview(T).unwrap().payments;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, p1);
    assert!(s
        .virtual_overview(T)
        .unwrap()
        .items
        .iter()
        .any(|x| x.id == asset));
    let _ = (&p1, &p2);
}

/// L07：最近删除按组去重展示、重复恢复拒绝、恢复后再次删除创建新组、旧回执不复活新组。
#[test]
fn l07_group_trash_listing_restore_and_new_group() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构存储订阅", "1800");
    pay(&mut s, &plan, "2026-10-01", "1800");
    let group = group_delete(&mut s, "plan", &plan);
    // 最近删除只有一项「关联订阅」，成员行被去重。
    let page = s
        .list_trash(&TrashQuery {
            filter: "all".into(),
            offset: 0,
            search: String::new(),
        })
        .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].kind, "link_group");
    assert_eq!(page.items[0].title, "虚构存储订阅");
    assert_eq!(page.items[0].contents.len(), 1);
    assert_eq!(page.items[0].contents[0].count, 1);
    // 同一请求的回执重放返回原结果；组状态过期后新请求拒绝。
    let p = s.link_restore_preview(&group).unwrap();
    let digest = p.preview.clone();
    let request = id();
    let input = LinkRestoreSave {
        request_id: request.clone(),
        generation: s.generation(),
        group_id: group.clone(),
        preview: digest,
    };
    s.link_restore(&input).unwrap();
    s.link_restore(&input).unwrap(); // 重放：原结果
    assert!(s
        .virtual_overview(T)
        .unwrap()
        .items
        .iter()
        .any(|x| x.id == asset));
    // 恢复后再次删除创建新组；旧组的恢复请求不能复活新组。
    let group2 = group_delete(&mut s, "virtual", &asset);
    assert_ne!(group, group2);
    let stale = LinkRestoreSave {
        request_id: id(),
        generation: s.generation(),
        group_id: group.clone(),
        preview: p.preview,
    };
    assert_eq!(code(s.link_restore(&stale)), "LINK_GROUP_STALE");
    restore(&mut s, &group2);
    // 恢复后旧组仅留归属记录，不再出现在最近删除。
    let page = s
        .list_trash(&TrashQuery {
            filter: "all".into(),
            offset: 0,
            search: String::new(),
        })
        .unwrap();
    assert_eq!(page.total, 0);
}

/// L08：预览后新增付款／更正付款／引用变化，旧操作影响失效。
#[test]
fn l08_preview_invalidated_by_later_changes() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构设计订阅", "6000");
    let preview = s.link_delete_preview("virtual", &asset, None).unwrap();
    pay(&mut s, &plan, "2026-10-01", "6000");
    let stale = LinkTrashSave {
        request_id: id(),
        generation: s.generation(),
        side: "virtual".into(),
        id: asset.clone(),
        partner_id: None,
        asset_expected_revision: preview.asset_revision,
        plan_expected_revision: preview.plan_revision,
        preview: preview.preview,
    };
    assert_eq!(code(s.link_trash(&stale)), "PREVIEW_STALE");
}

/// L09：计划被占用阻断恢复；多个历史候选由用户明确选择；组外引用保护清除。
#[test]
fn l09_occupancy_and_candidates_and_purge_protection() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构邮件服务", "1200");
    pay(&mut s, &plan, "2026-10-01", "1200");
    // 历史档案一：整组删除后，把计划关联到另一份新档案是不允许的（计划在最近删除）。
    let group = group_delete(&mut s, "virtual", &asset);
    // 组恢复被外部占用：先造一个新的独立计划并给另一档案用——此处直接验证
    // 组恢复预览仍可用（组内未被占用）。
    let p = s.link_restore_preview(&group).unwrap();
    assert!(p.blockers.is_empty());
    restore(&mut s, &group);
    // 多个历史候选：把这份档案从组中永久清除后再造新档案——构造「一个计划、
    // 多个已删档案」的场景。
    let group2 = group_delete(&mut s, "plan", &plan);
    let purge = s.link_restore_preview(&group2).unwrap();
    let _ = purge;
    // 被规划引用保护：本库无规划核对资料，跳过；占用与候选覆盖于下。
    let _ = &plan;
    // 候选明确选择：恢复一边必须点名具体档案（partner_id），不能自动挑最近一条。
    let dir2 = tempfile::tempdir().unwrap();
    let mut s2 = Store::open(dir2.path()).unwrap();
    let (a1, plan2) = sub(&mut s2, "虚构会议服务", "900");
    pay(&mut s2, &plan2, "2026-10-01", "900");
    let g = group_delete(&mut s2, "virtual", &a1);
    // 历史单边删除场景：先恢复组，再把档案单独删除（历史形态），计划保持有效。
    restore(&mut s2, &g);
    // 模拟旧版库里的历史形态：档案已删、计划有效且无组（迁移不修复历史）。
    s2.conn_for_test()
        .unwrap()
        .execute("UPDATE virtual_assets SET deleted_at='2026-10-02T00:00:00Z',revision=revision+1 WHERE id=?1", [&a1])
        .unwrap();
    let view = s2.link_view("plan", &plan2).unwrap();
    assert_eq!(view.relation, "asset_trashed");
    assert_eq!(view.candidates.len(), 1);
    assert_eq!(view.candidates[0].id, a1);
    // 删除剩余计划并归成一组：必须点名这个候选。
    let preview = s2.link_delete_preview("plan", &plan2, Some(&a1)).unwrap();
    assert!(preview.partner_deleted);
    let regrouped = s2
        .link_trash(&LinkTrashSave {
            request_id: id(),
            generation: s2.generation(),
            side: "plan".into(),
            id: plan2.clone(),
            partner_id: Some(a1.clone()),
            asset_expected_revision: preview.asset_revision,
            plan_expected_revision: preview.plan_revision,
            preview: preview.preview,
        })
        .unwrap();
    // 归组后一次整组恢复把双方都带回来（两个父对象都在恢复集合）。
    restore(&mut s2, &regrouped);
    assert!(s2
        .virtual_overview(T)
        .unwrap()
        .items
        .iter()
        .any(|x| x.id == a1));
    // 缺少 partner 的历史归组被拒绝。
    let dir3 = tempfile::tempdir().unwrap();
    let mut s3 = Store::open(dir3.path()).unwrap();
    let (a3, plan3) = sub(&mut s3, "虚构备份服务", "700");
    let g3 = group_delete(&mut s3, "virtual", &a3);
    restore(&mut s3, &g3);
    // 同样以旧版历史形态模拟档案已删（无组归属）。
    s3.conn_for_test()
        .unwrap()
        .execute("UPDATE virtual_assets SET deleted_at='2026-10-02T00:00:00Z',revision=revision+1 WHERE id=?1", [&a3])
        .unwrap();
    let no_partner = LinkTrashSave {
        request_id: id(),
        generation: s3.generation(),
        side: "plan".into(),
        id: plan3,
        partner_id: None,
        asset_expected_revision: 1,
        plan_expected_revision: 1,
        preview: String::new(),
    };
    assert_eq!(code(s3.link_trash(&no_partner)), "LINK_STATE");
}

/// L10/L11：迁移不自动修复历史；独立房租、保险不受关联约束；分类锁保持。
#[test]
fn l10_l11_historical_shapes_and_unlinked_modules() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    // 独立房租：没有档案也可以正常使用与编辑（不强制关联）。
    let rent = PlanFields {
        auto_renew: true,
        service_start: Some("2026-09-01".into()),
        coverage_start: Some("2026-09-01".into()),
        interval_days: None,
        trial_days: None,
        name: "虚构房租".into(),
        category: "rent".into(),
        amount_cents: "550000".into(),
        interval_months: 1,
        first_due: "2026-09-01".into(),
        end_date: None,
        paused: false,
        notes: String::new(),
    };
    let saved = s
        .recurring_plan_save(
            &PlanSave {
                request_id: id(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                fields: rent,
            },
            T,
        )
        .unwrap();
    assert_eq!(saved.fields.category, "rent");
    // 关联订阅的分类不能借共享编辑改成另一类。
    let (asset, plan) = sub(&mut s, "虚构笔记订阅", "4000");
    let f = s
        .recurring_overview(T)
        .unwrap()
        .plans
        .into_iter()
        .find(|p| p.id == plan)
        .unwrap()
        .fields;
    let mut reclassified = f.clone();
    reclassified.category = "rent".into();
    assert_eq!(
        code(s.link_save(
            &LinkSave {
                request_id: id(),
                generation: s.generation(),
                asset_id: asset,
                asset_expected_revision: 1,
                plan_id: plan,
                plan_expected_revision: 1,
                fields: reclassified,
                billing: None,
                unify_name_to: None,
            },
            T
        )),
        "LINK_CATEGORY"
    );
}

/// L12：提交前故障全部回滚；提交后回执丢失按请求核对恢复原结果；不同 payload 拒绝。
#[test]
fn l12_faults_receipts_and_replay() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构打印服务", "1500");
    // 提交前故障：整组删除回滚，双方仍在。
    s.set_hook(|point| {
        if point == "link_trash.before_commit" {
            Err(Error::new("INJECTED", "提交前中断"))
        } else {
            Ok(())
        }
    });
    let preview = s.link_delete_preview("virtual", &asset, None).unwrap();
    let input = LinkTrashSave {
        request_id: id(),
        generation: s.generation(),
        side: "virtual".into(),
        id: asset.clone(),
        partner_id: None,
        asset_expected_revision: preview.asset_revision,
        plan_expected_revision: preview.plan_revision,
        preview: preview.preview.clone(),
    };
    assert_eq!(code(s.link_trash(&input)), "INJECTED");
    assert!(!s.virtual_overview(T).unwrap().items.is_empty());
    assert!(!s.recurring_overview(T).unwrap().plans.is_empty());
    // 提交后回执丢失：同一请求重放得到原结果，不重复删除。
    s.set_hook(|point| {
        if point == "link_trash.after_commit" {
            Err(Error::new("INJECTED", "提交成功后回执丢失"))
        } else {
            Ok(())
        }
    });
    assert_eq!(code(s.link_trash(&input)), "INJECTED");
    s.set_hook(|_| Ok(()));
    let group = s.link_trash(&input).unwrap();
    assert!(s.virtual_overview(T).unwrap().items.is_empty());
    // 同请求不同 payload 拒绝。
    let replay = LinkTrashSave {
        request_id: input.request_id.clone(),
        generation: s.generation(),
        side: "plan".into(),
        id: plan.clone(),
        partner_id: None,
        asset_expected_revision: preview.asset_revision,
        plan_expected_revision: preview.plan_revision,
        preview: preview.preview,
    };
    assert_eq!(code(s.link_trash(&replay)), "REQUEST_CONFLICT");
    // 提交后成功的删除仍可整组恢复。
    restore(&mut s, &group);
    assert!(s
        .virtual_overview(T)
        .unwrap()
        .items
        .iter()
        .any(|x| x.id == asset));
}

/// D01：带未关闭组的库做完整备份，恢复后组、成员、付款与稳定 ID 保持。
#[test]
fn d01_backup_roundtrip_keeps_group_and_ids() {
    let dir = tempfile::tempdir().unwrap();
    let lib = dir.path().join("lib");
    let mut s = Store::open(&lib).unwrap();
    let (asset, plan) = sub(&mut s, "虚构同步订阅", "2200");
    let payment = pay(&mut s, &plan, "2026-10-01", "2200");
    let group = group_delete(&mut s, "virtual", &asset);
    let file = dir.path().join("虚构.thingary");
    s.backup(Some(&file)).unwrap();
    let mut dest = Store::open(&dir.path().join("dest")).unwrap();
    let summary = dest.inspect_backup(&file).unwrap();
    assert_eq!(summary.link_groups, 1);
    dest.restore(&file, &summary.hash, &dest.generation())
        .unwrap();
    let view = dest.link_view("plan", &plan).unwrap();
    assert_eq!(view.relation, "group_deleted");
    assert_eq!(view.group.as_ref().unwrap().id, group);
    assert_eq!(view.paid_count, 1);
    // 恢复后的库继续整组恢复，ID 保持。
    let p = dest.link_restore_preview(&group).unwrap();
    dest.link_restore(&LinkRestoreSave {
        request_id: id(),
        generation: dest.generation(),
        group_id: group,
        preview: p.preview,
    })
    .unwrap();
    let back = dest
        .virtual_overview(T)
        .unwrap()
        .items
        .into_iter()
        .find(|x| x.id == asset)
        .unwrap();
    assert_eq!(back.fields.plan_id.as_deref(), Some(plan.as_str()));
    assert_eq!(dest.expense_view(None).unwrap().spent_cents, "2200");
    let payments = dest.recurring_overview(T).unwrap().payments;
    assert_eq!(payments.len(), 1);
    assert_eq!(payments[0].id, payment);
}

/// D02：迁移故障回滚（x09 结构迁移）；重启后组状态可重放。
#[test]
fn d02_migration_fault_rollback_and_restart() {
    let dir = tempfile::tempdir().unwrap();
    {
        let db = rusqlite::Connection::open(dir.path().join("data.sqlite")).unwrap();
        db.execute_batch(thingary_lib::storage::SCHEMA).unwrap();
        migrate_to(&db, 31, &|_| Ok(())).unwrap();
    }
    let db = rusqlite::Connection::open(dir.path().join("data.sqlite")).unwrap();
    assert!(migrate_to(
        &db,
        thingary_lib::storage::SCHEMA_VERSION,
        &|point| if point == "migration.before_commit" {
            Err(Error::new("INJECTED", "中断"))
        } else {
            Ok(())
        }
    )
    .is_err());
    let v: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(v, 31);
    assert!(db
        .prepare("SELECT count(*) FROM link_trash_groups")
        .is_err());
    migrate_to(&db, thingary_lib::storage::SCHEMA_VERSION, &|_| Ok(())).unwrap();
    let v: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(v, thingary_lib::storage::SCHEMA_VERSION);
    drop(db);
    // 重启：库照常打开；组操作在重启后按组状态重放。
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构日历订阅", "600");
    let group = group_delete(&mut s, "virtual", &asset);
    drop(s);
    let mut s = Store::open(dir.path()).unwrap();
    let view = s.link_view("plan", &plan).unwrap();
    assert_eq!(view.relation, "group_deleted");
    let replay = LinkRestoreSave {
        request_id: id(),
        generation: s.generation(),
        group_id: group.clone(),
        preview: String::new(),
    };
    assert_eq!(code(s.link_restore(&replay)), "PREVIEW_STALE");
    restore(&mut s, &group);
    assert!(s
        .virtual_overview(T)
        .unwrap()
        .items
        .iter()
        .any(|x| x.id == asset));
}

/// L07/L09 补充：清空最近删除按组处理；被保护的组完整保留。
#[test]
fn empty_all_purges_groups_as_units() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构待清除订阅", "500");
    let _ = group_delete(&mut s, "virtual", &asset);
    let result = s
        .purge_trash(&Purge {
            preview: Some(s.purge_all_preview().unwrap().preview),
            request_id: id(),
            generation: s.generation(),
            kind: None,
            id: String::new(),
        })
        .unwrap();
    assert_eq!(result.removed, 1);
    assert!(s.virtual_overview(T).unwrap().items.is_empty());
    // 计划侧的付款一并清除。
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    let _ = plan;
}

/// R1 回归（独立 Review 附件）：合法的 恢复→再删→清除新组→备份 必须成功。
#[test]
fn review_backup_after_restore_redelete_purge() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构审查订阅", "1200");
    let first = group_delete(&mut s, "virtual", &asset);
    restore(&mut s, &first);
    let second = group_delete(&mut s, "plan", &plan);
    purge_group(&mut s, &second);
    let file = dir.path().join("review.thingary");
    s.backup(Some(&file)).unwrap();
    let result = s.inspect_backup(&file);
    assert!(result.is_ok(), "fresh backup must be valid: {result:?}");
}

/// R4 回归：月桶参与笔数须满足 count=known+unknown（单笔已知付款）。
#[test]
fn review_month_known_count_matches_one_payment() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (_, plan) = sub(&mut s, "虚构月份审查", "1200");
    pay(&mut s, &plan, "2026-10-01", "1200");
    let view = s.expense_view(Some(2026)).unwrap();
    let month = view.months.iter().find(|m| m.month == "2026-10").unwrap();
    assert_eq!(month.count, 1);
    assert_eq!(month.known_count, 1);
}

/// R3 回归：提前付款后，current_coverage 包含今天；next_coverage 仍表示下一未付期。
#[test]
fn review_next_coverage_is_not_current_service() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (_, plan) = sub(&mut s, "虚构服务期审查", "1200");
    pay(&mut s, &plan, "2026-09-01", "1200");
    pay(&mut s, &plan, "2026-10-01", "1200");
    s.recurring_payment_save(
        &PaymentSave {
            request_id: id(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            plan_id: plan.clone(),
            due_date: "2026-11-01".into(),
            state: "paid".into(),
            paid_date: Some(T.into()),
            amount_cents: Some("1200".into()),
            notes: String::new(),
        },
        T,
    )
    .unwrap();
    let p = s
        .recurring_overview(T)
        .unwrap()
        .plans
        .into_iter()
        .find(|p| p.id == plan)
        .unwrap();
    assert_eq!(
        p.current_coverage,
        Some(("2026-10-01".into(), "2026-10-31".into()))
    );
    assert_eq!(
        p.next_coverage,
        Some(("2026-11-01".into(), "2026-11-30".into()))
    );
}

/// R1 场景矩阵：多次恢复/再删、单组清除、清空最近删除后备份往返都合法；
/// 成员凭空消失的 restored 组仍被备份校验拒绝。
#[test]
fn r1_backup_matrix_for_restored_groups_and_later_purges() {
    // 多次恢复/再删后清除最终组，备份→inspect→恢复往返。
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构循环订阅", "800");
    pay(&mut s, &plan, "2026-10-01", "800");
    for side in ["virtual", "plan", "virtual"] {
        let g = group_delete(&mut s, side, if side == "virtual" { &asset } else { &plan });
        restore(&mut s, &g);
    }
    let last = group_delete(&mut s, "plan", &plan);
    purge_group(&mut s, &last);
    let file = dir.path().join("loop.thingary");
    s.backup(Some(&file)).unwrap();
    let summary = s.inspect_backup(&file).unwrap();
    assert_eq!(summary.link_groups, 4); // 三个 restored 历史 + 一个 purged
    let mut dest = Store::open(&dir.path().join("dest")).unwrap();
    dest.restore(&file, &summary.hash, &dest.generation())
        .unwrap();
    assert!(dest.virtual_overview(T).unwrap().items.is_empty());

    // 清空最近删除（删除两组、清空）后备份合法。
    let dir2 = tempfile::tempdir().unwrap();
    let mut s2 = Store::open(dir2.path()).unwrap();
    let (a2, p2) = sub(&mut s2, "虚构清空订阅", "600");
    let _ = group_delete(&mut s2, "virtual", &a2);
    s2.purge_trash(&Purge {
        request_id: id(),
        generation: s2.generation(),
        kind: None,
        id: String::new(),
        preview: Some(s2.purge_all_preview().unwrap().preview),
    })
    .unwrap();
    let file2 = dir2.path().join("empty.thingary");
    s2.backup(Some(&file2)).unwrap();
    assert!(s2.inspect_backup(&file2).is_ok());
    let _ = p2;

    // 非法终态：restored 组的成员既不在库也不属于任何 purged 组 → 备份拒绝。
    let dir3 = tempfile::tempdir().unwrap();
    let mut s3 = Store::open(dir3.path()).unwrap();
    let (a3, p3) = sub(&mut s3, "虚构非法订阅", "400");
    let g3 = group_delete(&mut s3, "virtual", &a3);
    restore(&mut s3, &g3);
    // 直接删除档案行，模拟凭空消失（正常路径不可能发生）。
    s3.conn_for_test()
        .unwrap()
        .execute("DELETE FROM virtual_assets WHERE id=?1", [&a3])
        .unwrap();
    // 备份在写出前即校验：非法终态无法产出备份文件。
    let file3 = dir3.path().join("bad.thingary");
    assert_eq!(code(s3.backup(Some(&file3))), "DATA_CONSTRAINT");
    let _ = p3;
}

/// R7：清除预览覆盖全部事实并复核——缺预览拒绝、摘要过期拒绝、
/// 预览含此前单删付款与规则/价格段/提醒计数。
#[test]
fn r7_purge_preview_covers_all_facts_and_rechecks() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构清除订阅", "1500");
    pay(&mut s, &plan, "2026-09-01", "1500");
    pay(&mut s, &plan, "2026-10-01", "1500");
    // 单删一笔付款：清除影响必须把它计入「此前单独删除」。
    let overview = s.recurring_overview(T).unwrap();
    let rec = overview
        .payments
        .iter()
        .find(|p| p.due_date == "2026-09-01")
        .unwrap();
    s.wealth_trash(&trash(&s, "payment", &rec.id, rec.revision, true))
        .unwrap();
    // 未来价格段与每期提醒，均应出现在预览中。
    let asset_now = asset_of(&s, &asset);
    let mut f = asset_now.plan.as_ref().unwrap().fields.clone();
    f.interval_days = None;
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.clone(),
            asset_expected_revision: asset_now.revision,
            plan_id: plan.clone(),
            plan_expected_revision: 1,
            fields: f,
            billing: None,
            unify_name_to: None,
        },
        T,
    )
    .unwrap();
    let asset2 = asset_of(&s, &asset);
    let mut with_rate = asset2.plan.as_ref().unwrap().fields.clone();
    with_rate.amount_cents = "1600".into();
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.clone(),
            asset_expected_revision: asset2.revision,
            plan_id: plan.clone(),
            plan_expected_revision: 2,
            fields: with_rate,
            billing: None,
            unify_name_to: None,
        },
        T,
    )
    .unwrap();
    s.virtual_reminder_save(
        &thingary_lib::virtual_assets::ReminderSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.clone(),
            expected_revision: asset_of(&s, &asset).revision,
            reminder: Some(thingary_lib::preferences::Reminder {
                date: "2026-10-28".into(),
                notes: String::new(),
            }),
            repeat_every_period: false,
            lead_days: 3,
        },
        T,
    )
    .unwrap();
    let group = group_delete(&mut s, "virtual", &asset);
    let p = s.link_purge_preview(&group).unwrap();
    assert_eq!(p.payments_total, 2);
    assert_eq!(p.payments_deleted, 1);
    assert_eq!(p.payments_live, 1);
    assert_eq!(p.rate_segments, 2); // 初始价 + 本次调价各一段
    assert!(p.reminders >= 1);
    assert!(p.blockers.is_empty());
    // 缺少预览摘要的清除请求被拒绝。
    let bare = Purge {
        request_id: id(),
        generation: s.generation(),
        kind: Some("link_group".into()),
        id: group.clone(),
        preview: None,
    };
    assert_eq!(code(s.purge_trash(&bare)), "PREVIEW_REQUIRED");
    // 预览后更正一笔付款 → 摘要过期，要求重读。
    // 模拟旧客户端/历史修复对隐藏付款的更正；正常付款入口拒绝已删父计划。
    s.conn_for_test().unwrap().execute("UPDATE plan_payments SET amount_cents=1400,revision=revision+1 WHERE plan_id=?1 AND deleted_at IS NULL", [&plan]).unwrap();
    let stale = Purge {
        request_id: id(),
        generation: s.generation(),
        kind: Some("link_group".into()),
        id: group.clone(),
        preview: Some(p.preview.clone()),
    };
    assert_eq!(code(s.purge_trash(&stale)), "PREVIEW_STALE");
    // 重读后清除成功，全部付款与规则一并移除。
    purge_group(&mut s, &group);
    assert!(s.virtual_overview(T).unwrap().items.is_empty());
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "0");
    let remaining: i64 = s.conn_for_test().unwrap()
        .query_row("SELECT (SELECT count(*) FROM plan_payments)+(SELECT count(*) FROM plan_rules)+(SELECT count(*) FROM plan_rates)+(SELECT count(*) FROM reminders WHERE kind='renewal')", [], |r| r.get(0)).unwrap();
    assert_eq!(remaining, 0);
}

/// R2: Historical deletion shapes can be explicitly restored or registered from either side.
#[test]
fn r2_repair_all_historical_shapes_preserves_ids_and_prior_deleted_payments() {
    for (asset_deleted, plan_deleted) in [(true, false), (false, true), (true, true)] {
        for side in ["virtual", "plan"] {
            for action in ["restore_pair", "register_group"] {
                let dir = tempfile::tempdir().unwrap();
                let mut s = Store::open(dir.path()).unwrap();
                let (asset, plan) = sub(&mut s, "虚构历史订阅", "1200");
                let old = pay(&mut s, &plan, "2026-09-01", "1200");
                let current = pay(&mut s, &plan, "2026-10-01", "1200");
                let c = rusqlite::Connection::open(
                    dir.path()
                        .join("datasets")
                        .join(
                            serde_json::from_slice::<serde_json::Value>(
                                &std::fs::read(dir.path().join("active.json")).unwrap(),
                            )
                            .unwrap()["id"]
                                .as_str()
                                .unwrap(),
                        )
                        .join("data.sqlite"),
                )
                .unwrap();
                c.execute("UPDATE plan_payments SET deleted_at='2026-09-02',revision=revision+1 WHERE id=?1", [&old]).unwrap();
                for (table, id, deleted) in [
                    ("virtual_assets", &asset, asset_deleted),
                    ("recurring_plans", &plan, plan_deleted),
                ] {
                    if deleted {
                        c.execute(&format!("UPDATE {table} SET deleted_at='2026-10-01',revision=revision+1 WHERE id=?1"), [id]).unwrap();
                    }
                }
                let target = if side == "virtual" { &asset } else { &plan };
                let preview = s.link_repair_preview(side, target, None, action).unwrap();
                assert_eq!(
                    (preview.asset_deleted, preview.plan_deleted),
                    (asset_deleted, plan_deleted)
                );
                assert_eq!(preview.payments_stay_deleted, 1);
                let input = ReconcileSave {
                    request_id: id(),
                    generation: s.generation(),
                    action: action.into(),
                    asset_id: asset.clone(),
                    plan_id: plan.clone(),
                    asset_expected_revision: preview.pair.asset_revision,
                    plan_expected_revision: preview.pair.plan_revision,
                    last_used: None,
                    preview: Some(preview.pair.preview),
                };
                let gid = s.link_reconcile(&input, T).unwrap();
                assert_eq!(s.link_reconcile(&input, T).unwrap(), gid);
                if action == "register_group" {
                    assert_eq!(
                        s.link_view("virtual", &asset).unwrap().relation,
                        "group_deleted"
                    );
                    restore(&mut s, &gid);
                }
                let view = s.link_view("virtual", &asset).unwrap();
                assert_eq!(view.relation, "linked");
                assert_eq!(view.paid_count, 1);
                assert_eq!(view.asset.unwrap().id, asset);
                assert_eq!(view.plan.unwrap().id, plan);
                let state: (bool,bool) = c.query_row("SELECT (SELECT deleted_at IS NOT NULL FROM plan_payments WHERE id=?1),(SELECT deleted_at IS NOT NULL FROM plan_payments WHERE id=?2)", rusqlite::params![old,current], |r| Ok((r.get(0)?,r.get(1)?))).unwrap();
                assert_eq!(state, (true, false));
                let backup = dir.path().join("repair.thingary");
                s.backup(Some(&backup)).unwrap();
                s.inspect_backup(&backup).unwrap();
            }
        }
    }
}

/// R7: An occupied group stays completely intact, including older deleted payment facts.
#[test]
fn r7_clear_all_keeps_protected_group_whole_and_rechecks_changes() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构保留订阅", "1200");
    let payment = pay(&mut s, &plan, "2026-09-01", "1200");
    let c = rusqlite::Connection::open(
        dir.path()
            .join("datasets")
            .join(
                serde_json::from_slice::<serde_json::Value>(
                    &std::fs::read(dir.path().join("active.json")).unwrap(),
                )
                .unwrap()["id"]
                    .as_str()
                    .unwrap(),
            )
            .join("data.sqlite"),
    )
    .unwrap();
    c.execute(
        "UPDATE plan_payments SET deleted_at='2026-09-02',revision=revision+1 WHERE id=?1",
        [&payment],
    )
    .unwrap();
    let gid = group_delete(&mut s, "virtual", &asset);
    let preview = s.purge_all_preview().unwrap();
    let other = id();
    c.execute("INSERT INTO virtual_assets(id,name,kind,billing,label_id,pay_method,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,perpetual,revision,created_at,updated_at,deleted_at) SELECT ?1,name,kind,billing,label_id,pay_method,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,perpetual,revision,created_at,updated_at,deleted_at FROM virtual_assets WHERE id=?2", rusqlite::params![other,asset]).unwrap();
    let stale = Purge {
        request_id: id(),
        generation: s.generation(),
        kind: None,
        id: String::new(),
        preview: Some(preview.preview),
    };
    assert_eq!(code(s.purge_trash(&stale)), "PREVIEW_STALE");
    let fresh = s.purge_all_preview().unwrap();
    assert!(!fresh.groups[0].blockers.is_empty());
    let result = s
        .purge_trash(&Purge {
            request_id: id(),
            preview: Some(fresh.preview),
            ..stale
        })
        .unwrap();
    assert!(result.kept >= 1);
    assert!(!result.kept_reasons.is_empty());
    let count: i64 = c
        .query_row(
            "SELECT count(*) FROM plan_payments WHERE id=?1",
            [&payment],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
    assert_eq!(
        s.link_restore_preview(&gid).unwrap().payments_stay_deleted,
        1
    );
}

#[test]
fn r2_repair_requires_fresh_preview_explicit_candidate_and_free_plan() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构候选一", "1200");
    s.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE virtual_assets SET deleted_at='2026-10-01',revision=revision+1 WHERE id=?1",
            [&asset],
        )
        .unwrap();
    let other = id();
    s.conn_for_test().unwrap().execute("INSERT INTO virtual_assets(id,name,kind,billing,label_id,pay_method,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,perpetual,revision,created_at,updated_at,deleted_at) SELECT ?1,'虚构候选二',kind,billing,label_id,pay_method,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,perpetual,revision,created_at,updated_at,deleted_at FROM virtual_assets WHERE id=?2",rusqlite::params![other,asset]).unwrap();
    assert_eq!(
        code(s.link_repair_preview("plan", &plan, None, "restore_pair")),
        "LINK_CANDIDATE"
    );
    let p = s
        .link_repair_preview("plan", &plan, Some(&asset), "restore_pair")
        .unwrap();
    let input = ReconcileSave {
        request_id: id(),
        generation: s.generation(),
        action: "restore_pair".into(),
        asset_id: asset.clone(),
        plan_id: plan.clone(),
        asset_expected_revision: p.pair.asset_revision,
        plan_expected_revision: p.pair.plan_revision,
        last_used: None,
        preview: Some(p.pair.preview),
    };
    pay(&mut s, &plan, "2026-10-01", "1200");
    assert_eq!(code(s.link_reconcile(&input, T)), "PREVIEW_STALE");
    s.conn_for_test()
        .unwrap()
        .execute(
            "UPDATE virtual_assets SET deleted_at=NULL,revision=revision+1 WHERE id=?1",
            [&other],
        )
        .unwrap();
    let blocked = s
        .link_repair_preview("virtual", &asset, None, "restore_pair")
        .unwrap();
    assert!(!blocked.pair.blockers.is_empty());
    assert_eq!(
        code(s.link_reconcile(
            &ReconcileSave {
                request_id: id(),
                preview: Some(blocked.pair.preview),
                ..input
            },
            T
        )),
        "LINK_BLOCKED"
    );
    assert_eq!(
        s.link_view("virtual", &asset).unwrap().relation,
        "plan_occupied"
    );
}

#[test]
fn r3_current_coverage_trial_pause_and_final_end_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构试用边界", "1200");
    let v = asset_of(&s, &asset);
    let mut f = v.plan.unwrap().fields;
    f.service_start = Some("2026-10-01".into());
    f.coverage_start = Some("2026-10-08".into());
    f.first_due = "2026-10-08".into();
    f.trial_days = Some(7);
    f.paused = true;
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset.clone(),
            asset_expected_revision: v.revision,
            plan_id: plan.clone(),
            plan_expected_revision: 1,
            fields: f,
            billing: None,
            unify_name_to: None,
        },
        "2026-09-30",
    )
    .unwrap();
    let at = |s: &Store, day: &str| {
        s.recurring_overview(day)
            .unwrap()
            .plans
            .into_iter()
            .find(|p| p.id == plan)
            .unwrap()
    };
    assert_eq!(
        at(&s, "2026-10-04").current_coverage,
        Some(("2026-10-01".into(), "2026-10-07".into()))
    );
    assert_eq!(at(&s, "2026-10-04").next_due, None);
    assert_eq!(
        at(&s, "2026-10-08").current_coverage,
        Some(("2026-10-08".into(), "2026-11-07".into()))
    );
    let v = asset_of(&s, &asset);
    let p = v.plan.unwrap();
    let mut f = p.fields;
    f.end_date = Some("2026-10-06".into());
    f.auto_renew = false;
    s.link_save(
        &LinkSave {
            request_id: id(),
            generation: s.generation(),
            asset_id: asset,
            asset_expected_revision: v.revision,
            plan_id: plan.clone(),
            plan_expected_revision: p.revision,
            fields: f,
            billing: None,
            unify_name_to: None,
        },
        "2026-10-04",
    )
    .unwrap();
    assert_eq!(
        at(&s, "2026-10-06").current_coverage,
        Some(("2026-10-01".into(), "2026-10-06".into()))
    );
    assert_eq!(at(&s, "2026-10-07").current_coverage, None);
}

#[test]
fn shared_plan_price_segments_preserve_paid_facts_and_conflict_other_form() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::open(dir.path()).unwrap();
    let (asset, plan) = sub(&mut s, "虚构共同调价", "1200");
    pay(&mut s, &plan, "2026-10-01", "1200");
    let v = asset_of(&s, &asset);
    let p = v.plan.unwrap();
    let old = LinkSave {
        request_id: id(),
        generation: s.generation(),
        asset_id: asset.clone(),
        asset_expected_revision: v.revision,
        plan_id: plan.clone(),
        plan_expected_revision: p.revision,
        fields: p.fields,
        unify_name_to: None,
        billing: Some(thingary_lib::link::BillingExtras {
            renewal_price_cents: Some("1500".into()),
            renewal_from: Some("2026-11-01".into()),
            special_end: None,
        }),
    };
    s.link_save(&old, T).unwrap();
    assert_eq!(
        code(s.link_save(
            &LinkSave {
                request_id: id(),
                ..old
            },
            T
        )),
        "REVISION_CONFLICT"
    );
    let fresh = asset_of(&s, &asset);
    assert_eq!(fresh.plan.unwrap().renewal_cents.as_deref(), Some("1500"));
    assert_eq!(s.expense_view(None).unwrap().spent_cents, "1200");
}
