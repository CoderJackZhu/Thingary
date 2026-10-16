//! Fictional, explicitly isolated four-feature acceptance data. Never discovers an app root.
use std::path::{Component, Path, PathBuf};
use thingary_lib::{
    domain::Result,
    plan_income, savings_goals,
    storage::Store,
    wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
};
fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Shared by the integration test; creates facts only through public Store APIs.
pub fn seed(store: &mut Store, today: &str) -> Result<()> {
    let year: i32 = today[..4].parse().expect("validated fixture date");
    let previous = format!("{}-12-31", year - 1);
    let opened = format!("{}-01-01", year - 2);
    let mut accounts = Vec::new();
    for (kind, name, cents) in [
        ("cash", "虚构日常现金", 10_000_000_i64),
        ("pension", "虚构个人养老金", 5_000_000),
        ("precious_metal", "虚构黄金", 2_000_000),
        ("insurance", "虚构保险现金价值", 3_000_000),
        ("property", "虚构房产", 200_000_000),
        ("loan", "虚构住房贷款", 60_000_000),
    ] {
        let a = store.wealth_account_save(
            &AccountSave {
                request_id: id(),
                generation: store.generation(),
                id: None,
                expected_revision: None,
                fields: AccountFields {
                    name: name.into(),
                    institution: "纯虚构验收机构".into(),
                    side: if kind == "loan" { "liability" } else { "asset" }.into(),
                    kind: kind.into(),
                    counted: !matches!(kind, "property" | "insurance"),
                    opened_on: opened.clone(),
                    closed_on: None,
                    notes: "统一验收虚构资料，非真实资产".into(),
                    purchase_cents: None,
                    purchased_on: None,
                },
            },
            today,
        )?;
        accounts.push((a, cents));
    }
    for day in [&previous, today] {
        store.wealth_snapshot_save(
            &SnapshotSave {
                request_id: id(),
                generation: store.generation(),
                id: None,
                expected_revision: None,
                date: day.into(),
                notes: "纯虚构完整盘点".into(),
                entries: accounts
                    .iter()
                    .map(|(a, cents)| EntryInput {
                        account_id: a.id.clone(),
                        state: "entered".into(),
                        amount_cents: Some(
                            (if day == previous && a.fields.kind == "cash" {
                                cents - 1_000_000
                            } else {
                                *cents
                            })
                            .to_string(),
                        ),
                    })
                    .collect(),
            },
            today,
        )?;
    }
    for (name, target, selected) in [
        ("虚构应急储备", "12000000", vec![accounts[0].0.id.clone()]),
        (
            "虚构长期储备",
            "20000000",
            vec![accounts[0].0.id.clone(), accounts[1].0.id.clone()],
        ),
    ] {
        store.savings_goals_save(
            &savings_goals::Save {
                request_id: id(),
                generation: store.generation(),
                id: None,
                expected_revision: None,
                fields: savings_goals::Fields {
                    name: name.into(),
                    target_cents: target.into(),
                    target_date: Some(format!("{}-12-31", year + 1)),
                    notes: "虚构目标，不冻结或预留资金".into(),
                },
                account_ids: selected,
            },
            today,
            true,
        )?;
    }
    store.plan_income_save(
        &plan_income::Save {
            request_id: id(),
            generation: store.generation(),
            id: None,
            expected_revision: None,
            fields: plan_income::Fields {
                date: today.into(),
                net_cents: "1200000".into(),
                hpf_cents: None,
                notes: "纯虚构验收收入".into(),
                category: "unclassified".into(),
                source_account_id: None,
                destination: None,
                receiving_account_id: None,
            },
        },
        today,
    )?;
    Ok(())
}

fn guarded_root(input: &Path) -> std::result::Result<PathBuf, String> {
    if !input.is_absolute()
        || input
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return Err("--root 必须为不含相对跳转的绝对路径".into());
    }
    let mut existing = input;
    let mut suffix = Vec::new();
    while !existing.exists() {
        suffix.push(existing.file_name().ok_or("无效根目录")?.to_owned());
        existing = existing.parent().ok_or("无效根目录")?;
    }
    let mut resolved = existing.canonicalize().map_err(|e| e.to_string())?;
    for part in suffix.into_iter().rev() {
        resolved.push(part);
    }
    let forbidden = resolved.components().any(|c| {
        c.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("local.thingary.main")
    });
    let marker = resolved.components().any(|c| {
        matches!(
            c.as_os_str().to_str(),
            Some("local.thingary.mac.acceptance.v1234" | "local.thingary.win.acceptance.v1234")
        )
    });
    let temporary = [std::env::temp_dir(), PathBuf::from("/tmp")]
        .into_iter()
        .filter_map(|p| p.canonicalize().ok())
        .any(|tmp| {
            resolved
                .strip_prefix(tmp)
                .ok()
                .and_then(|p| p.components().next())
                .is_some_and(|c| {
                    c.as_os_str()
                        .to_string_lossy()
                        .starts_with("thingary-v1234")
                })
        });
    if forbidden || !(marker || temporary) {
        return Err("只允许专用 v1234 验收身份或系统临时目录中的 thingary-v1234* 子目录".into());
    }
    Ok(resolved)
}

