//! Accounts and complete check-ins only. Preview writes to a private in-memory
//! SQLite copy; the personal dataset is read-only until the atomic commit.
use crate::{
    domain::{Error, Result},
    financial_import_parser::{
        self as parser, ExistingAccountV1, GroupValidationV1, ImportContext, ImportRequestV1,
        SeverityV1, StandardRowV1,
    },
    storage::{digest, Store},
    wealth::{
        self, Account, AccountFields, AccountSave, EntryInput, HistoricalOverrides, SnapshotSave,
    },
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const PAGE_SIZE: usize = 50;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInput {
    pub kind: String,
    pub name: String,
    pub csv_text: String,
    #[serde(default)]
    pub column_mapping: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mapping {
    pub id: String,
    pub expected_revision: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub action: String,
    pub expected_revision: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchInput {
    pub generation: String,
    pub source_name: String,
    pub mapping_set_id: String,
    pub files: Vec<FileInput>,
    #[serde(default)]
    pub mappings: BTreeMap<String, Mapping>,
    #[serde(default)]
    pub actions: BTreeMap<String, Action>,
    #[serde(default)]
    pub page: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInput {
    pub request_id: String,
    pub batch: BatchInput,
    pub context_digest: String,
    pub normalized_digest: String,
    pub file_fingerprints: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    pub file: String,
    pub code: String,
    pub severity: String,
    pub source_row: Option<u32>,
    pub column: Option<String>,
    pub object_key: Option<String>,
    pub message: String,
    pub blocking: bool,
}
#[derive(Debug, Clone, Serialize)]
pub struct Object {
    pub key: String,
    pub kind: String,
    pub external_key: String,
    pub id: String,
    pub source_rows: Vec<u32>,
    pub status: String,
    pub action: String,
    pub expected_revision: Option<i64>,
    pub before: Option<Value>,
    pub after: Value,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Counts {
    pub new_accounts: usize,
    pub new_snapshots: usize,
    pub same: usize,
    pub conflicts: usize,
    pub errors: usize,
    pub created_accounts: usize,
    pub created_snapshots: usize,
    pub corrected: usize,
    pub skipped: usize,
}
#[derive(Debug, Clone, Serialize)]
pub struct Preview {
    pub generation: String,
    pub context_digest: String,
    pub normalized_digest: String,
    pub file_fingerprints: BTreeMap<String, String>,
    pub objects: Vec<Object>,
    pub total: usize,
    pub page: usize,
    pub issues: Vec<Issue>,
    pub counts: Counts,
    pub can_commit: bool,
    pub accounts: Vec<Account>,
    pub external_keys: BTreeMap<String, String>,
    pub referenced_keys: Vec<String>,
    pub account_names: BTreeMap<String, String>,
    pub origin_before: Option<String>,
    pub prior_receipt: Option<Receipt>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptObject {
    pub kind: String,
    pub external_key: String,
    pub id: String,
    pub action: String,
    pub revision_before: Option<i64>,
    pub revision_after: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub request_id: String,
    pub batch_fingerprint: String,
    pub source_name: String,
    pub mapping_set_id: String,
    pub objects: Vec<ReceiptObject>,
    pub counts: Counts,
    pub created_at: String,
    pub origin_before: Option<String>,
    pub origin_after: Option<String>,
    pub origin_changed: bool,
}
#[derive(Clone)]
struct Key {
    id: String,
    status: String,
}
struct Prepared {
    objects: Vec<Object>,
    issues: Vec<Issue>,
    counts: Counts,
    normalized_digest: String,
    file_fingerprints: BTreeMap<String, String>,
    records: Vec<ReceiptObject>,
    external_keys: BTreeMap<String, String>,
    referenced_keys: Vec<String>,
    account_names: BTreeMap<String, String>,
}

fn checkpoint(cancel: &dyn Fn() -> bool) -> Result<()> {
    if cancel() {
        Err(Error::new("CANCELLED", "解析已取消，未提交任何资料"))
    } else {
        Ok(())
    }
}
fn namespace(input: &BatchInput) -> Result<()> {
    for value in [&input.source_name, &input.mapping_set_id] {
        if value.trim() != value
            || value.is_empty()
            || value.chars().count() > 100
            || value.contains('\0')
        {
            return Err(Error::new(
                "IMPORT_NAMESPACE",
                "来源和映射集合须为 1–100 字，不能含首尾空白或空字符",
            ));
        }
    }
    if input.files.is_empty() || input.files.len() > 2 {
        return Err(Error::new(
            "IMPORT_FILES",
            "请选择账户或盘点 CSV，每种最多一份",
        ));
    }
    let mut kinds = BTreeSet::new();
    let mut bytes = 0usize;
    for file in &input.files {
        if !matches!(file.kind.as_str(), "accounts" | "snapshots") || !kinds.insert(&file.kind) {
            return Err(Error::new(
                "IMPORT_KIND",
                "本期仅支持账户与盘点，每种文件最多一份",
            ));
        }
        bytes = bytes
            .checked_add(file.csv_text.len())
            .ok_or_else(|| Error::new("LIMIT_SIZE", "请拆分文件"))?;
    }
    if bytes > parser::MAX_BYTES {
        return Err(Error::new(
            "LIMIT_SIZE",
            "每批总大小最多 20 MiB，请拆分文件",
        ));
    }
    for action in input.actions.values() {
        if !matches!(action.action.as_str(), "keep" | "correct" | "exclude") {
            return Err(Error::new(
                "IMPORT_ACTION",
                "请选择保留现有、更正或排除整组",
            ));
        }
    }
    Ok(())
}
fn keys(c: &Connection, b: &BatchInput) -> Result<BTreeMap<(String, String), Key>> {
    let mut q=c.prepare("SELECT object_kind,external_key,object_id,status FROM import_external_key WHERE source_name=?1 AND mapping_set_id=?2 ORDER BY object_kind,external_key")?;
    let result = q
        .query_map(params![b.source_name, b.mapping_set_id], |r| {
            Ok((
                (r.get(0)?, r.get(1)?),
                Key {
                    id: r.get(2)?,
                    status: r.get(3)?,
                },
            ))
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(result)
}
fn context_digest(c: &Connection, cancel: &dyn Fn() -> bool) -> Result<String> {
    // Includes deleted objects and mappings: membership changes and edits to
    // reused or skipped objects must invalidate an outstanding preview too.
    let mut values = Vec::<Value>::new();
    for sql in [
        "SELECT id,revision,coalesce(deleted_at,'') FROM fin_accounts ORDER BY id",
        "SELECT id,revision,coalesce(deleted_at,'') FROM fin_snapshots ORDER BY id",
    ] {
        let mut q = c.prepare(sql)?;
        values.extend(
            q.query_map([], |r| {
                Ok(json!([
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?
                ]))
            })?
            .map(|row| {
                checkpoint(cancel)?;
                Ok(row?)
            })
            .collect::<Result<Vec<_>>>()?,
        );
    }
    let mut q=c.prepare("SELECT source_name,mapping_set_id,object_kind,external_key,object_id,revision,status FROM import_external_key ORDER BY source_name,mapping_set_id,object_kind,external_key")?;
    values.extend(
        q.query_map([], |r| {
            Ok(json!([
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, String>(6)?
            ]))
        })?
        .map(|row| {
            checkpoint(cancel)?;
            Ok(row?)
        })
        .collect::<Result<Vec<_>>>()?,
    );
    Ok(digest(&serde_json::to_vec(&values)?))
}
fn stable_id(b: &BatchInput, kind: &str, key: &str) -> String {
    let hash = digest(
        &serde_json::to_vec(&(&b.generation, &b.source_name, &b.mapping_set_id, kind, key))
            .expect("string tuple"),
    );
    let mut bytes = [0u8; 16];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hash[i * 2..i * 2 + 2], 16).expect("digest hex");
    }
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    uuid::Uuid::from_bytes(bytes).to_string()
}
fn issue(
    issues: &mut Vec<Issue>,
    file: &str,
    key: Option<&str>,
    row: Option<u32>,
    e: Error,
    blocking: bool,
) {
    issues.push(Issue {
        file: file.into(),
        code: e.code,
        severity: "error".into(),
        source_row: row,
        column: None,
        object_key: key.map(str::to_owned),
        message: e.message,
        blocking,
    });
}
fn parse(
    file: &FileInput,
    catalog: Option<Vec<ExistingAccountV1>>,
    today: &str,
    cancel: &dyn Fn() -> bool,
) -> Result<parser::ImportPreviewV1> {
    parser::parse_import_v1(
        &ImportRequestV1 {
            contract_version: 1,
            kind: file.kind.clone(),
            csv_text: file.csv_text.clone(),
            column_mapping: file.column_mapping.clone(),
            existing_accounts: catalog,
        },
        &ImportContext { today, cancel },
    )
    .map_err(|e| Error::new(&e.code, &e.message))
}
fn parser_issues(
    p: &parser::ImportPreviewV1,
    file: &FileInput,
    b: &BatchInput,
    out: &mut Vec<Issue>,
) {
    for i in &p.issues {
        let key = i
            .group_key
            .as_ref()
            .map(|k| format!("snapshot:{k}"))
            .or_else(|| {
                i.source_row.and_then(|row| {
                    p.groups
                        .iter()
                        .find(|g| g.source_rows.contains(&row))
                        .map(|g| format!("snapshot:{}", g.group_key))
                })
            });
        let excluded = key
            .as_ref()
            .is_some_and(|k| b.actions.get(k).is_some_and(|a| a.action == "exclude"));
        out.push(Issue {
            file: file.name.clone(),
            code: i.code.into(),
            severity: if i.severity == SeverityV1::Error {
                "error"
            } else {
                "warning"
            }
            .into(),
            source_row: i.source_row,
            column: i.column.clone(),
            object_key: key,
            message: i.message.clone(),
            blocking: i.severity == SeverityV1::Error && !excluded,
        });
    }
}
fn object_action(b: &BatchInput, key: &str, status: &str, revision: Option<i64>) -> Result<String> {
    match b.actions.get(key) {
        Some(a) => {
            if a.action != "exclude" && a.expected_revision != revision {
                return Err(Error::new(
                    "REVISION_CONFLICT",
                    "所选对象修订已变化，请重新预览",
                ));
            }
            if status == "new" && a.action != "exclude" {
                return Err(Error::new(
                    "IMPORT_ACTION",
                    "新对象只能创建或明确排除，不能保留不存在的对象",
                ));
            }
            if status == "error" && a.action != "exclude" {
                return Err(Error::new(
                    "IMPORT_ACTION",
                    "错误对象只能修正文件或明确排除",
                ));
            }
            Ok(if status == "same" && a.action != "exclude" {
                "keep".into()
            } else {
                a.action.clone()
            })
        }
        None => Ok(match status {
            "new" => "create",
            "same" => "keep",
            _ => "unresolved",
        }
        .into()),
    }
}
fn fingerprint_files(b: &BatchInput) -> BTreeMap<String, String> {
    b.files
        .iter()
        .map(|f| (f.kind.clone(), digest(f.csv_text.as_bytes())))
        .collect()
}
fn batch_fingerprint(b: &BatchInput) -> Result<String> {
    Ok(digest(&serde_json::to_vec(&(
        &b.source_name,
        &b.mapping_set_id,
        fingerprint_files(b),
        b.files
            .iter()
            .map(|f| (&f.kind, &f.column_mapping))
            .collect::<Vec<_>>(),
        &b.mappings,
        &b.actions,
    ))?))
}
fn origin(c: &Connection, cancel: &dyn Fn() -> bool) -> Result<Option<String>> {
    let live = wealth::accounts_cancellable(c, &|| checkpoint(cancel))?;
    let mut q =
        c.prepare("SELECT id FROM fin_snapshots WHERE deleted_at IS NULL ORDER BY date DESC")?;
    for id in q.query_map([], |r| r.get::<_, String>(0))? {
        let id = id?;
        checkpoint(cancel)?;
        if wealth::snapshot(c, &id, &live)?.is_some_and(|s| s.missing.is_empty()) {
            return Ok(Some(id));
        }
    }
    Ok(None)
}
fn map_write(
    tx: &Transaction<'_>,
    b: &BatchInput,
    kind: &str,
    key: &str,
    id: &str,
    value: &Value,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let fp = digest(&serde_json::to_vec(value)?);
    tx.execute("INSERT INTO import_external_key VALUES(?1,?2,?3,?4,?5,?6,1,'active',?7,?7) ON CONFLICT(source_name,mapping_set_id,object_kind,external_key) DO UPDATE SET value_fingerprint=excluded.value_fingerprint,revision=import_external_key.revision+1,updated_at=excluded.updated_at",params![b.source_name,b.mapping_set_id,kind,key,id,fp,now])?;
    Ok(())
}
fn prepare(
    tx: &Transaction<'_>,
    b: &BatchInput,
    today: &str,
    cancel: &dyn Fn() -> bool,
    after_accounts: &dyn Fn() -> Result<()>,
    progress: &dyn Fn(&str),
) -> Result<Prepared> {
    checkpoint(cancel)?;
    namespace(b)?;
    let mappings = keys(tx, b)?;
    let live = wealth::accounts_cancellable(tx, &|| checkpoint(cancel))?;
    let live_by_id: BTreeMap<_, _> = live.iter().map(|a| (a.id.as_str(), a)).collect();
    let mut bindings = BTreeMap::<String, String>::new();
    let mut next_position: i64 = tx.query_row(
        "SELECT coalesce(max(position)+1,0) FROM fin_accounts",
        [],
        |r| r.get(0),
    )?;
    let mut issues = Vec::new();
    let mut objects = Vec::new();
    let mut records = Vec::new();
    let mut standard = Vec::<Value>::new();
    let mut referenced_keys = BTreeSet::<String>::new();
    let mut row_count = 0u32;
    for ((kind, key), mapped) in &mappings {
        checkpoint(cancel)?;
        if kind == "account"
            && mapped.status == "active"
            && live_by_id.contains_key(mapped.id.as_str())
        {
            bindings.insert(key.clone(), mapped.id.clone());
        }
    }
    for (key, m) in &b.mappings {
        checkpoint(cancel)?;
        if key.is_empty() || key.chars().count() > 100 || key.contains('\0') {
            return Err(Error::new("KEY_LENGTH", "映射键须为 1–100 字"));
        }
        let a = live_by_id
            .get(m.id.as_str())
            .ok_or_else(|| Error::new("ACCOUNT_UNMAPPED", "所选账户已删除，请重新预览"))?;
        if a.revision != m.expected_revision {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "所选账户已变化，请重新预览",
            ));
        }
        if mappings
            .get(&("account".into(), key.clone()))
            .is_some_and(|old| old.status == "purged" || old.id != m.id)
        {
            return Err(Error::new(
                "IMPORT_MAPPING_CONFLICT",
                "这个外部键已有稳定映射，不能重绑；请使用新的来源或映射集合",
            ));
        }
        bindings.insert(key.clone(), m.id.clone());
    }
    progress("正在解析账户文件");
    if let Some(file) = b.files.iter().find(|f| f.kind == "accounts") {
        let p = parse(file, None, today, cancel)?;
        row_count += p.counts.rows_read;
        parser_issues(&p, file, b, &mut issues);
        for row in p.rows {
            checkpoint(cancel)?;
            let StandardRowV1::Accounts(r) = row else {
                continue;
            };
            referenced_keys.insert(r.account_key.clone());
            let key = format!("account:{}", r.account_key);
            standard.push(serde_json::to_value(&r)?);
            let f = AccountFields {
                name: r.name.clone(),
                institution: r.platform.clone().unwrap_or_default(),
                side: parser::ACCOUNT_KINDS
                    .iter()
                    .find(|k| k.key == r.kind)
                    .ok_or_else(|| Error::new("ACCOUNT_KIND", "账户类型无效"))?
                    .side
                    .into(),
                kind: r.kind.clone(),
                counted: r.counted,
                opened_on: r.enabled_from.clone(),
                closed_on: r.disabled_from.clone(),
                notes: r.note.clone().unwrap_or_default(),
            };
            let old_key = mappings.get(&("account".into(), r.account_key.clone()));
            let id = bindings
                .get(&r.account_key)
                .cloned()
                .unwrap_or_else(|| stable_id(b, "account", &r.account_key));
            let old = wealth::account(tx, &id)?;
            let before = old
                .as_ref()
                .map(|a| serde_json::to_value(&a.fields))
                .transpose()?;
            let after = serde_json::to_value(&f)?;
            let mut status = if old.is_none() {
                "new"
            } else if before.as_ref() == Some(&after) {
                "same"
            } else {
                "conflict"
            }
            .to_string();
            if old_key.is_some_and(|k| k.status == "purged")
                || old
                    .as_ref()
                    .is_some_and(|a| !live_by_id.contains_key(a.id.as_str()))
            {
                status = "error".into();
                issue(
                    &mut issues,
                    &file.name,
                    Some(&key),
                    Some(r.source_row),
                    Error::new(
                        "IMPORT_TOMBSTONE",
                        "该外部键指向已清除或删除的账户，不能按同名重新绑定",
                    ),
                    b.actions.get(&key).is_none_or(|a| a.action != "exclude"),
                );
            }
            let rev = old.as_ref().map(|a| a.revision);
            let action = object_action(b, &key, &status, rev)?;
            let mut revision_after = rev;
            if action == "create" || action == "correct" {
                match wealth::write_account_tx(
                    tx,
                    &AccountSave {
                        request_id: String::new(),
                        generation: b.generation.clone(),
                        id: old.as_ref().map(|a| a.id.clone()),
                        expected_revision: rev,
                        fields: f,
                    },
                    today,
                    Some(&id),
                    true,
                    Some(next_position),
                ) {
                    Ok(a) => {
                        if old.is_none() {
                            next_position += 1;
                        }
                        revision_after = Some(a.revision);
                        bindings.insert(r.account_key.clone(), id.clone());
                    }
                    Err(e) => {
                        status = "error".into();
                        issue(
                            &mut issues,
                            &file.name,
                            Some(&key),
                            Some(r.source_row),
                            e,
                            true,
                        );
                    }
                }
            } else if action == "keep" && old.is_some() {
                bindings.insert(r.account_key.clone(), id.clone());
            }
            if action != "exclude" && status != "error" && action != "unresolved" {
                let value = wealth::account(tx, &id)?
                    .map(|a| serde_json::to_value(a.fields))
                    .transpose()?
                    .unwrap_or(after.clone());
                map_write(tx, b, "account", &r.account_key, &id, &value)?;
                records.push(ReceiptObject {
                    kind: "account".into(),
                    external_key: r.account_key.clone(),
                    id: id.clone(),
                    action: action.clone(),
                    revision_before: rev,
                    revision_after,
                });
            }
            objects.push(Object {
                key,
                kind: "account".into(),
                external_key: r.account_key,
                id,
                source_rows: vec![r.source_row],
                status,
                action,
                expected_revision: rev,
                before,
                after,
            });
        }
    }
    // Explicit mappings may accompany a snapshots-only file. Persist those
    // identities in the same transaction, never as a separate mapping write.
    for (key, m) in &b.mappings {
        checkpoint(cancel)?;
        let a = wealth::account(tx, &m.id)?
            .ok_or_else(|| Error::new("ACCOUNT_UNMAPPED", "找不到映射账户"))?;
        map_write(
            tx,
            b,
            "account",
            key,
            &m.id,
            &serde_json::to_value(a.fields)?,
        )?;
    }
    after_accounts()?;
    progress("正在核对账户对应与有效期");
    let projected = wealth::accounts_cancellable(tx, &|| checkpoint(cancel))?;
    let by_id: BTreeMap<_, _> = projected.iter().map(|a| (a.id.as_str(), a)).collect();
    let catalog: Vec<_> = bindings
        .iter()
        .filter_map(|(key, id)| {
            by_id.get(id.as_str()).copied().map(|a| ExistingAccountV1 {
                external_key: Some(key.clone()),
                account_id: id.clone(),
                name: a.fields.name.clone(),
                kind: a.fields.kind.clone(),
                enabled_from: a.fields.opened_on.clone(),
                disabled_from: a.fields.closed_on.clone(),
            })
        })
        .collect();
    // Parser contract permits only one key per account; aliases in a namespace
    // would otherwise create an ambiguous completeness catalog.
    let ids: BTreeSet<_> = catalog.iter().map(|a| &a.account_id).collect();
    if ids.len() != catalog.len() {
        return Err(Error::new(
            "IMPORT_MAPPING_CONFLICT",
            "同一账户不能对应多个外部键，请核对映射集合",
        ));
    }
    progress("正在解析盘点文件");
    if let Some(file) = b.files.iter().find(|f| f.kind == "snapshots") {
        let references = parse(file, None, today, cancel)?;
        let raw_keys = references
            .rows
            .iter()
            .filter_map(|r| {
                if let StandardRowV1::Snapshots(r) = r {
                    Some(r.account_key.clone())
                } else {
                    None
                }
            })
            .collect::<BTreeSet<_>>();
        referenced_keys.extend(raw_keys);
        drop(references);
        let p = parse(file, Some(catalog), today, cancel)?;
        row_count += p.counts.rows_read;
        parser_issues(&p, file, b, &mut issues);
        let mut rows = BTreeMap::new();
        for row in p.rows {
            if let StandardRowV1::Snapshots(r) = row {
                standard.push(serde_json::to_value(&r)?);
                rows.entry(r.snapshot_key.clone())
                    .or_insert_with(Vec::new)
                    .push(r);
            }
        }
        progress("正在核对完整日期组");
        for group in p.groups {
            checkpoint(cancel)?;
            let key = format!("snapshot:{}", group.group_key);
            let rs = rows.remove(&group.group_key).unwrap_or_default();
            let day = group.date.clone().unwrap_or_default();
            let mapped = mappings.get(&("snapshot".into(), group.group_key.clone()));
            let by_date: Option<String> = tx
                .query_row(
                    "SELECT id FROM fin_snapshots WHERE date=?1 AND deleted_at IS NULL",
                    [&day],
                    |r| r.get(0),
                )
                .optional()?;
            let id = mapped
                .map(|k| k.id.clone())
                .or(by_date)
                .unwrap_or_else(|| stable_id(b, "snapshot", &group.group_key));
            let old = wealth::snapshot(tx, &id, &projected)?;
            let rev = old.as_ref().map(|s| s.revision);
            let mut overrides = HistoricalOverrides::new();
            let mut entries = Vec::new();
            let mut historical = Vec::<Value>::new();
            let mut notes = String::new();
            let mut status = if group.validation == GroupValidationV1::Invalid {
                "error"
            } else {
                "new"
            }
            .to_string();
            for r in &rs {
                notes = r.note.clone().filter(|n| !n.is_empty()).unwrap_or(notes);
                if let Some(account_id) = bindings.get(&r.account_key) {
                    let a = by_id
                        .get(account_id.as_str())
                        .copied()
                        .ok_or_else(|| Error::new("ACCOUNT_UNMAPPED", "找不到账户"))?;
                    let kind = r.kind_at_date.clone().unwrap_or(a.fields.kind.clone());
                    let counted = r.counted_at_date.unwrap_or(a.fields.counted);
                    if !parser::ACCOUNT_KINDS
                        .iter()
                        .any(|k| k.key == kind && k.side == a.fields.side)
                    {
                        status = "error".into();
                        issue(
                            &mut issues,
                            &file.name,
                            Some(&key),
                            Some(r.source_row),
                            Error::new(
                                "HISTORY_KIND_SIDE",
                                "历史类型方向与账户不一致，请修正该行 kind_at_date",
                            ),
                            b.actions.get(&key).is_none_or(|a| a.action != "exclude"),
                        );
                    }
                    overrides.insert(account_id.clone(), (Some(kind.clone()), Some(counted)));
                    entries.push(EntryInput {
                        account_id: account_id.clone(),
                        state: "entered".into(),
                        amount_cents: Some(r.amount_cents.clone()),
                    });
                    historical.push(json!({"account_id":account_id,"state":"entered","amount_cents":r.amount_cents,"side":a.fields.side,"kind":kind,"counted":counted}));
                } else {
                    status = "error".into();
                }
            }
            historical.sort_by(|a, b| a["account_id"].as_str().cmp(&b["account_id"].as_str()));
            let after = json!({"date":day,"notes":notes,"entries":historical});
            let before = old.as_ref().map(|s| {
                let mut es = s
                    .entries
                    .iter()
                    .map(|e| serde_json::to_value(e).expect("entry"))
                    .collect::<Vec<_>>();
                es.sort_by(|a, b| a["account_id"].as_str().cmp(&b["account_id"].as_str()));
                json!({"date":s.date,"notes":s.notes,"entries":es})
            });
            if status != "error" {
                status = if old.is_none() {
                    "new"
                } else if before.as_ref() == Some(&after) {
                    "same"
                } else {
                    "conflict"
                }
                .into();
            }
            if mapped.is_some_and(|k| k.status == "purged") || (mapped.is_some() && old.is_none()) {
                status = "error".into();
                issue(
                    &mut issues,
                    &file.name,
                    Some(&key),
                    group.source_rows.first().copied(),
                    Error::new(
                        "IMPORT_TOMBSTONE",
                        "该外部键指向已删除或永久清除的盘点，不能重新绑定",
                    ),
                    b.actions.get(&key).is_none_or(|a| a.action != "exclude"),
                );
            }
            let action = object_action(b, &key, &status, rev)?;
            let mut revision_after = rev;
            if status != "error" && (action == "create" || action == "correct") {
                match wealth::write_snapshot_tx(
                    tx,
                    &SnapshotSave {
                        request_id: String::new(),
                        generation: b.generation.clone(),
                        id: old.as_ref().map(|s| s.id.clone()),
                        expected_revision: rev,
                        date: day,
                        notes,
                        entries,
                    },
                    today,
                    Some(&id),
                    Some(&overrides),
                    Some(&projected),
                ) {
                    Ok(s) => {
                        revision_after = Some(s.revision);
                    }
                    Err(e) => {
                        status = "error".into();
                        issue(
                            &mut issues,
                            &file.name,
                            Some(&key),
                            group.source_rows.first().copied(),
                            e,
                            true,
                        );
                    }
                }
            }
            // Same/kept groups still require full real-catalog validation. An
            // unkeyed database account must never disappear from this check.
            if status != "error" && action != "exclude" {
                let due_ids: BTreeSet<_> = projected
                    .iter()
                    .filter(|a| wealth::due(a, after["date"].as_str().unwrap_or_default()))
                    .map(|a| a.id.as_str())
                    .collect();
                let given_ids: BTreeSet<_> = rs
                    .iter()
                    .filter_map(|r| bindings.get(&r.account_key).map(String::as_str))
                    .collect();
                if given_ids != due_ids {
                    status = "error".into();
                    let names = projected
                        .iter()
                        .filter(|a| {
                            due_ids.contains(a.id.as_str()) && !given_ids.contains(a.id.as_str())
                        })
                        .map(|a| a.fields.name.as_str())
                        .collect::<Vec<_>>()
                        .join("、");
                    issue(
                        &mut issues,
                        &file.name,
                        Some(&key),
                        group.source_rows.first().copied(),
                        Error::new(
                            "SNAPSHOT_MISSING_ACCOUNT",
                            &format!("完整盘点须包含真实账户目录；缺少：{names}"),
                        ),
                        true,
                    );
                }
            }
            if status != "error" && action != "exclude" && action != "unresolved" {
                map_write(tx, b, "snapshot", &group.group_key, &id, &after)?;
                records.push(ReceiptObject {
                    kind: "snapshot".into(),
                    external_key: group.group_key.clone(),
                    id: id.clone(),
                    action: action.clone(),
                    revision_before: rev,
                    revision_after,
                });
            }
            objects.push(Object {
                key,
                kind: "snapshot".into(),
                external_key: group.group_key,
                id,
                source_rows: group.source_rows,
                status,
                action,
                expected_revision: rev,
                before,
                after,
            });
        }
    }
    if row_count > parser::MAX_DATA_ROWS as u32 {
        return Err(Error::new(
            "LIMIT_ROWS",
            "每批数据行合计最多 50000，请拆分文件",
        ));
    }
    // Final-state guards run after every chosen correction. They cannot be
    // bypassed by creating a closed account before writing its history.
    progress("正在复核整批最终状态");
    let final_accounts = wealth::accounts_cancellable(tx, &|| checkpoint(cancel))?;
    let account_names = final_accounts
        .iter()
        .map(|a| (a.id.clone(), a.fields.name.clone()))
        .collect();
    for a in final_accounts {
        checkpoint(cancel)?;
        if let Err(e) = wealth::validate_account_history_tx(tx, &a.id, &a.fields, true) {
            let key = objects
                .iter()
                .find(|o| o.kind == "account" && o.id == a.id)
                .map(|o| o.key.as_str());
            issue(&mut issues, "整批最终状态", key, None, e, true);
        }
    }
    let valid_keys: BTreeSet<_> = objects.iter().map(|o| o.key.as_str()).collect();
    if b.actions.keys().any(|k| !valid_keys.contains(k.as_str())) {
        return Err(Error::new(
            "IMPORT_ACTION",
            "所选动作对应的对象不在本批中，请重新预览",
        ));
    }
    let mut counts = Counts::default();
    for o in &objects {
        match o.status.as_str() {
            "new" => {
                if o.kind == "account" {
                    counts.new_accounts += 1
                } else {
                    counts.new_snapshots += 1
                }
            }
            "same" => counts.same += 1,
            "conflict" => counts.conflicts += 1,
            "error" => counts.errors += 1,
            _ => {}
        }
    }
    for r in &records {
        match r.action.as_str() {
            "create" => {
                if r.kind == "account" {
                    counts.created_accounts += 1
                } else {
                    counts.created_snapshots += 1
                }
            }
            "correct" => counts.corrected += 1,
            "keep" => counts.skipped += 1,
            _ => {}
        }
    }
    let referenced_keys = referenced_keys.into_iter().collect();
    let normalized_digest = digest(&serde_json::to_vec(&(standard, &b.mappings, &b.actions))?);
    Ok(Prepared {
        objects,
        issues,
        counts,
        normalized_digest,
        file_fingerprints: fingerprint_files(b),
        records,
        external_keys: bindings,
        referenced_keys,
        account_names,
    })
}
fn ready(p: &Prepared) -> bool {
    !p.records.is_empty()
        && !p.issues.iter().any(|i| i.blocking)
        && !p
            .objects
            .iter()
            .any(|o| o.action == "unresolved" || (o.status == "error" && o.action != "exclude"))
}
fn find_receipt(c: &Connection, request: &str) -> Result<Option<Receipt>> {
    let raw:Option<String>=c.query_row("SELECT r.result_json FROM feature_requests f JOIN import_receipt r ON r.request_id=f.result WHERE f.id=?1",[request],|r|r.get(0)).optional()?;
    raw.map(|s| serde_json::from_str(&s).map_err(Into::into))
        .transpose()
}
impl Store {
    fn import_context_digest(&self, c: &Connection, cancel: &dyn Fn() -> bool) -> Result<String> {
        let stamp = std::fs::metadata(self.root.with_file_name("modules.json"))
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|t| (t.as_secs(), t.subsec_nanos()));
        Ok(digest(&serde_json::to_vec(&(
            context_digest(c, cancel)?,
            stamp,
        ))?))
    }
    fn import_context(&self, b: &BatchInput) -> Result<()> {
        self.check_generation(&b.generation)?;
        if self.sample {
            return Err(Error::new("SAMPLE_READ_ONLY", "历史导入只可用于个人资料"));
        }
        if !crate::modules::read(&self.root).wealth {
            return Err(Error::new(
                "MODULE_DISABLED",
                "账户与盘点模块已关闭，请重新启用并预览",
            ));
        }
        namespace(b)
    }
    pub fn financial_import_preview(
        &self,
        b: &BatchInput,
        today: &str,
        cancel: &dyn Fn() -> bool,
    ) -> Result<Preview> {
        self.financial_import_preview_tracked(b, today, cancel, &|_| {})
    }
    pub fn financial_import_preview_tracked(
        &self,
        b: &BatchInput,
        today: &str,
        cancel: &dyn Fn() -> bool,
        progress: &dyn Fn(&str),
    ) -> Result<Preview> {
        self.import_context(b)?;
        checkpoint(cancel)?;
        progress("正在读取现有账户与盘点");
        let context = self.import_context_digest(self.conn()?, cancel)?;
        let accounts = wealth::accounts_cancellable(self.conn()?, &|| checkpoint(cancel))?;
        let origin_before = origin(self.conn()?, cancel)?;
        let mut memory = Connection::open_in_memory()?;
        {
            let backup = rusqlite::backup::Backup::new(self.conn()?, &mut memory)?;
            loop {
                checkpoint(cancel)?;
                match backup.step(128)? {
                    rusqlite::backup::StepResult::Done => break,
                    rusqlite::backup::StepResult::More => {}
                    _ => return Err(Error::new("IMPORT_BUSY", "资料正忙，请稍后重新预览")),
                }
            }
        }
        memory.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF")?;
        let tx = memory.unchecked_transaction()?;
        let p = prepare(&tx, b, today, cancel, &|| Ok(()), progress)?;
        self.import_context(b)?;
        checkpoint(cancel)?;
        if self.import_context_digest(self.conn()?, cancel)? != context {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "预览期间资料或模块已变化，请重新预览",
            ));
        }
        let can_commit = ready(&p);
        let total = p.objects.len();
        let page = b.page.min(total.saturating_sub(1) / PAGE_SIZE);
        let prior: Option<String> = self
            .conn()?
            .query_row(
                "SELECT result_json FROM import_receipt WHERE batch_fingerprint=?1",
                [batch_fingerprint(b)?],
                |r| r.get(0),
            )
            .optional()?;
        Ok(Preview {
            generation: b.generation.clone(),
            context_digest: context,
            normalized_digest: p.normalized_digest,
            file_fingerprints: p.file_fingerprints,
            objects: p
                .objects
                .into_iter()
                .skip(page * PAGE_SIZE)
                .take(PAGE_SIZE)
                .collect(),
            total,
            page,
            issues: p.issues,
            counts: p.counts,
            can_commit,
            accounts,
            external_keys: p.external_keys,
            referenced_keys: p.referenced_keys,
            account_names: p.account_names,
            origin_before,
            prior_receipt: prior.map(|r| serde_json::from_str(&r)).transpose()?,
        })
    }
    pub fn financial_import_commit(&mut self, input: &CommitInput, today: &str) -> Result<Receipt> {
        self.import_context(&input.batch)?;
        uuid::Uuid::parse_str(&input.request_id)
            .map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        let request_fp = digest(&serde_json::to_vec(&("financial_import", input))?);
        let batch_fp = batch_fingerprint(&input.batch)?;
        let tx = self.conn()?.unchecked_transaction()?;
        let previous: Option<(String, String)> = tx
            .query_row(
                "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
                [&input.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((fp, _)) = previous {
            if fp != request_fp {
                return Err(Error::new("REQUEST_CONFLICT", "请求标识已用于其他内容"));
            }
            return find_receipt(&tx, &input.request_id)?
                .ok_or_else(|| Error::new("REQUEST_CONFLICT", "此请求不是金融导入"));
        }
        let prior: Option<(String, String)> = tx
            .query_row(
                "SELECT request_id,result_json FROM import_receipt WHERE batch_fingerprint=?1",
                [&batch_fp],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((id, raw)) = prior {
            tx.execute(
                "INSERT INTO feature_requests VALUES(?1,?2,?3)",
                params![input.request_id, request_fp, id],
            )?;
            tx.commit()?;
            return Ok(serde_json::from_str(&raw)?);
        }
        if self.import_context_digest(&tx, &|| false)? != input.context_digest {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "账户、盘点或映射在预览后已变化，请重新预览整批",
            ));
        }
        let before = origin(&tx, &|| false)?;
        let p = prepare(
            &tx,
            &input.batch,
            today,
            &|| false,
            &|| self.hit("financial_import.after_accounts"),
            &|_| {},
        )?;
        if p.file_fingerprints != input.file_fingerprints
            || p.normalized_digest != input.normalized_digest
        {
            return Err(Error::new(
                "IMPORT_CHANGED",
                "文件或所选集合已变化，请重新预览",
            ));
        }
        if !ready(&p) {
            return Err(Error::new(
                "IMPORT_INVALID",
                "整批验证未通过，请修正问题或明确排除错误整组后重新预览",
            ));
        }
        let after = origin(&tx, &|| false)?;
        let receipt = Receipt {
            request_id: input.request_id.clone(),
            batch_fingerprint: batch_fp.clone(),
            source_name: input.batch.source_name.clone(),
            mapping_set_id: input.batch.mapping_set_id.clone(),
            objects: p.records,
            counts: p.counts,
            created_at: chrono::Utc::now().to_rfc3339(),
            origin_changed: before != after,
            origin_before: before,
            origin_after: after,
        };
        tx.execute(
            "INSERT INTO import_receipt VALUES(?1,?2,?3,?4,?5,?6,?7,'committed')",
            params![
                input.request_id,
                request_fp,
                batch_fp,
                input.batch.source_name,
                input.batch.mapping_set_id,
                serde_json::to_string(&receipt)?,
                receipt.created_at
            ],
        )?;
        tx.execute(
            "INSERT INTO feature_requests VALUES(?1,?2,?1)",
            params![input.request_id, request_fp],
        )?;
        self.hit("financial_import.before_commit")?;
        tx.commit()?;
        self.hit("financial_import.after_commit")?;
        Ok(receipt)
    }
    pub fn financial_import_receipt(
        &self,
        request: &str,
        generation: &str,
    ) -> Result<Option<Receipt>> {
        self.check_generation(generation)?;
        uuid::Uuid::parse_str(request).map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
        find_receipt(self.conn()?, request)
    }
}

pub(crate) fn validate_dataset(c: &Connection) -> Result<()> {
    let mut q=c.prepare("SELECT object_kind,object_id,status,value_fingerprint,source_name,mapping_set_id,external_key FROM import_external_key")?;
    for row in q.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, String>(6)?,
        ))
    })? {
        let (kind, id, status, fp, source, mapping, key) = row?;
        uuid::Uuid::parse_str(&id).map_err(|_| Error::new("FORMAT", "导入映射 ID 无效"))?;
        if fp.len() != 64
            || !fp.bytes().all(|b| b.is_ascii_hexdigit())
            || [source, mapping, key]
                .iter()
                .any(|v| v.is_empty() || v.chars().count() > 100 || v.contains('\0'))
        {
            return Err(Error::new("FORMAT", "导入映射格式无效"));
        }
        let table = if kind == "account" {
            "fin_accounts"
        } else {
            "fin_snapshots"
        };
        let exists: bool = c.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"),
            [id],
            |r| r.get(0),
        )?;
        if status == "active" && !exists {
            return Err(Error::new("FORMAT", "活动导入映射的对象已丢失"));
        }
    }
    let mut q = c.prepare("SELECT request_id,batch_fingerprint,result_json FROM import_receipt")?;
    for row in q.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })? {
        let (id, fp, raw) = row?;
        let r: Receipt = serde_json::from_str(&raw)?;
        uuid::Uuid::parse_str(&id).map_err(|_| Error::new("FORMAT", "导入回执 ID 无效"))?;
        if r.request_id != id
            || r.batch_fingerprint != fp
            || r.objects.len() > parser::MAX_DATA_ROWS
        {
            return Err(Error::new("FORMAT", "导入回执格式无效"));
        }
        for o in r.objects {
            uuid::Uuid::parse_str(&o.id).map_err(|_| Error::new("FORMAT", "回执对象 ID 无效"))?;
            if !matches!(o.kind.as_str(), "account" | "snapshot")
                || !matches!(o.action.as_str(), "create" | "correct" | "keep")
            {
                return Err(Error::new("FORMAT", "回执对象动作无效"));
            }
        }
    }
    Ok(())
}
