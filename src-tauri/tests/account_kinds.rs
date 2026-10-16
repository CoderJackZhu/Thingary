//! V1 migration and account category invariants; all records are fictional.
use rusqlite::{types::Value, Connection};
use thingary_lib::{
    domain::Error,
    storage::{migrate_to, Store, SCHEMA},
    wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
};
fn rows(c: &Connection, table: &str) -> Vec<Vec<Value>> {
    let mut q = c
        .prepare(&format!("SELECT * FROM {table} ORDER BY 1,2"))
        .unwrap();
    let n = q.column_count();
    q.query_map([], |r| {
        (0..n).map(|i| r.get(i)).collect::<Result<Vec<Value>, _>>()
    })
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}
const TABLES: &[&str] = &[
    "fin_accounts",
    "fin_snapshot_entries",
    "fin_snapshots",
    "plan_income",
    "cash_movements",
    "import_external_key",
    "import_receipt",
];
fn fixture(foreign_keys: bool) -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 40, &|_| Ok(())).unwrap();
    c.execute_batch("INSERT INTO fin_accounts VALUES('a','虚构储蓄','虚构平台','asset','cash',1,'2020-01-01',NULL,'原备注',3,7,'原建档','原修改',NULL);
INSERT INTO fin_accounts VALUES('b','虚构旧其他资产','','asset','other_asset',1,'2020-01-01',NULL,'旧分类保留',4,2,'旧建档','旧修改',NULL);
INSERT INTO fin_accounts VALUES('deleted','虚构已删','','asset','cash',0,'2020-01-01',NULL,'已删备注',5,3,'旧建档','旧修改','已删');
INSERT INTO fin_snapshots VALUES('s','2026-01-01','原盘点',4,'建档','修改',NULL);
INSERT INTO fin_snapshots VALUES('deleted-s','2025-01-01','已删盘点',2,'建档','修改','已删');
INSERT INTO fin_snapshot_entries VALUES('s','a','entered',12345,'asset','cash',1);
INSERT INTO fin_snapshot_entries VALUES('s','b','missing',NULL,'asset','other_asset',1);
INSERT INTO fin_snapshot_entries VALUES('deleted-s','deleted','entered',9876,'asset','cash',0);
INSERT INTO plan_income(id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at,category,source_account_id,destination,receiving_account_id) VALUES('i','2026-01-01',123,0,'原收入',5,'建档','修改','interest','a','transferred','b');
INSERT INTO cash_movements(id,revision,fact_revision,date,from_account_id,to_account_id,payload,created_at,updated_at) VALUES('m',3,2,'2026-01-01','a','b','原流动','建档','修改');
INSERT INTO import_external_key VALUES('虚构来源','组','account','外部账户','a','原指纹',4,'active','建档','修改');
INSERT INTO import_receipt VALUES('r','请求指纹','批次指纹','虚构来源','组','原回执','建档','committed');").unwrap();
    c.execute_batch(if foreign_keys {
        "PRAGMA foreign_keys=ON"
    } else {
        "PRAGMA foreign_keys=OFF"
    })
    .unwrap();
    c
}
#[test]
fn account_kinds_migration_preserves_all_rows_and_references() {
    for fk in [false, true] {
        let c = fixture(fk);
        let before: Vec<_> = TABLES.iter().map(|t| rows(&c, t)).collect();
        migrate_to(&c, 41, &|_| Ok(())).unwrap();
        for (i, table) in TABLES.iter().enumerate() {
            assert_eq!(rows(&c, table), before[i], "{table}");
        }
        assert_eq!(
            c.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, bool>(0))
                .unwrap(),
            fk
        );
        assert!(c
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
        for table in ["fin_snapshot_entries", "plan_income", "cash_movements"] {
            let mut q = c
                .prepare(&format!("PRAGMA foreign_key_list({table})"))
                .unwrap();
            let targets: Vec<String> = q
                .query_map([], |r| r.get(2))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert!(targets.iter().any(|t| t == "fin_accounts"));
            assert!(!targets.iter().any(|t| t.starts_with("new_")));
        }
        for kind in ["property", "pension", "insurance", "precious_metal"] {
            c.execute("INSERT INTO fin_accounts VALUES(?1,?1,'','asset',?1,0,'2020-01-01',NULL,'',10,1,'c','u',NULL)", [kind]).unwrap();
            c.execute(
                "INSERT INTO fin_snapshot_entries VALUES('s',?1,'entered',100,'asset',?1,0)",
                [kind],
            )
            .unwrap();
        }
        assert!(c
            .execute(
                "UPDATE fin_accounts SET counted=1 WHERE kind='property'",
                []
            )
            .is_err());
        assert!(c
            .execute(
                "UPDATE fin_snapshot_entries SET counted=1 WHERE kind='property'",
                []
            )
            .is_err());
        // A new database using the same published migration chain gets identical DDL.
        let fresh = Connection::open_in_memory().unwrap();
        fresh.execute_batch(SCHEMA).unwrap();
        migrate_to(&fresh, 41, &|_| Ok(())).unwrap();
        for table in ["fin_accounts", "fin_snapshot_entries"] {
            let ddl = |db: &Connection| {
                db.query_row(
                    "SELECT sql FROM sqlite_master WHERE name=?1",
                    [table],
                    |r| r.get::<_, String>(0),
                )
                .unwrap()
            };
            assert_eq!(ddl(&c), ddl(&fresh));
        }
    }
}
#[test]
fn account_kinds_migration_faults_restore_schema_content_and_fk_mode() {
    for fk in [false, true] {
        for point in [
            "migration.account_kinds.after_copy",
            "migration.account_kinds.after_swap",
            "migration.before_commit",
        ] {
            let c = fixture(fk);
            let before: Vec<_> = TABLES.iter().map(|t| rows(&c, t)).collect();
            let ddl: String = c.query_row("SELECT group_concat(sql,';') FROM (SELECT sql FROM sqlite_master ORDER BY name)", [], |r| r.get(0)).unwrap();
            let error = migrate_to(&c, 41, &|p| {
                if p == point {
                    Err(Error::new("INJECTED", "虚构中断"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
            assert_eq!(error.code, "INJECTED");
            assert!(c.is_autocommit());
            assert_eq!(
                c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                40
            );
            assert_eq!(
                c.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, bool>(0))
                    .unwrap(),
                fk
            );
            for (i, t) in TABLES.iter().enumerate() {
                assert_eq!(rows(&c, t), before[i]);
            }
            let after: String = c.query_row("SELECT group_concat(sql,';') FROM (SELECT sql FROM sqlite_master ORDER BY name)", [], |r| r.get(0)).unwrap();
            assert_eq!(ddl, after);
            migrate_to(&c, 41, &|_| Ok(())).unwrap();
        }
    }
    let c = fixture(true);
    c.execute_batch("BEGIN").unwrap();
    assert_eq!(
        migrate_to(&c, 41, &|_| Ok(())).unwrap_err().code,
        "DATABASE_FORMAT"
    );
    assert!(c
        .query_row("PRAGMA foreign_keys", [], |r| r.get::<_, bool>(0))
        .unwrap());
    c.execute_batch("ROLLBACK").unwrap();
}
fn save(s: &mut Store, kind: &str, counted: bool) -> thingary_lib::wealth::Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: format!("虚构 {kind}"),
                institution: String::new(),
                side: if kind == "loan" { "liability" } else { "asset" }.into(),
                kind: kind.into(),
                counted,
                opened_on: "2026-01-01".into(),
                closed_on: None,
                notes: String::new(),
                purchase_cents: None,
                purchased_on: None,
                group_id: None,
            },
        },
        "2026-10-15",
    )
    .unwrap()
}
#[test]
fn account_kinds_totals_unknown_history_search_and_backup() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Store::open(&tmp.path().join("source")).unwrap();
    thingary_lib::modules::initialize_runtime(&tmp.path().join("source"));
    let accounts: Vec<_> = [
        ("cash", true),
        ("pension", true),
        ("insurance", false),
        ("precious_metal", true),
        ("property", false),
        ("loan", true),
    ]
    .into_iter()
    .map(|(k, c)| save(&mut s, k, c))
    .collect();
    let amounts = [10000000, 5000000, 3000000, 2000000, 200000000, 60000000];
    let input = SnapshotSave {
        request_id: uuid::Uuid::new_v4().to_string(),
        generation: s.generation(),
        id: None,
        expected_revision: None,
        date: "2026-10-01".into(),
        notes: String::new(),
        entries: accounts
            .iter()
            .zip(amounts)
            .map(|(a, n)| EntryInput {
                account_id: a.id.clone(),
                state: "entered".into(),
                amount_cents: Some(n.to_string()),
            })
            .collect(),
    };
    let snapshot = s.wealth_snapshot_save(&input, "2026-10-15").unwrap();
    let p = &s.wealth_summary().unwrap().points[0];
    assert!(p.complete);
    assert_eq!(p.assets_cents, "17000000");
    assert_eq!(p.net_cents, "-43000000");
    assert!(!s
        .wealth_summary()
        .unwrap()
        .structure
        .iter()
        .any(|r| r.kind == "property" || r.kind == "insurance"));
    for term in ["房产", "个人养老金", "保险现金价值", "黄金与贵金属"] {
        let results = s
            .search_all(&thingary_lib::search::Query {
                keyword: term.into(),
                type_filter: "account".into(),
                offset: 0,
                limit: 20,
                generation: s.generation(),
                revision: None,
            })
            .unwrap();
        assert_eq!(results.total, 1, "{term}");
    }
    let mut property = accounts[4].fields.clone();
    property.counted = true;
    assert_eq!(
        s.wealth_account_save(
            &AccountSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: Some(accounts[4].id.clone()),
                expected_revision: Some(accounts[4].revision),
                fields: property
            },
            "2026-10-15"
        )
        .unwrap_err()
        .code,
        "PROPERTY_COUNTED"
    );
    let insurance = &accounts[2];
    let mut fields = insurance.fields.clone();
    fields.counted = true;
    s.wealth_account_save(
        &AccountSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: Some(insurance.id.clone()),
            expected_revision: Some(insurance.revision),
            fields,
        },
        "2026-10-15",
    )
    .unwrap();
    assert!(
        !s.wealth_snapshot(&snapshot.id)
            .unwrap()
            .unwrap()
            .entries
            .iter()
            .find(|e| e.account_id == insurance.id)
            .unwrap()
            .counted
    );
    let mut missing = input.clone();
    missing.request_id = uuid::Uuid::new_v4().to_string();
    missing.date = "2026-10-02".into();
    missing.entries[4].state = "missing".into();
    missing.entries[4].amount_cents = None;
    let incomplete = s.wealth_snapshot_save(&missing, "2026-10-15").unwrap();
    assert_eq!(incomplete.missing, vec![accounts[4].id.clone()]);
    let archive = tmp.path().join("虚构新类型.thingary");
    s.backup(Some(&archive)).unwrap();
    let mut restored = Store::open(&tmp.path().join("restored")).unwrap();
    let inspected = restored.inspect_backup(&archive).unwrap();
    restored
        .restore(&archive, &inspected.hash, &restored.generation())
        .unwrap();
    assert_eq!(restored.wealth_accounts().unwrap().len(), 6);
    assert_eq!(
        restored.wealth_summary().unwrap().points[0].net_cents,
        "-43000000"
    );
}

#[test]
fn account_kinds_migration_refuses_unknown_schema_without_dropping_it() {
    for alteration in [
        "ALTER TABLE fin_accounts ADD COLUMN extension_value TEXT; UPDATE fin_accounts SET extension_value='虚构扩展';",
        "DROP INDEX fin_entries_account; CREATE INDEX fin_entries_account ON fin_snapshot_entries(snapshot_id);",
        "CREATE TRIGGER unknown_account_trigger AFTER UPDATE ON fin_accounts BEGIN SELECT 1; END;",
    ] {
        let c = fixture(true);
        c.execute_batch(alteration).unwrap();
        let before: String = c.query_row("SELECT group_concat(sql,';') FROM (SELECT sql FROM sqlite_master ORDER BY name)", [], |r| r.get(0)).unwrap();
        assert!(migrate_to(&c, 41, &|_| Ok(())).is_err());
        assert_eq!(c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(), 40);
        assert!(c.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, bool>(0)).unwrap());
        let after: String = c.query_row("SELECT group_concat(sql,';') FROM (SELECT sql FROM sqlite_master ORDER BY name)", [], |r| r.get(0)).unwrap();
        assert_eq!(before, after);
    }
}
