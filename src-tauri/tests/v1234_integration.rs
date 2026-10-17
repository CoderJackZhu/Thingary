//! Four-feature integration uses exclusively temporary fictional libraries.
#[allow(dead_code)]
#[path = "../examples/v1234_acceptance_fixture.rs"]
mod fixture;
use std::{fs::File, io::Read};
use thingary_lib::{backup_security, modules, worker::Worker};

fn runtime() -> modules::RuntimeModules {
    modules::RuntimeModules {
        modules: modules::Modules::default(),
        incomes: true,
        movements: true,
        finance_status: modules::FinanceStatus::Ready,
        finance_revision: 1,
    }
}

#[test]
fn schema42_goals_and_annual_facts_survive_standard_age_decryption_and_session_restore() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("library");
    let worker = Worker::start(root.clone()).unwrap();
    worker.switch_demo(false).unwrap();
    worker
        .call_personal(|s| fixture::seed(s, "2026-10-15"))
        .unwrap();
    let before = worker
        .call_personal(|s| {
            let summary = s.wealth_summary()?;
            let current = summary
                .points
                .iter()
                .find(|p| p.date == "2026-10-15")
                .unwrap();
            assert!(current.complete);
            assert_eq!(current.assets_cents, "17000000");
            assert_eq!(current.net_cents, "-43000000");
            let read =
                s.savings_goals_read(&s.generation(), Some(2026), "2026-10-15", &runtime())?;
            assert_eq!(read.goals.len(), 2);
            assert!(read.goals.iter().all(|g| g.goal.created_on == "2026-10-15"
                && g.history
                    .iter()
                    .all(|p| p.basis.date.as_str() >= "2026-10-15")));
            Ok(serde_json::to_value(read.goals).unwrap())
        })
        .unwrap();
    assert_eq!(
        worker.backup_security_status().unwrap().state,
        backup_security::STATE_DISABLED
    );
    let key = worker.backup_security_begin_setup().unwrap();
    worker
        .backup_security_confirm_setup(key.session_id, key.recovery_key.clone())
        .unwrap();
    let encrypted = temp.path().join("fictional.thingary.age");
    worker.create_backup_file(encrypted.clone(), false).unwrap();
    assert!(!std::fs::read(&encrypted).unwrap().starts_with(b"PK"));

    // Independently exercise age's public standard decoder, not the app wrapper.
    let identity: age::x25519::Identity = key.recovery_key.parse().unwrap();
    let decryptor = age::Decryptor::new(File::open(&encrypted).unwrap()).unwrap();
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .unwrap();
    let mut plaintext = Vec::new();
    reader.read_to_end(&mut plaintext).unwrap();
    assert!(plaintext.starts_with(b"PK"));
    let plain = temp.path().join("decoded.thingary");
    std::fs::write(&plain, plaintext).unwrap();
    worker
        .call_personal({
            let plain = plain.clone();
            move |s| {
                assert_eq!(
                    s.inspect_backup(&plain)?.schema,
                    thingary_lib::storage::SCHEMA_VERSION as u32
                );
                Ok(())
            }
        })
        .unwrap();

    let session = worker.backup_inspect_begin(encrypted).unwrap();
    assert!(session.encrypted);
    let changes = worker
        .call_personal(|s| Ok(s.conn_for_test()?.total_changes()))
        .unwrap();
    assert_eq!(
        worker.backup_session_result(session.token.clone()).unwrap(),
        None
    );
    assert_eq!(
        worker
            .call_personal(|s| Ok(s.conn_for_test()?.total_changes()))
            .unwrap(),
        changes,
        "receipt lookup is read-only"
    );
    let unlocked = worker
        .backup_session_unlock(session.token.clone(), key.recovery_key)
        .unwrap();
    assert_eq!(
        unlocked.summary.schema,
        thingary_lib::storage::SCHEMA_VERSION as u32
    );
    assert_eq!(unlocked.summary.savings_goals, 2);
    let generation = worker
        .backup_session_restore(session.token.clone())
        .unwrap();
    assert_eq!(
        worker.backup_session_result(session.token.clone()).unwrap(),
        Some(generation.clone())
    );
    assert_eq!(
        worker.backup_session_restore(session.token).unwrap(),
        generation,
        "duplicate confirm returns the recorded outcome"
    );
    worker
        .call_personal(move |s| {
            assert_eq!(
                s.conn_for_test()?
                    .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
                thingary_lib::storage::SCHEMA_VERSION
            );
            assert_eq!(s.wealth_accounts()?.len(), 6);
            let current = s
                .wealth_summary()?
                .points
                .into_iter()
                .find(|p| p.date == "2026-10-15")
                .unwrap();
            assert_eq!(current.assets_cents, "17000000");
            assert_eq!(current.net_cents, "-43000000");
            let restored =
                s.savings_goals_read(&s.generation(), Some(2026), "2026-10-15", &runtime())?;
            assert_eq!(serde_json::to_value(restored.goals).unwrap(), before);
            assert_eq!(
                s.conn_for_test()?.query_row(
                    "SELECT count(*) FROM savings_goal_accounts",
                    [],
                    |r| r.get::<_, i64>(0)
                )?,
                3
            );
            let annual = s.finance_sources_with_view(
                &thingary_lib::expenses::Period::Year { year: 2026 },
                &runtime(),
                "2026-10-15",
                true,
            )?;
            let projection = annual.annual.unwrap();
            let thingary_lib::finance_sources::Read::Ready {
                value: Some(comparison),
            } = projection.comparison
            else {
                panic!("annual comparison must survive the restore")
            };
            assert_eq!(comparison.from.date, "2025-12-31");
            assert_eq!(comparison.to.date, "2026-10-15");
            assert_eq!(comparison.net_change_cents.as_deref(), Some("1000000"));
            let thingary_lib::finance_sources::Read::Ready { value: incomes } = annual.incomes
            else {
                panic!("recorded income must remain readable")
            };
            assert_eq!(incomes.len(), 1);
            let thingary_lib::finance_sources::Read::Ready { value: savings } = projection.savings
            else {
                panic!("annual goals must remain readable")
            };
            assert_eq!(savings.goals.len(), 2);
            Ok(())
        })
        .unwrap();

    // A different restore invalidates a pending receipt; it must not become a
    // false "not submitted" answer which would unlock an automatic replay.
    let pending = worker.backup_inspect_begin(plain.clone()).unwrap();
    assert_eq!(
        worker.backup_session_result(pending.token.clone()).unwrap(),
        None
    );
    let hash = pending.summary.unwrap().hash;
    worker
        .call_personal(move |s| {
            let generation = s.generation();
            s.restore(&plain, &hash, &generation).map(|_| ())
        })
        .unwrap();
    assert_eq!(
        worker
            .backup_session_result(pending.token)
            .unwrap_err()
            .code,
        "RESTORE_UNKNOWN"
    );
    assert_eq!(
        worker
            .backup_session_result("missing-token".into())
            .unwrap_err()
            .code,
        "SESSION"
    );
}
