//! Original fictional records for an isolated demonstration library.
use crate::{
    catalog::{AssetRecord, Details, SaveAsset},
    domain::{Error, Result, Save},
    lifecycle, maintenance,
    photos::Selection,
    sales,
    storage::Store,
    taxonomy::{self, Classification},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
struct Demo {
    key: String,
    name: String,
    brand: String,
    model: String,
    price_cents: Option<String>,
    purchase_date: Option<String>,
    category: String,
    icon: taxonomy::Icon,
    channel: Option<String>,
    notes: String,
    retired_on: Option<String>,
    sale: Option<sales::Fields>,
    maintenance: Option<maintenance::Fields>,
}
pub(crate) fn request(key: &str, step: &str) -> String {
    let hash = Sha256::digest(format!("possio.original-demo.v1:{key}:{step}"));
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&hash[..16]);
    uuid::Uuid::from_bytes(bytes).to_string()
}
fn photo(key: &str) -> &'static [u8] {
    // The Demo illustrations are exactly the built-in material artwork.
    crate::materials::builtin(key)
        .expect("checked-in Demo key is a material id")
        .bytes
}
fn option(
    s: &mut Store,
    kind: taxonomy::Kind,
    name: &str,
    icon: Option<taxonomy::Icon>,
) -> Result<String> {
    let snapshot = s.taxonomy_snapshot()?;
    let entries = match kind {
        taxonomy::Kind::Category => &snapshot.categories,
        taxonomy::Kind::Channel => &snapshot.channels,
    };
    if let Some(entry) = entries.iter().find(|e| e.name == name) {
        return Ok(entry.id.clone());
    }
    // A fresh request is appropriate here: name lookup deduplicates already-created options.
    let next = s.change_taxonomy(&taxonomy::Change {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: snapshot.generation,
        expected_revision: snapshot.revision,
        command: taxonomy::Command::Create {
            kind,
            name: name.into(),
            icon,
        },
    })?;
    let entries = match kind {
        taxonomy::Kind::Category => next.categories,
        taxonomy::Kind::Channel => next.channels,
    };
    entries
        .into_iter()
        .find(|e| e.name == name)
        .map(|e| e.id)
        .ok_or_else(|| Error::new("DEMO", "示例分类未能创建"))
}
fn import_one(s: &mut Store, a: &Demo, today: &str) -> Result<AssetRecord> {
    let generation = s.generation();
    let create_request = request(&a.key, "create");
    let record = if let Some(record) = s.saved_request(&create_request, &generation)? {
        record
    } else {
        let category_id = option(s, taxonomy::Kind::Category, &a.category, Some(a.icon))?;
        let channel_id = a
            .channel
            .as_ref()
            .map(|name| option(s, taxonomy::Kind::Channel, name, None))
            .transpose()?;
        let cover = s.stage_photo(
            &format!("原始 Demo 示意图（非实物照片）-{}.png", a.key),
            photo(&a.key),
            &generation,
            None,
        )?;
        s.save_asset(
            &SaveAsset {
                options: None,
                base: Save {
                    request_id: create_request,
                    generation: generation.clone(),
                    asset_id: None,
                    expected_revision: None,
                    name: a.name.clone(),
                    price_cents: a.price_cents.clone(),
                    purchase_date: a.purchase_date.clone(),
                },
                details: Details {
                    brand: a.brand.clone(),
                    model: a.model.clone(),
                    serial_number: String::new(),
                    notes: format!(
                        "{}\n\n原始 Demo 虚构样例，可编辑体验；图片为示意图。",
                        a.notes
                    ),
                },
                photos: Some(Selection {
                    ids: vec![cover.id.clone()],
                    cover_id: Some(cover.id),
                }),
                classification: Some(Classification {
                    category_id: Some(category_id),
                    channel_id,
                }),
            },
            today,
        )?
    };
    // Never infer the expected revision from a subsequently edited record. Partial imports
    // resume only at their original revision; completed imports never overwrite user edits.
    let mut expected_revision = 1;
    if let Some(fields) = &a.maintenance {
        let id = request(&a.key, "maintenance");
        if s.saved_request(&id, &generation)?.is_none() {
            s.change_maintenance(
                &maintenance::Change {
                    request_id: id,
                    generation: generation.clone(),
                    asset_id: record.asset.id.clone(),
                    expected_revision,
                    action: maintenance::Action::Add {
                        fields: fields.clone(),
                        photos: Selection {
                            ids: vec![],
                            cover_id: None,
                        },
                    },
                },
                today,
            )?;
        }
        expected_revision += 1;
    }
    if let Some(date) = &a.retired_on {
        let id = request(&a.key, "retire");
        if s.saved_request(&id, &generation)?.is_none() {
            s.change_lifecycle(
                &lifecycle::Change {
                    request_id: id,
                    generation: generation.clone(),
                    asset_id: record.asset.id.clone(),
                    expected_revision,
                    action: lifecycle::Action::Append {
                        kind: lifecycle::Kind::Retire,
                        date: date.clone(),
                        notes: "原始 Demo：留作备用机".into(),
                    },
                },
                today,
            )?;
        }
        expected_revision += 1;
    }
    if let Some(fields) = &a.sale {
        let id = request(&a.key, "sale");
        if s.saved_request(&id, &generation)?.is_none() {
            s.change_sale(
                &sales::Change {
                    request_id: id,
                    generation: generation.clone(),
                    asset_id: record.asset.id.clone(),
                    expected_revision,
                    action: sales::Action::Sell {
                        fields: fields.clone(),
                    },
                },
                today,
            )?;
        }
    }
    s.record(&record.asset.id)?
        .ok_or_else(|| Error::new("DEMO", "示例档案读取失败"))
}
pub fn import(s: &mut Store, today: &str) -> Result<Vec<AssetRecord>> {
    let data: Vec<Demo> = serde_json::from_str(include_str!("../../src/demo-assets.json"))?;
    let mut output = Vec::new();
    for a in data.iter().rev() {
        output.push(import_one(s, a, today)?);
    }
    output.reverse();
    Ok(output)
}

