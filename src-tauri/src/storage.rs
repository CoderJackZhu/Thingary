use crate::domain::{Asset, Error, Result, Save};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

pub(crate) const SCHEMA: &str = "CREATE TABLE assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,price_cents INTEGER,purchase_date TEXT,revision INTEGER NOT NULL CHECK(revision>0));
CREATE TABLE requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL);
PRAGMA user_version=1; PRAGMA application_id=1347375955;";
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Active {
    pub id: String,
    pub generation: String,
}
type FaultHook = Box<dyn Fn(&str) -> Result<()> + Send>;
pub struct Store {
    pub(crate) root: PathBuf,
    pub(crate) active: Active,
    pub(crate) db: Option<Connection>,
    _lock: File,
    pub(crate) hook: FaultHook,
}
pub(crate) fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub(crate) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(crate) fn sync_dir(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::new("PATH", "无效目录"))?;
    let mut f = tempfile::NamedTempFile::new_in(parent)?;
    f.write_all(bytes)?;
    f.as_file().sync_all()?;
    f.persist(path).map_err(|e| e.error)?;
    sync_dir(parent)
}
pub(crate) fn connection(path: &Path) -> Result<Connection> {
    let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    c.busy_timeout(Duration::from_secs(3))?;
    c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")?;
    Ok(c)
}
pub(crate) fn check_db(c: &Connection) -> Result<()> {
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let app: i64 = c.query_row("PRAGMA application_id", [], |r| r.get(0))?;
    let integrity: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if v != 7 || app != 1347375955 || integrity != "ok" {
        return Err(Error::new("DATABASE_FORMAT", "数据库不兼容或损坏"));
    }
    Ok(())
}
impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("lock"))?;
        fs2::FileExt::try_lock_exclusive(&lock)
            .map_err(|_| Error::new("LOCKED", "验证资料已由另一个进程打开"))?;
        crate::recovery::recover_root(root)?;
        let active_path = root.join("active.json");
        let active = if active_path.exists() {
            let a: Active = serde_json::from_slice(&fs::read(&active_path)?)?;
            uuid::Uuid::parse_str(&a.id)
                .map_err(|_| Error::new("RECOVERY", "数据集指针损坏，不能自动创建空库"))?;
            a
        } else {
            let datasets = root.join("datasets");
            if datasets.exists() && fs::read_dir(&datasets)?.next().is_some() {
                return Err(Error::new("RECOVERY", "发现已有数据但缺少指针，请恢复资料"));
            }
            let a = Active {
                id: uid(),
                generation: uid(),
            };
            let dir = datasets.join(&a.id);
            fs::create_dir_all(&dir)?;
            let db = Connection::open(dir.join("data.sqlite"))?;
            db.execute_batch(SCHEMA)?;
            drop(db);
            File::open(dir.join("data.sqlite"))?.sync_all()?;
            sync_dir(&dir)?;
            sync_dir(&datasets)?;
            atomic_write(&active_path, &serde_json::to_vec(&a)?)?;
            a
        };
        let db = connection(&root.join("datasets").join(&active.id).join("data.sqlite"))?;
        migrate(&db, &|_| Ok(()))?;
        check_db(&db)?;
        Ok(Self {
            root: root.to_owned(),
            active,
            db: Some(db),
            _lock: lock,
            hook: Box::new(|_| Ok(())),
        })
    }
    pub fn generation(&self) -> String {
        self.active.generation.clone()
    }
    pub fn sqlite_version(&self) -> Result<String> {
        Ok(self
            .conn()?
            .query_row("SELECT sqlite_version()", [], |r| r.get(0))?)
    }
    pub(crate) fn conn(&self) -> Result<&Connection> {
        self.db
            .as_ref()
            .ok_or_else(|| Error::new("RECOVERY", "数据切换未完成，请重启验证应用"))
    }
    pub(crate) fn dataset(&self) -> PathBuf {
        self.root.join("datasets").join(&self.active.id)
    }
    pub(crate) fn hit(&self, p: &str) -> Result<()> {
        (self.hook)(p)
    }
    #[cfg(any(test, feature = "fault-injection"))]
    pub fn set_hook(&mut self, hook: impl Fn(&str) -> Result<()> + Send + 'static) {
        self.hook = Box::new(hook);
    }
    pub fn asset(&self, id: &str) -> Result<Option<Asset>> {
        Ok(self
            .conn()?
            .query_row(
                "SELECT id,name,price_cents,purchase_date,revision FROM assets WHERE id=?1",
                [id],
                |r| {
                    Ok(Asset {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        price_cents: r.get::<_, Option<i64>>(2)?.map(|n| n.to_string()),
                        purchase_date: r.get(3)?,
                        revision: r.get(4)?,
                    })
                },
            )
            .optional()?)
    }
    pub fn first_asset(&self) -> Result<Option<Asset>> {
        let id: Option<String> = self
            .conn()?
            .query_row(
                "SELECT id FROM assets WHERE deleted_at IS NULL ORDER BY id LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        id.map(|id| self.asset(&id))
            .transpose()
            .map(Option::flatten)
    }
    pub fn count(&self) -> Result<i64> {
        Ok(self
            .conn()?
            .query_row("SELECT count(*) FROM assets", [], |r| r.get(0))?)
    }
    pub fn save(&mut self, input: &Save, today: &str) -> Result<Asset> {
        self.save_record(input, today, None, None, None)
    }
    pub(crate) fn save_record(
        &mut self,
        input: &Save,
        today: &str,
        details: Option<&crate::catalog::Details>,
        photos: Option<&crate::photos::Selection>,
        classification: Option<&crate::taxonomy::Classification>,
    ) -> Result<Asset> {
        if input.generation != self.active.generation {
            return Err(Error::new("STALE_DATASET", "资料已恢复，请重新打开档案"));
        }
        input.validate(today)?;
        let fingerprint = digest(&if let Some(classification) = classification {
            if let Some(d) = details {
                d.validate()?;
            }
            serde_json::to_vec(&(input, details, photos, classification))?
        } else if let Some(photos) = photos {
            if let Some(d) = details {
                d.validate()?;
            }
            serde_json::to_vec(&(input, details, photos))?
        } else {
            match details {
                Some(details) => {
                    details.validate()?;
                    serde_json::to_vec(&(input, details))?
                }
                None => serde_json::to_vec(input)?,
            }
        });
        let tx = self.conn()?.unchecked_transaction()?;
        let previous: Option<(String, String)> = tx
            .query_row(
                "SELECT fingerprint,result FROM requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((prior, result)) = previous {
            if prior != fingerprint {
                return Err(Error::new("REQUEST_CONFLICT", "此请求标识已用于不同内容"));
            }
            return Ok(serde_json::from_str(&result)?);
        }
        if let Some(value) = classification {
            crate::taxonomy::validate_classification(&tx, value)?;
        }
        let price = crate::domain::cents(input.price_cents.as_deref())?;
        let id = input.asset_id.clone().unwrap_or_else(uid);
        let revision = match input.expected_revision {
            Some(n) => n
                .checked_add(1)
                .ok_or_else(|| Error::new("REVISION", "版本超出范围"))?,
            None => 1,
        };
        if let Some(expected) = input.expected_revision {
            crate::lifecycle::validate_purchase_date(&tx, &id, input.purchase_date.as_deref())?;
            crate::sales::validate_purchase_date(&tx, &id, input.purchase_date.as_deref())?;
            let n=tx.execute("UPDATE assets SET name=?1,price_cents=?2,purchase_date=?3,revision=?4 WHERE id=?5 AND revision=?6 AND deleted_at IS NULL",params![input.name.trim(),price,input.purchase_date,revision,id,expected])?;
            if n != 1 {
                return Err(Error::new(
                    "REVISION_CONFLICT",
                    "资料已更改或不存在，请重新读取",
                ));
            }
        } else {
            tx.execute(
                "INSERT INTO assets(id,name,price_cents,purchase_date,revision) VALUES(?1,?2,?3,?4,1)",
                params![id, input.name.trim(), price, input.purchase_date],
            )?;
        }
        if let Some(value) = classification {
            tx.execute(
                "UPDATE assets SET category_id=?1,channel_id=?2 WHERE id=?3",
                params![value.category_id, value.channel_id, id],
            )?;
        }
        if let Some(d) = details {
            let now = chrono::Utc::now().to_rfc3339();
            tx.execute("INSERT INTO asset_profiles(asset_id,brand,model,serial_number,notes,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(asset_id) DO UPDATE SET brand=excluded.brand,model=excluded.model,serial_number=excluded.serial_number,notes=excluded.notes,updated_at=excluded.updated_at",params![id,d.brand.trim(),d.model.trim(),d.serial_number.trim(),d.notes,now])?;
        }
        if let Some(selection) = photos {
            self.commit_photos(&tx, &id, selection)?;
        }
        let result = Asset {
            id,
            name: input.name.trim().to_owned(),
            price_cents: price.map(|n| n.to_string()),
            purchase_date: input.purchase_date.clone(),
            revision,
        };
        tx.execute(
            "INSERT INTO requests VALUES(?1,?2,?3)",
            params![
                input.request_id,
                fingerprint,
                serde_json::to_string(&result)?
            ],
        )?;
        self.hit("save.before_commit")?;
        tx.commit()?;
        self.hit("save.after_commit")?;
        Ok(result)
    }
}

