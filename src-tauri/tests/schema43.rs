//! Schema 43: account-table rebuild, new kinds and entry-layer columns. All records are fictional.
use rusqlite::{types::Value, Connection};
use thingary_lib::{
    domain::Error,
    storage::{migrate_to, Store, SCHEMA, SCHEMA_VERSION},
    wealth::{AccountFields, AccountSave, EntryInput, SnapshotSave},
};

fn rows(c: &Connection, sql: &str) -> Vec<Vec<Value>> {
    let mut q = c.prepare(sql).unwrap();
    let n = q.column_count();
    q.query_map([], |r| {
        (0..n).map(|i| r.get(i)).collect::<Result<Vec<Value>, _>>()
    })
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}
const ACCOUNT_COLUMNS: &str = "id,name,institution,side,kind,counted,opened_on,closed_on,notes,position,revision,created_at,updated_at,deleted_at";
const ENTRY_COLUMNS: &str = "snapshot_id,account_id,state,amount_cents,side,kind,counted";
fn facts(c: &Connection) -> Vec<Vec<Vec<Value>>> {
    vec![
        rows(
            c,
            &format!("SELECT {ACCOUNT_COLUMNS} FROM fin_accounts ORDER BY id"),
        ),
        rows(
            c,
            &format!("SELECT {ENTRY_COLUMNS} FROM fin_snapshot_entries ORDER BY 1,2"),
        ),
        rows(c, "SELECT * FROM fin_snapshots ORDER BY id"),
        rows(c, "SELECT * FROM savings_goal_accounts ORDER BY 1,2"),
        rows(c, "SELECT * FROM plan_income ORDER BY id"),
        rows(c, "SELECT * FROM cash_movements ORDER BY id"),
    ]
}
fn ddl(c: &Connection) -> String {
    c.query_row(
        "SELECT group_concat(sql,';') FROM (SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name)",
        [],
        |r| r.get(0),
    )
    .unwrap()
}
fn version(c: &Connection) -> i64 {
    c.query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap()
}
fn fk_mode(c: &Connection) -> bool {
    c.query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap()
}

/// A schema-42 library with accounts, snapshots and references into fin_accounts.
fn fixture(foreign_keys: bool) -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(SCHEMA).unwrap();
    migrate_to(&c, 42, &|_| Ok(())).unwrap();
    c.execute_batch("INSERT INTO fin_accounts(id,name,institution,side,kind,counted,opened_on,closed_on,notes,position,revision,created_at,updated_at,deleted_at) VALUES
 ('a','虚构储蓄','虚构平台','asset','cash',1,'2020-01-01',NULL,'原备注',3,7,'原建档','原修改',NULL),
 ('h','虚构房产','','asset','property',0,'2020-01-01',NULL,'',4,2,'建档','修改',NULL),
 ('g','虚构黄金','','asset','precious_metal',1,'2020-01-01','2026-05-01','',5,1,'建档','修改',NULL),
 ('l','虚构房贷','虚构银行','liability','loan',0,'2020-01-01',NULL,'',6,1,'建档','修改',NULL),
 ('deleted','虚构已删','','asset','cash',0,'2020-01-01',NULL,'已删备注',7,3,'建档','修改','已删');
INSERT INTO fin_snapshots VALUES('s','2026-01-01','原盘点',4,'建档','修改',NULL);
INSERT INTO fin_snapshots VALUES('s2','2026-02-01','',1,'建档','修改',NULL);
INSERT INTO fin_snapshot_entries(snapshot_id,account_id,state,amount_cents,side,kind,counted) VALUES
 ('s','a','entered',12345,'asset','cash',1),('s','h','entered',300000000,'asset','property',0),
 ('s','g','missing',NULL,'asset','precious_metal',1),('s','l','entered',5000000,'liability','loan',0),
 ('s2','a','unchanged',12345,'asset','cash',1),('s2','h','entered',310000000,'asset','property',0),
 ('s2','g','entered',88800,'asset','other_asset',1),('s2','l','entered',4900000,'liability','loan',0);
INSERT INTO savings_goals VALUES('goal','虚构目标',100000,NULL,'',0,1,'2026-01-01','建档','修改',NULL);
INSERT INTO savings_goal_accounts VALUES('goal','a');
INSERT INTO plan_income(id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at,category,source_account_id,destination,receiving_account_id) VALUES('i','2026-01-01',123,0,'原收入',5,'建档','修改','interest','a','transferred','a');
INSERT INTO cash_movements(id,revision,fact_revision,date,from_account_id,to_account_id,payload,created_at,updated_at) VALUES('m',3,2,'2026-01-01','a','g','原流动','建档','修改');").unwrap();
    c.execute_batch(if foreign_keys {
        "PRAGMA foreign_keys=ON"
    } else {
        "PRAGMA foreign_keys=OFF"
    })
    .unwrap();
    c
}