/// App-only full sample; the explicit legacy importer above still imports eight originals.
pub(crate) fn prepare(s: &mut Store, today: &str) -> Result<()> {
    let done = s.root.join("unified-demo-details-v1.complete");
    if done.exists() {
        return Ok(());
    }
    import(s, today)?;
    crate::demo_finance::import(s, today)?;
    let anchor = std::fs::read_to_string(s.root.join("unified-demo-v1.date"))?;
    let now = crate::domain::date(&anchor)?;
    let day = |offset: i64| {
        (now + chrono::Duration::days(offset))
            .format("%Y-%m-%d")
            .to_string()
    };
    let generation = s.generation();
    for (key, offset) in [("laptop", 15), ("camera", 0), ("phone", -10)] {
        let req = request(key, "unified-warranty-v1");
        if s.saved_request(&req, &generation)?.is_some() {
            continue;
        }
        if let Some(record) = s.saved_request(&request(key, "create"), &generation)? {
            if record.deleted {
                continue;
            }
            s.change_warranty(
                &crate::warranty::Change {
                    request_id: req,
                    generation: generation.clone(),
                    asset_id: record.asset.id,
                    expected_revision: record.asset.revision,
                    reminder: None,
                    action: crate::warranty::Action::Add {
                        fields: crate::warranty::Fields {
                            kind: "manufacturer".into(),
                            provider: "虚构服务商".into(),
                            start_date: Some(day(-300)),
                            end_date: Some(day(offset)),
                            notes: "虚构保障，可编辑体验；不发送系统通知。".into(),
                        },
                        photos: Selection {
                            ids: vec![],
                            cover_id: None,
                        },
                    },
                },
                today,
            )?;
        }
    }
    for (key, name, mode, saved, intent) in [
        ("tripod", "虚构轻便三脚架", "countdown", "0", "ongoing"),
        ("lens", "虚构旅行镜头", "savings", "150000", "ongoing"),
        ("display", "虚构便携显示器", "countdown", "0", "manual"),
    ] {
        s.save_wish_plan(
            &crate::wish_plan::Save {
                request_id: request(key, "unified-wish-v1"),
                generation: generation.clone(),
                id: None,
                expected_revision: None,
                fields: crate::wishlist::Fields {
                    name: name.into(),
                    category_id: None,
                    estimated_price_cents: Some("300000".into()),
                    priority: Some("medium".into()),
                    target_date: Some(day(30)),
                    external_link: String::new(),
                    notes: "虚构心愿；已实现项可追溯关联物品。".into(),
                },
                preferences: crate::wish_plan::Preferences {
                    added_date: Some(day(-30)),
                    mode: mode.into(),
                    saved_cents: saved.into(),
                    ..Default::default()
                },
                photos: Selection {
                    ids: vec![],
                    cover_id: None,
                },
                status_intent: intent.into(),
                achieved_date: if intent == "manual" {
                    Some(day(-5))
                } else {
                    None
                },
            },
            today,
        )?;
    }
    crate::storage::atomic_write(&done, b"1")?;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Pointer {
    directory: String,
    reset_request: Option<String>,
}
fn pointer_path(real_root: &std::path::Path) -> std::path::PathBuf {
    real_root.with_file_name("demo-active.json")
}
fn selected_root(real_root: &std::path::Path) -> Result<std::path::PathBuf> {
    let pointer = pointer_path(real_root);
    let name = if pointer.exists() {
        let p: Pointer = serde_json::from_slice(&std::fs::read(pointer)?)?;
        if p.directory != "demo-library"
            && p.directory
                .strip_prefix("demo-")
                .is_none_or(|id| uuid::Uuid::parse_str(id).is_err())
        {
            return Err(Error::new("DEMO_PATH", "样例目录无效，请重置样例"));
        }
        p.directory
    } else {
        "demo-library".into()
    };
    let root = real_root.with_file_name(name);
    if std::fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(Error::new("DEMO_PATH", "样例目录不能是符号链接"));
    }
    Ok(root)
}
pub(crate) fn open(real_root: &std::path::Path, today: &str) -> Result<Store> {
    let mut s = Store::open(&selected_root(real_root)?)?;
    prepare(&mut s, today)?;
    Ok(s)
}
pub(crate) fn reset(real: &Store, today: &str, request_id: &str) -> Result<Option<Store>> {
    uuid::Uuid::parse_str(request_id).map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
    let pointer = pointer_path(&real.root);
    if pointer.exists() {
        let prior: Pointer = serde_json::from_slice(&std::fs::read(&pointer)?)?;
        if prior.reset_request.as_deref() == Some(request_id) {
            return Ok(None);
        }
    }
    let directory = format!("demo-{}", uuid::Uuid::new_v4());
    let root = real.root.with_file_name(&directory);
    // tempfile owns cleanup of an incomplete candidate; keep it only after publishing.
    let candidate = tempfile::Builder::new()
        .prefix(&directory)
        .rand_bytes(0)
        .tempdir_in(
            real.root
                .parent()
                .ok_or_else(|| Error::new("DEMO_PATH", "缺少样例父目录"))?,
        )?;
    let mut next = Store::open(&root)?;
    prepare(&mut next, today)?;
    crate::storage::check_db(next.conn()?)?;
    real.hit("demo.before_publish")?;
    let bytes = serde_json::to_vec(&Pointer {
        directory,
        reset_request: Some(request_id.into()),
    })?;
    // Keep the directory if rename succeeded but the following directory fsync failed.
    if let Err(error) = crate::storage::atomic_write(&pointer, &bytes) {
        if std::fs::read(&pointer).is_ok_and(|saved| saved == bytes) {
            let _ = candidate.keep();
        }
        return Err(error);
    }
    let _ = candidate.keep();
    Ok(Some(next))
}

