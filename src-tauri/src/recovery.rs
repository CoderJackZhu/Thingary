use crate::{
    backup::{archive_hash, freeze, unpack, validate_dataset},
    domain::{Error, Result},
    storage::{atomic_write, connection, migrate, sync_dir, uid, Active, Store},
};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
#[derive(Serialize, Deserialize)]
struct Journal {
    previous: Active,
    next: Active,
}
fn valid_active(a: &Active) -> Result<()> {
    for id in [&a.id, &a.generation] {
        uuid::Uuid::parse_str(id).map_err(|_| Error::new("RECOVERY", "恢复指针无效"))?;
    }
    Ok(())
}
pub(crate) fn recover_root(root: &Path) -> Result<()> {
    let journal_path = root.join("restore-journal.json");
    if !journal_path.exists() {
        return Ok(());
    }
    let journal: Journal = serde_json::from_slice(&fs::read(&journal_path)?)?;
    valid_active(&journal.previous)?;
    valid_active(&journal.next)?;
    let active = fs::read(root.join("active.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Active>(&b).ok());
    let selected = if active
        .as_ref()
        .is_some_and(|a| a.id == journal.next.id && a.generation == journal.next.generation)
        && validate_dataset(&root.join("datasets").join(&journal.next.id), true).is_ok()
    {
        journal.next
    } else {
        journal.previous
    };
    validate_dataset(&root.join("datasets").join(&selected.id), true)?;
    atomic_write(&root.join("active.json"), &serde_json::to_vec(&selected)?)?;
    fs::remove_file(journal_path)?;
    sync_dir(root)?;
    Ok(())
}
impl Store {
    pub fn restore(
        &mut self,
        archive: &Path,
        expected_hash: &str,
        generation: &str,
    ) -> Result<String> {
        if generation != self.generation() {
            return Err(Error::new("STALE_DATASET", "资料已变化，请重新检查"));
        }
        // Freeze the bytes checked by the caller, so path replacement during restore cannot change input.
        let frozen = freeze(archive, &self.root)?;
        if archive_hash(frozen.path())? != expected_hash {
            return Err(Error::new("BACKUP_CHANGED", "备份已经变化，请重新检查"));
        }
        let stage = tempfile::tempdir_in(self.root.join("datasets"))?;
        unpack(frozen.path(), stage.path())?;
        self.hit("restore.after_extract")?;
        let db = connection(&stage.path().join("data.sqlite"))?;
        migrate(&db, &*self.hook)?;
        db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        db.close().map_err(|(_, e)| e)?;
        validate_dataset(stage.path(), false)?;
        self.hit("restore.after_validate")?;
        fs::create_dir_all(self.root.join("protection"))?;
        self.hit("restore.before_protection")?;
        self.backup(Some(
            &self
                .root
                .join("protection")
                .join(format!("{}.thingary", uid())),
        ))?;
        self.hit("restore.after_protection")?;
        let next = Active {
            id: uid(),
            generation: uid(),
        };
        let final_dir = self.root.join("datasets").join(&next.id);
        if stage.path().join("files").exists() {
            sync_dir(&stage.path().join("files"))?;
        }
        sync_dir(stage.path())?;
        fs::rename(stage.path(), &final_dir)?;
        sync_dir(&self.root.join("datasets"))?;
        self.hit("restore.after_dataset")?;
        self.conn()?
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        if let Some(db) = self.db.take() {
            if let Err((db, e)) = db.close() {
                self.db = Some(db);
                return Err(e.into());
            }
        }
        self.hit("restore.after_close")?;
        let journal = Journal {
            previous: self.active.clone(),
            next: next.clone(),
        };
        atomic_write(
            &self.root.join("restore-journal.json"),
            &serde_json::to_vec(&journal)?,
        )?;
        self.hit("restore.after_journal")?;
        atomic_write(&self.root.join("active.json"), &serde_json::to_vec(&next)?)?;
        self.hit("restore.after_pointer")?;
        self.db = Some(connection(&final_dir.join("data.sqlite"))?);
        self.active = next;
        validate_dataset(&final_dir, false)?;
        self.hit("restore.after_open")?;
        fs::remove_file(self.root.join("restore-journal.json"))?;
        sync_dir(&self.root)?;
        Ok(self.generation())
    }
}

#[cfg(test)]
mod legacy_journal_tests {
    use super::*;
    #[test]
    fn old_schema_restore_journal_is_recovered_before_upgrade() {
        let root = tempfile::tempdir().unwrap();
        let previous = Active {
            id: uid(),
            generation: uid(),
        };
        let dir = root.path().join("datasets").join(&previous.id);
        fs::create_dir_all(&dir).unwrap();
        let db = rusqlite::Connection::open(dir.join("data.sqlite")).unwrap();
        db.execute_batch(crate::storage::SCHEMA).unwrap();
        crate::storage::migrate_to(&db, 32, &|_| Ok(())).unwrap();
        drop(db);
        fs::write(
            root.path().join("active.json"),
            serde_json::to_vec(&previous).unwrap(),
        )
        .unwrap();
        let journal = Journal {
            previous: previous.clone(),
            next: Active {
                id: uid(),
                generation: uid(),
            },
        };
        fs::write(
            root.path().join("restore-journal.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        let store = Store::open(root.path()).unwrap();
        assert_eq!(store.generation(), previous.generation);
        assert!(!root.path().join("restore-journal.json").exists());
        assert_eq!(
            store
                .conn()
                .unwrap()
                .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            crate::storage::SCHEMA_VERSION
        );
    }
}