#[test]
fn schema43_preserves_every_fact_and_matches_a_fresh_library() {
    assert_eq!(SCHEMA_VERSION, 43);
    for fk in [false, true] {
        let c = fixture(fk);
        let before = facts(&c);
        migrate_to(&c, 43, &|_| Ok(())).unwrap();
        assert_eq!(version(&c), 43);
        assert_eq!(fk_mode(&c), fk);
        assert_eq!(facts(&c), before);
        let defaults: (i64, i64, i64) = c
            .query_row(
                "SELECT count(*), sum(currency='CNY' AND holding_mode=0), sum(purchase_cents IS NULL AND purchased_on IS NULL AND group_id IS NULL AND holding_unit IS NULL) FROM fin_accounts",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(defaults, (5, 5, 5));
        let layered: i64 = c
            .query_row(
                "SELECT count(*) FROM fin_snapshot_entries WHERE original_minor IS NOT NULL OR fx_rate_micro IS NOT NULL OR quantity_e8 IS NOT NULL OR unit_price_e6 IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(layered, 0);
        assert!(c
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none());
        for table in [
            "fin_snapshot_entries",
            "savings_goal_accounts",
            "plan_income",
            "cash_movements",
        ] {
            let targets: Vec<String> = rows(&c, &format!("PRAGMA foreign_key_list({table})"))
                .into_iter()
                .map(|r| match &r[2] {
                    Value::Text(t) => t.clone(),
                    _ => String::new(),
                })
                .collect();
            assert!(targets.iter().any(|t| t == "fin_accounts"), "{table}");
            assert!(!targets.iter().any(|t| t.starts_with("new_")), "{table}");
        }
        let fresh = Connection::open_in_memory().unwrap();
        fresh.execute_batch(SCHEMA).unwrap();
        migrate_to(&fresh, 43, &|_| Ok(())).unwrap();
        assert_eq!(ddl(&c), ddl(&fresh));
    }
}

#[test]
fn schema43_faults_leave_a_complete_schema42_library() {
    for fk in [false, true] {
        for point in [
            "migration.schema43.after_copy",
            "migration.schema43.after_swap",
            "migration.before_commit",
        ] {
            let c = fixture(fk);
            let before = facts(&c);
            let shape = ddl(&c);
            let error = migrate_to(&c, 43, &|p| {
                if p == point {
                    Err(Error::new("INJECTED", "虚构中断"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
            assert_eq!(error.code, "INJECTED", "{point}");
            assert!(c.is_autocommit());
            assert_eq!(version(&c), 42);
            assert_eq!(fk_mode(&c), fk);
            assert_eq!(facts(&c), before);
            assert_eq!(ddl(&c), shape);
            migrate_to(&c, 43, &|_| Ok(())).unwrap();
            assert_eq!(facts(&c), before);
        }
    }
    let c = fixture(true);
    c.execute_batch("BEGIN").unwrap();
    assert_eq!(
        migrate_to(&c, 43, &|_| Ok(())).unwrap_err().code,
        "DATABASE_FORMAT"
    );
    assert!(fk_mode(&c));
    c.execute_batch("ROLLBACK").unwrap();
}

#[test]
fn schema43_refuses_unknown_account_schema_without_touching_it() {
    for alteration in [
        "ALTER TABLE fin_accounts ADD COLUMN extension_value TEXT; UPDATE fin_accounts SET extension_value='虚构扩展';",
        "DROP INDEX fin_entries_account; CREATE INDEX fin_entries_account ON fin_snapshot_entries(snapshot_id);",
        "CREATE INDEX extra_account_index ON fin_accounts(name);",
        "CREATE TRIGGER unknown_account_trigger AFTER UPDATE ON fin_accounts BEGIN SELECT 1; END;",
        "CREATE VIEW unknown_account_view AS SELECT * FROM fin_snapshot_entries;",
        "CREATE TABLE fin_account_groups(id TEXT PRIMARY KEY);",
    ] {
        let c = fixture(true);
        c.execute_batch(alteration).unwrap();
        let before = ddl(&c);
        assert!(migrate_to(&c, 43, &|_| Ok(())).is_err(), "{alteration}");
        assert_eq!(version(&c), 42);
        assert!(fk_mode(&c));
        assert_eq!(ddl(&c), before);
    }
}

#[test]
fn schema43_older_libraries_reach_the_same_shape() {
    for from in [1, 40, 41] {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        migrate_to(&c, from, &|_| Ok(())).unwrap();
        migrate_to(&c, 43, &|_| Ok(())).unwrap();
        let fresh = Connection::open_in_memory().unwrap();
        fresh.execute_batch(SCHEMA).unwrap();
        migrate_to(&fresh, 43, &|_| Ok(())).unwrap();
        assert_eq!(ddl(&c), ddl(&fresh), "from {from}");
    }
}

#[test]
fn schema43_constraints_guard_the_new_columns() {
    let c = fixture(true);
    migrate_to(&c, 43, &|_| Ok(())).unwrap();
    let insert = |id: &str, kind: &str, extra: &str, values: &str| {
        c.execute_batch(&format!(
            "INSERT INTO fin_accounts({ACCOUNT_COLUMNS}{extra}) VALUES('{id}','虚构{id}','','asset','{kind}',0,'2020-01-01',NULL,'',20,1,'c','u',NULL{values})"
        ))
    };
    // Purchases belong only to property and vehicles.
    assert!(insert("p1", "cash", ",purchase_cents", ",100").is_err());
    assert!(insert("p2", "cash", ",purchased_on", ",'2020-01-01'").is_err());
    insert(
        "p3",
        "property",
        ",purchase_cents,purchased_on",
        ",100,'2020-01-01'",
    )
    .unwrap();
    insert("p4", "vehicle", ",purchase_cents", ",0").unwrap();
    assert!(insert("p5", "vehicle", ",purchase_cents", ",-1").is_err());
    // Holdings belong only to investment kinds; a unit needs holding mode.
    assert!(insert("h1", "cash", ",holding_mode", ",1").is_err());
    insert("h2", "fund", ",holding_mode,holding_unit", ",1,'份'").unwrap();
    assert!(insert("h3", "fund", ",holding_unit", ",'份'").is_err());
    assert!(insert(
        "h4",
        "fund",
        ",holding_mode,holding_unit",
        ",1,'超过八个字的单位名称'"
    )
    .is_err());
    // Currency codes are three upper-case letters.
    insert("c1", "cash", ",currency", ",'HKD'").unwrap();
    for bad in ["'cny'", "'US'", "'USDT'", "'U$D'"] {
        assert!(
            insert("c2", "cash", ",currency", &format!(",{bad}")).is_err(),
            "{bad}"
        );
    }
    // Groups must exist; names are unique and non-blank.
    assert!(insert("g1", "cash", ",group_id", ",'missing-group'").is_err());
    c.execute_batch("INSERT INTO fin_account_groups VALUES('grp','虚构应急金',0,1,'c','u')")
        .unwrap();
    insert("g2", "cash", ",group_id", ",'grp'").unwrap();
    assert!(c
        .execute_batch("INSERT INTO fin_account_groups VALUES('grp2','虚构应急金',1,1,'c','u')")
        .is_err());
    assert!(c
        .execute_batch("INSERT INTO fin_account_groups VALUES('grp3','  ',1,1,'c','u')")
        .is_err());
    // Vehicles may count; property still may not; receivables are assets only.
    insert("v1", "vehicle", "", "").unwrap();
    c.execute_batch("UPDATE fin_accounts SET counted=1 WHERE id='v1'")
        .unwrap();
    assert!(c
        .execute_batch("UPDATE fin_accounts SET counted=1 WHERE id='p3'")
        .is_err());
    insert("r1", "receivable", "", "").unwrap();
    assert!(c
        .execute_batch("UPDATE fin_accounts SET side='liability' WHERE id='r1'")
        .is_err());

    let entry = |account: &str, state: &str, amount: &str, extra: &str, values: &str| {
        c.execute_batch(&format!(
            "INSERT OR REPLACE INTO fin_snapshot_entries({ENTRY_COLUMNS}{extra}) VALUES('s2','{account}','{state}',{amount},'asset','cash',1{values})"
        ))
    };
    entry(
        "c1",
        "entered",
        "1000",
        ",original_minor,fx_rate_micro",
        ",1100,909000",
    )
    .unwrap();
    assert!(entry("c1", "entered", "1000", ",original_minor", ",1100").is_err());
    assert!(entry("c1", "entered", "1000", ",fx_rate_micro", ",909000").is_err());
    assert!(entry(
        "c1",
        "entered",
        "1000",
        ",original_minor,fx_rate_micro",
        ",1100,0"
    )
    .is_err());
    assert!(entry(
        "c1",
        "missing",
        "NULL",
        ",original_minor,fx_rate_micro",
        ",1100,909000"
    )
    .is_err());
    entry(
        "h2",
        "entered",
        "1000",
        ",quantity_e8,unit_price_e6",
        ",100000000,10000000",
    )
    .unwrap();
    assert!(entry("h2", "entered", "1000", ",quantity_e8", ",100000000").is_err());
    assert!(entry(
        "h2",
        "missing",
        "NULL",
        ",quantity_e8,unit_price_e6",
        ",1,1"
    )
    .is_err());
    assert!(entry(
        "h2",
        "entered",
        "1000",
        ",quantity_e8,unit_price_e6",
        ",-1,1"
    )
    .is_err());
}

fn account(s: &mut Store, name: &str, kind: &str, counted: bool) -> thingary_lib::wealth::Account {
    s.wealth_account_save(
        &AccountSave {
            request_id: uuid::Uuid::new_v4().to_string(),
            generation: s.generation(),
            id: None,
            expected_revision: None,
            fields: AccountFields {
                name: name.into(),
                institution: String::new(),
                side: "asset".into(),
                kind: kind.into(),
                counted,
                opened_on: "2026-01-01".into(),
                closed_on: None,
                notes: String::new(),
                purchase_cents: None,
                purchased_on: None,
                group_id: None,
                currency: "CNY".into(),
                holding_mode: false,
                holding_unit: None,
            },
        },
        "2026-10-17",
    )
    .unwrap()
}

#[test]
fn receivable_and_vehicle_accounts_save_count_back_up_and_restore() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("source");
    let mut s = Store::open(&root).unwrap();
    thingary_lib::modules::initialize_runtime(&root);
    let cash = account(&mut s, "虚构储蓄", "cash", true);
    let lent = account(&mut s, "虚构借给朋友", "receivable", true);
    let car = account(&mut s, "虚构车辆", "vehicle", false);
    let snapshot = s
        .wealth_snapshot_save(
            &SnapshotSave {
                request_id: uuid::Uuid::new_v4().to_string(),
                generation: s.generation(),
                id: None,
                expected_revision: None,
                date: "2026-10-01".into(),
                notes: String::new(),
                entries: [(&cash, "100000"), (&lent, "20000"), (&car, "15000000")]
                    .into_iter()
                    .map(|(a, v)| EntryInput {
                        account_id: a.id.clone(),
                        state: "entered".into(),
                        amount_cents: Some(v.into()),
                        original_minor: None,
                        fx_rate_micro: None,
                        quantity_e8: None,
                        unit_price_e6: None,
                    })
                    .collect(),
            },
            "2026-10-17",
        )
        .unwrap();
    assert!(snapshot.missing.is_empty());
    let summary = s.wealth_summary().unwrap();
    // The receivable counts; the vehicle is recorded but not counted by default.
    assert_eq!(summary.points[0].net_cents, "120000");
    let archive = tmp.path().join("虚构第43版.thingary");
    s.backup(Some(&archive)).unwrap();
    let mut restored = Store::open(&tmp.path().join("restored")).unwrap();
    let inspected = restored.inspect_backup(&archive).unwrap();
    restored
        .restore(&archive, &inspected.hash, &restored.generation())
        .unwrap();
    let kinds: Vec<String> = restored
        .wealth_accounts()
        .unwrap()
        .into_iter()
        .map(|a| a.fields.kind)
        .collect();
    assert!(kinds.contains(&"receivable".to_string()));
    assert!(kinds.contains(&"vehicle".to_string()));
    assert_eq!(
        restored.wealth_summary().unwrap().points[0].net_cents,
        "120000"
    );
}