#[cfg(test)]
mod unified_tests {
    use super::*;
    const TODAY: &str = "2026-09-28";
    #[test]
    fn full_sample_is_consistent_and_reentry_preserves_edits() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::open(&tmp.path().join("demo-library")).unwrap();
        prepare(&mut s, TODAY).unwrap();
        let summary = s.wealth_summary().unwrap();
        assert_eq!(summary.points.len(), 6);
        assert_eq!(summary.points.iter().filter(|p| !p.complete).count(), 1);
        let latest = summary.points.last().unwrap();
        assert_eq!(latest.net_cents, "35000000");
        assert_eq!(latest.change_cents.as_deref(), Some("2240000"));
        let recurring = s.recurring_overview(TODAY).unwrap();
        assert_eq!(recurring.plans.len(), 4);
        assert_eq!(recurring.payments.len(), 4);
        assert_eq!(recurring.annual_cents, "3756000");
        assert_eq!(recurring.monthly_cents, "313000");
        assert!(!recurring.due.is_empty());
        assert!(!recurring.upcoming.is_empty());
        let expenses = s.expense_view(None).unwrap();
        assert_eq!(
            expenses
                .lines
                .iter()
                .filter(|l| l.source == "payment")
                .count(),
            4
        );
        assert_eq!(expenses.refund_cents, "60000");
        // Original dated purchases 39286 + maintenance 819 + 16400 standalone + 6240 payments.
        assert_eq!(expenses.spent_cents, "6274500");
        assert_eq!(expenses.undated_cents, "100000");
        assert_eq!(
            s.conn()
                .unwrap()
                .query_row("SELECT count(*) FROM wishlist_items", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            3
        );
        assert_eq!(
            s.conn()
                .unwrap()
                .query_row("SELECT count(*) FROM warranties", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            3
        );
        let account = s.wealth_accounts().unwrap().remove(0);
        let mut fields = account.fields;
        fields.name = "已编辑样例账户".into();
        s.wealth_account_save(
            &crate::wealth::AccountSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: Some(account.id),
                expected_revision: Some(1),
                fields,
            },
            TODAY,
        )
        .unwrap();
        prepare(&mut s, "2027-01-01").unwrap();
        assert_eq!(
            s.wealth_accounts().unwrap()[0].fields.name,
            "已编辑样例账户"
        );
        assert_eq!(
            s.wealth_summary().unwrap().points.last().unwrap().date,
            TODAY
        );
    }
    #[test]
    fn legacy_deleted_asset_is_not_recreated_or_counted_as_standalone_expense() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = Store::open(tmp.path()).unwrap();
        import(&mut store, TODAY).unwrap();
        let laptop = store
            .saved_request(&request("laptop", "create"), &store.generation())
            .unwrap()
            .unwrap();
        store
            .conn()
            .unwrap()
            .execute(
                "UPDATE assets SET deleted_at='2026-09-28T00:00:00Z' WHERE id=?1",
                [&laptop.asset.id],
            )
            .unwrap();
        prepare(&mut store, TODAY).unwrap();
        assert!(store.record(&laptop.asset.id).unwrap().unwrap().deleted);
        assert_eq!(store.expense_view(None).unwrap().spent_cents, "4574600");
        prepare(&mut store, "2027-01-01").unwrap();
        assert!(store.record(&laptop.asset.id).unwrap().unwrap().deleted);
    }

    #[test]
    fn calendar_edges_keep_sample_dates_valid_and_totals_stable() {
        for today in ["2027-01-31", "2028-02-29", "2028-12-31"] {
            let tmp = tempfile::tempdir().unwrap();
            let mut store = Store::open(tmp.path()).unwrap();
            prepare(&mut store, today).unwrap();
            let summary = store.wealth_summary().unwrap();
            assert_eq!(summary.points.len(), 6);
            assert_eq!(summary.points.last().unwrap().date, today);
            assert_eq!(
                store.recurring_overview(today).unwrap().annual_cents,
                "3756000"
            );
            assert_eq!(store.expense_view(None).unwrap().spent_cents, "6274500");
        }
    }

    #[test]
    fn reset_failure_retains_sample_then_success_reopens_and_retries_once() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("library");
        let mut real = Store::open(&root).unwrap();
        let old = open(&root, TODAY).unwrap();
        let old_generation = old.generation();
        drop(old);
        let request = uuid::Uuid::new_v4().to_string();
        real.set_hook(|p| {
            if p == "demo.before_publish" {
                Err(Error::new("INJECTED", "模拟失败"))
            } else {
                Ok(())
            }
        });
        assert!(reset(&real, TODAY, &request).is_err());
        assert!(!pointer_path(&root).exists());
        assert_eq!(open(&root, TODAY).unwrap().generation(), old_generation);
        real.set_hook(|_| Ok(()));
        let next = reset(&real, TODAY, &request).unwrap().unwrap();
        let new_generation = next.generation();
        drop(next);
        assert_ne!(new_generation, old_generation);
        assert_eq!(
            open(&root, "2026-10-01").unwrap().generation(),
            new_generation
        );
        assert!(reset(&real, TODAY, &request).unwrap().is_none());
        assert!(!real.has_any_asset().unwrap());
        assert!(real.wealth_accounts().unwrap().is_empty());
    }
    #[test]
    fn sample_pointer_cannot_target_personal_library_or_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("library");
        let _real = Store::open(&root).unwrap();
        std::fs::write(
            pointer_path(&root),
            br#"{"directory":"library","reset_request":null}"#,
        )
        .unwrap();
        assert_eq!(open(&root, TODAY).err().unwrap().code, "DEMO_PATH");
        std::fs::remove_file(pointer_path(&root)).unwrap();
        std::os::unix::fs::symlink(&root, tmp.path().join("demo-library")).unwrap();
        assert_eq!(open(&root, TODAY).err().unwrap().code, "DEMO_PATH");
    }
}
