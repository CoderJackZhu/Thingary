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
pub struct Store {
    pub(crate) root: PathBuf,
    pub(crate) active: Active,
    pub(crate) db: Option<Connection>,
    _lock: File,
    pub(crate) hook: Box<dyn Fn(&str) -> Result<()> + Send>,
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
    if v != 1 || app != 1347375955 || integrity != "ok" {
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
            .query_row("SELECT id FROM assets ORDER BY id LIMIT 1", [], |r| {
                r.get(0)
            })
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
        if input.generation != self.active.generation {
            return Err(Error::new("STALE_DATASET", "资料已恢复，请重新打开档案"));
        }
        input.validate(today)?;
        let fingerprint = digest(&serde_json::to_vec(input)?);
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
        let price = crate::domain::cents(input.price_cents.as_deref())?;
        let id = input.asset_id.clone().unwrap_or_else(uid);
        let revision = match input.expected_revision {
            Some(n) => n
                .checked_add(1)
                .ok_or_else(|| Error::new("REVISION", "版本超出范围"))?,
            None => 1,
        };
        if let Some(expected) = input.expected_revision {
            let n=tx.execute("UPDATE assets SET name=?1,price_cents=?2,purchase_date=?3,revision=?4 WHERE id=?5 AND revision=?6",params![input.name.trim(),price,input.purchase_date,revision,id,expected])?;
            if n != 1 {
                return Err(Error::new(
                    "REVISION_CONFLICT",
                    "资料已更改或不存在，请重新读取",
                ));
            }
        } else {
            tx.execute(
                "INSERT INTO assets VALUES(?1,?2,?3,?4,1)",
                params![id, input.name.trim(), price, input.purchase_date],
            )?;
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