pub(crate) fn migrate(c: &Connection, hook: &dyn Fn(&str) -> Result<()>) -> Result<()> {
    migrate_to(c, 7, hook)
}
pub(crate) fn migrate_to(
    c: &Connection,
    target: i64,
    hook: &dyn Fn(&str) -> Result<()>,
) -> Result<()> {
    let mut v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if !(1..=7).contains(&v) || v > target {
        return Err(Error::new("SCHEMA_VERSION", "数据库版本不受支持"));
    }
    if v == 1 && target >= 2 {
        let tx = c.unchecked_transaction()?;
        tx.execute_batch("ALTER TABLE assets ADD COLUMN deleted_at TEXT;
CREATE TABLE attachments(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),file TEXT NOT NULL,hash TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>0));
PRAGMA user_version=2;")?;
        hook("migration.before_commit")?;
        tx.commit()?;
        v = 2;
    }
    if v == 2 && target >= 3 {
        let tx = c.unchecked_transaction()?;
        tx.execute_batch("CREATE TABLE asset_profiles(asset_id TEXT PRIMARY KEY REFERENCES assets(id),brand TEXT NOT NULL,model TEXT NOT NULL,serial_number TEXT NOT NULL,notes TEXT NOT NULL,created_at TEXT,updated_at TEXT);
INSERT INTO asset_profiles SELECT id,'','','','',NULL,NULL FROM assets;
PRAGMA user_version=3;")?;
        hook("migration.before_commit")?;
        tx.commit()?;
        v = 3;
    }
    if v == 3 && target >= 4 {
        let tx = c.unchecked_transaction()?;
        tx.execute_batch("CREATE TABLE asset_photos(asset_id TEXT NOT NULL REFERENCES assets(id),attachment_id TEXT PRIMARY KEY REFERENCES attachments(id),position INTEGER NOT NULL CHECK(position>=0),name TEXT NOT NULL);
CREATE TABLE asset_media(asset_id TEXT PRIMARY KEY REFERENCES assets(id),cover_id TEXT REFERENCES attachments(id));
INSERT INTO asset_photos SELECT asset_id,id,row_number() OVER(PARTITION BY asset_id ORDER BY id)-1,'图片' FROM attachments;
INSERT INTO asset_media SELECT asset_id,min(id) FROM attachments GROUP BY asset_id;
PRAGMA user_version=4;")?;
        hook("migration.before_commit")?;
        tx.commit()?;
        v = 4;
    }
    if v == 4 && target >= 5 {
        let tx = c.unchecked_transaction()?;
        tx.execute_batch("CREATE TABLE categories(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,icon TEXT NOT NULL CHECK(icon IN ('box','computer','phone','camera','audio','home')),position INTEGER NOT NULL CHECK(position>=0));
CREATE TABLE channels(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,position INTEGER NOT NULL CHECK(position>=0));
ALTER TABLE assets ADD COLUMN category_id TEXT REFERENCES categories(id);
ALTER TABLE assets ADD COLUMN channel_id TEXT REFERENCES channels(id);
CREATE INDEX assets_category ON assets(category_id);
CREATE INDEX assets_channel ON assets(channel_id);
CREATE TABLE taxonomy_state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO taxonomy_state VALUES(1,0);
CREATE TABLE taxonomy_requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);
CREATE TRIGGER asset_taxonomy_insert AFTER INSERT ON assets BEGIN UPDATE taxonomy_state SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER asset_taxonomy_update AFTER UPDATE OF category_id,channel_id,deleted_at ON assets WHEN OLD.category_id IS NOT NEW.category_id OR OLD.channel_id IS NOT NEW.channel_id OR OLD.deleted_at IS NOT NEW.deleted_at BEGIN UPDATE taxonomy_state SET revision=revision+1 WHERE id=1; END;
PRAGMA user_version=5;")?;
        for (position, (name, icon)) in [
            ("电脑", "computer"),
            ("手机", "phone"),
            ("摄影", "camera"),
            ("音频", "audio"),
            ("家电", "home"),
            ("其他", "box"),
        ]
        .iter()
        .enumerate()
        {
            tx.execute(
                "INSERT INTO categories VALUES(?1,?2,?2,?3,?4)",
                params![uid(), name, icon, position as i64],
            )?;
        }
        for (position, name) in [
            "Apple Store",
            "京东",
            "淘宝",
            "Amazon",
            "线下",
            "二手",
            "其他",
        ]
        .iter()
        .enumerate()
        {
            tx.execute(
                "INSERT INTO channels VALUES(?1,?2,?3,?4)",
                params![uid(), name, name.to_ascii_lowercase(), position as i64],
            )?;
        }
        hook("migration.before_commit")?;
        tx.commit()?;
        v = 5;
    }
    if v == 5 && target >= 6 {
        let tx = c.unchecked_transaction()?;
        tx.execute_batch("ALTER TABLE assets ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_state IN ('active','retired','sold'));
CREATE TABLE lifecycle_events(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),sequence INTEGER NOT NULL CHECK(sequence>0),kind TEXT NOT NULL CHECK(kind IN ('retire','activate')),date TEXT NOT NULL,notes TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(asset_id,sequence));
PRAGMA user_version=6;")?;
        hook("migration.before_commit")?;
        tx.commit()?;
        v = 6;
    }
    if v == 6 && target >= 7 {
        let tx = c.unchecked_transaction()?;
        tx.execute_batch("CREATE TABLE sales(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),previous_state TEXT NOT NULL CHECK(previous_state IN ('active','retired')),date TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 99999999999),platform TEXT NOT NULL,buyer TEXT NOT NULL,notes TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,revoked_at TEXT);
CREATE UNIQUE INDEX one_effective_sale ON sales(asset_id) WHERE revoked_at IS NULL;
CREATE TABLE sale_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE,sale_id TEXT NOT NULL REFERENCES sales(id),action TEXT NOT NULL CHECK(action IN ('sell','correct','revoke')),snapshot TEXT NOT NULL,created_at TEXT NOT NULL);
PRAGMA user_version=7;")?;
        hook("migration.before_commit")?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod taxonomy_migration_tests {
    use super::*;
    #[test]
    fn version_four_upgrade_rolls_back_and_preserves_assets() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(SCHEMA).unwrap();
        migrate_to(&c, 4, &|_| Ok(())).unwrap();
        c.execute(
            "INSERT INTO assets VALUES('legacy','旧资料',NULL,NULL,1,'2026-09-24')",
            [],
        )
        .unwrap();
        assert!(migrate(&c, &|_| Err(Error::new("INJECTED", "中断"))).is_err());
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert!(c.prepare("SELECT category_id FROM assets").is_err());
        migrate(&c, &|_| Ok(())).unwrap();
        let r: (String, i64, Option<String>, Option<String>) = c
            .query_row(
                "SELECT name,revision,category_id,channel_id FROM assets",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(r, ("旧资料".into(), 1, None, None));
        let first: String = c
            .query_row(
                "SELECT id FROM categories ORDER BY position LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        migrate(&c, &|_| Ok(())).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT id FROM categories ORDER BY position LIMIT 1",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            first
        );
    }
}