fn reject_symlinks(path: &Path) -> std::io::Result<()> {
    for ancestor in path.ancestors() {
        let metadata = std::fs::symlink_metadata(ancestor)?;
        #[cfg(windows)]
        let redirected = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let redirected = metadata.file_type().is_symlink();
        if redirected {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "拒绝资料内部符号链接",
            ));
        }
    }
    Ok(())
}

fn inspect(root: &Path) -> std::result::Result<(), Box<dyn std::error::Error>> {
    reject_symlinks(&root.join("active.json"))?;
    let active: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("active.json"))?)?;
    let dataset = active["id"].as_str().ok_or("无效资料指针")?;
    uuid::Uuid::parse_str(dataset)?;
    let db = root.join("datasets").join(dataset).join("data.sqlite");
    reject_symlinks(&db)?;
    let c = rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let schema: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let mut counts = serde_json::Map::new();
    for table in [
        "fin_accounts",
        "fin_snapshots",
        "savings_goals",
        "savings_goal_accounts",
        "plan_income",
    ] {
        let count: i64 = c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
        counts.insert(table.into(), count.into());
    }
    let mut query = c.prepare(
        "SELECT kind,count(*),sum(counted) FROM fin_accounts GROUP BY kind ORDER BY kind",
    )?;
    let kinds = query.query_map([], |r| Ok(serde_json::json!({"kind":r.get::<_,String>(0)?, "count":r.get::<_,i64>(1)?, "counted":r.get::<_,i64>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let invalid_links: i64 = c.query_row("SELECT count(*) FROM savings_goal_accounts l LEFT JOIN savings_goals g ON g.id=l.goal_id LEFT JOIN fin_accounts a ON a.id=l.account_id WHERE g.id IS NULL OR a.id IS NULL", [], |r|r.get(0))?;
    println!(
        "{}",
        serde_json::json!({"mode":"read_only", "schema":schema, "counts":counts, "account_kinds":kinds, "dangling_goal_links":invalid_links})
    );
    Ok(())
}

#[allow(dead_code)] // Included as a fixture module by the integration test.
fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let mut root = None;
    let mut read_only = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" => {
                if root.is_some() {
                    return Err("重复 --root".into());
                }
                root = Some(PathBuf::from(args.next().ok_or("--root 缺少路径")?));
            }
            "--inspect" => read_only = true,
            _ => return Err(format!("未知参数 {arg}").into()),
        }
    }
    let root = guarded_root(&root.ok_or("必须显式传入 --root")?)?;
    if read_only {
        return inspect(&root);
    }
    if root.exists() && std::fs::read_dir(&root)?.next().is_some() {
        return Err("根目录非空，拒绝写入；已有验收资料仅可 --inspect".into());
    }
    let mut store = Store::open(&root)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    seed(&mut store, &today)?;
    println!(
        "已创建纯虚构四项验收资料：{}；备份安全未配置，等待真实 UI 验证。",
        root.display()
    );
    Ok(())
}

#[cfg(test)]
mod guard_tests {
    use super::*;
    #[test]
    fn root_guard_rejects_implicit_formal_and_relative_paths() {
        assert!(guarded_root(Path::new("relative/thingary-v1234")).is_err());
        let temp = tempfile::Builder::new()
            .prefix("thingary-v1234-guard-")
            .tempdir_in(std::env::temp_dir())
            .unwrap();
        assert!(guarded_root(&temp.path().join("new-library")).is_ok());
        assert!(guarded_root(&temp.path().join("local.thingary.main")).is_err());
        assert!(guarded_root(&temp.path().join("a/../new-library")).is_err());
        assert!(guarded_root(Path::new("/tmp/unrelated-library-v1234")).is_err());
    }
    #[test]
    fn explicit_windows_identity_is_portable_but_formal_identity_is_never_allowed() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp
            .path()
            .join("local.thingary.win.acceptance.v1234")
            .join("library");
        assert!(guarded_root(&root).is_ok());
        assert!(guarded_root(&root.join("LOCAL.THINGARY.MAIN")).is_err());
    }
    #[test]
    #[cfg(unix)]
    fn a_marker_symlink_cannot_authorize_an_unrelated_destination() {
        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let link = parent.path().join("local.thingary.mac.acceptance.v1234");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        assert!(guarded_root(&link.join("library")).is_err());
    }
}
