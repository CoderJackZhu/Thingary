//! Build genuine pre-41 account DDL for tests which derive old backups from a
//! current fictional database. Production migration files remain immutable.
pub fn restore_pre41_account_schema(c: &rusqlite::Connection) {
    let foreign_keys: bool = c
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    c.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
    let tx = c.unchecked_transaction().unwrap();
    let savings: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='savings_goals')", [], |r| r.get(0)).unwrap();
    if savings {
        let goals: i64 = tx
            .query_row("SELECT count(*) FROM savings_goals", [], |r| r.get(0))
            .unwrap();
        let links: i64 = tx
            .query_row("SELECT count(*) FROM savings_goal_accounts", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            (goals, links),
            (0, 0),
            "a legacy fixture must not discard new-version goal facts"
        );
        tx.execute_batch("DROP TABLE savings_goal_accounts; DROP TABLE savings_goals;")
            .unwrap();
    }
    tx.execute_batch(
        "CREATE TEMP TABLE old_account_rows AS SELECT * FROM fin_accounts;
CREATE TEMP TABLE old_entry_rows AS SELECT * FROM fin_snapshot_entries;
DROP TABLE fin_snapshot_entries; DROP TABLE fin_accounts;",
    )
    .unwrap();
    for statement in include_str!("../../src/x01.sql").lines().filter(|s| {
        s.starts_with("CREATE TABLE fin_accounts(")
            || s.starts_with("CREATE TABLE fin_snapshot_entries(")
            || s.starts_with("CREATE INDEX fin_entries_account ")
    }) {
        tx.execute_batch(statement).unwrap();
    }
    tx.execute_batch(
        "INSERT INTO fin_accounts SELECT * FROM old_account_rows;
INSERT INTO fin_snapshot_entries SELECT * FROM old_entry_rows;
DROP TABLE old_account_rows; DROP TABLE old_entry_rows;",
    )
    .unwrap();
    tx.commit().unwrap();
    c.execute_batch(if foreign_keys {
        "PRAGMA foreign_keys=ON"
    } else {
        "PRAGMA foreign_keys=OFF"
    })
    .unwrap();
}
