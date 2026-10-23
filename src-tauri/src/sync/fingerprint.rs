use std::{collections::BTreeMap, fs::File, io::Read, path::Path};

use rusqlite::{types::ValueRef, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    domain::{Error, Result},
    storage::Store,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Fingerprint {
    pub digest: String,
    pub schema_version: u32,
    pub table_counts: BTreeMap<String, u64>,
    pub managed_files: u64,
    pub empty: bool,
}

pub fn fingerprint(store: &Store) -> Result<Fingerprint> {
    let connection = store.conn()?;
    let schema_version = connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
        .map_err(db_error)?;
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    let mut digest = Sha256::new();
    digest.update(b"thingary-content-fingerprint-v1\0");
    frame(&mut digest, &schema_version.to_be_bytes());

    let table_names = table_names(&transaction)?;
    let mut table_counts = BTreeMap::new();
    for table in table_names {
        let (count, columns, rows) = canonical_table(&transaction, &table)?;
        table_counts.insert(table.clone(), count);
        frame(&mut digest, table.as_bytes());
        for column in columns {
            frame(&mut digest, column.as_bytes());
        }
        for row in rows {
            frame(&mut digest, &row);
        }
    }
    transaction.rollback().map_err(db_error)?;

    let managed = referenced_files(connection)?;
    let files_dir = store.dataset().join("files");
    for name in &managed {
        frame(&mut digest, name.as_bytes());
        hash_file(&mut digest, &files_dir, name)?;
    }
    let empty = !has_personal_records(connection)?;
    Ok(Fingerprint {
        digest: format!("{:x}", digest.finalize()),
        schema_version,
        table_counts,
        managed_files: managed.len() as u64,
        empty,
    })
}

fn table_names(connection: &Connection) -> Result<Vec<String>> {
    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .map_err(db_error)?;
    let names = statement
        .query_map([], |row| row.get(0))
        .map_err(db_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(db_error)?;
    Ok(names)
}

fn canonical_table(
    connection: &Connection,
    table: &str,
) -> Result<(u64, Vec<String>, Vec<Vec<u8>>)> {
    let quoted = quote_identifier(table);
    let mut info = connection
        .prepare(&format!("PRAGMA table_info({quoted})"))
        .map_err(db_error)?;
    let columns = info
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(db_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(db_error)?;
    let names = columns.iter().map(|(_, name, _)| name.clone()).collect();
    let mut primary = columns
        .iter()
        .filter(|(_, _, order)| *order > 0)
        .map(|(column, _, order)| (*order, *column as usize))
        .collect::<Vec<_>>();
    primary.sort_by_key(|(order, _)| *order);

    let mut statement = connection
        .prepare(&format!("SELECT * FROM {quoted}"))
        .map_err(db_error)?;
    let width = statement.column_count();
    let rows = statement
        .query_map([], |row| {
            let mut encoded = Vec::new();
            for index in 0..width {
                encode_value(&mut encoded, row.get_ref(index)?);
            }
            let mut key = Vec::new();
            if primary.is_empty() {
                key.extend_from_slice(&encoded);
            } else {
                for (_, index) in &primary {
                    encode_value(&mut key, row.get_ref(*index)?);
                }
            }
            Ok((key, encoded))
        })
        .map_err(db_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(db_error)?;
    let mut rows = rows;
    rows.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let count = rows.len() as u64;
    Ok((count, names, rows.into_iter().map(|(_, row)| row).collect()))
}

fn encode_value(target: &mut Vec<u8>, value: ValueRef<'_>) {
    match value {
        ValueRef::Null => target.push(0),
        ValueRef::Integer(value) => {
            target.push(1);
            target.extend_from_slice(&value.to_be_bytes());
        }
        ValueRef::Real(value) => {
            target.push(2);
            target.extend_from_slice(&value.to_bits().to_be_bytes());
        }
        ValueRef::Text(value) => {
            target.push(3);
            append_bytes(target, value);
        }
        ValueRef::Blob(value) => {
            target.push(4);
            append_bytes(target, value);
        }
    }
}

fn referenced_files(connection: &Connection) -> Result<Vec<String>> {
    // This is deliberately the same managed-file set copied by the complete
    // backup pipeline. A sync fingerprint must never observe a broader or
    // narrower attachment universe than the snapshot it represents.
    let sql = "SELECT DISTINCT file FROM attachments \
        UNION SELECT hash FROM materials \
        UNION SELECT file FROM wishlist_attachments \
        ORDER BY file";
    let mut statement = connection.prepare(sql).map_err(db_error)?;
    let names = statement
        .query_map([], |row| row.get(0))
        .map_err(db_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(db_error)?;
    Ok(names)
}

fn hash_file(digest: &mut Sha256, directory: &Path, name: &str) -> Result<()> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(Error::new("SYNC_FINGERPRINT", "资料库附件路径无效"));
    }
    let path = directory.join(name);
    let metadata = path
        .symlink_metadata()
        .map_err(|_| Error::new("SYNC_FINGERPRINT", "无法读取资料库附件"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(Error::new("SYNC_FINGERPRINT", "资料库附件类型无效"));
    }
    frame(digest, &metadata.len().to_be_bytes());
    let mut file =
        File::open(path).map_err(|_| Error::new("SYNC_FINGERPRINT", "无法读取资料库附件"))?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| Error::new("SYNC_FINGERPRINT", "无法读取资料库附件"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(())
}

fn has_personal_records(connection: &Connection) -> Result<bool> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM assets)\
                OR EXISTS(SELECT 1 FROM wishlist_items)\
                OR EXISTS(SELECT 1 FROM fin_accounts)\
                OR EXISTS(SELECT 1 FROM fin_snapshots)\
                OR EXISTS(SELECT 1 FROM expenses)\
                OR EXISTS(SELECT 1 FROM recurring_plans)\
                OR EXISTS(SELECT 1 FROM plan_payments)\
                OR EXISTS(SELECT 1 FROM virtual_assets)\
                OR EXISTS(SELECT 1 FROM plan_profile)\
                OR EXISTS(SELECT 1 FROM plan_income)\
                OR EXISTS(SELECT 1 FROM cash_movements)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(db_error)
}

fn append_bytes(target: &mut Vec<u8>, bytes: &[u8]) {
    target.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
    target.extend_from_slice(bytes);
}

fn frame(digest: &mut Sha256, bytes: &[u8]) {
    digest.update((bytes.len() as u64).to_be_bytes());
    digest.update(bytes);
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn db_error(_: rusqlite::Error) -> Error {
    Error::new("SYNC_FINGERPRINT", "无法计算资料库内容指纹")
}
