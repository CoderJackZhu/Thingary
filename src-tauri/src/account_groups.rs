//! Account groups are current display metadata, never historical money facts.
use crate::{
    domain::{Error, Result},
    storage::{digest, uid, Store},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub revision: i64,
    pub accounts: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct List {
    pub generation: String,
    pub groups: Vec<Group>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Save {
    pub request_id: String,
    pub generation: String,
    pub id: Option<String>,
    pub expected_revision: Option<i64>,
    pub name: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delete {
    pub request_id: String,
    pub generation: String,
    pub id: String,
    pub expected_revision: i64,
    pub expected_accounts: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reorder {
    pub request_id: String,
    pub generation: String,
    pub ids: Vec<String>,
}
pub(crate) fn name(value: &str) -> Result<String> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
        return Err(Error::new(
            "GROUP_NAME",
            "分组名称须为 1–40 字，不能含控制字符",
        ));
    }
    Ok(name.to_owned())
}
pub(crate) fn list(c: &Connection) -> Result<Vec<Group>> {
    let mut q = c.prepare("SELECT g.id,g.name,g.position,g.revision,(SELECT count(*) FROM fin_accounts a WHERE a.group_id=g.id) FROM fin_account_groups g ORDER BY g.position,g.id")?;
    let rows = q
        .query_map([], |r| {
            Ok(Group {
                id: r.get(0)?,
                name: r.get(1)?,
                position: r.get(2)?,
                revision: r.get(3)?,
                accounts: r.get(4)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(rows)
}
pub(crate) fn find_name(c: &Connection, value: &str) -> Result<Option<String>> {
    Ok(c.query_row(
        "SELECT id FROM fin_account_groups WHERE name=?1",
        [name(value)?],
        |r| r.get(0),
    )
    .optional()?)
}
pub(crate) fn ensure(c: &Connection, value: &str, id: &str) -> Result<String> {
    let value = name(value)?;
    if let Some(existing) = find_name(c, &value)? {
        return Ok(existing);
    }
    let now = chrono::Utc::now().to_rfc3339();
    c.execute("INSERT INTO fin_account_groups(id,name,position,revision,created_at,updated_at) VALUES(?1,?2,(SELECT coalesce(max(position),-1)+1 FROM fin_account_groups),1,?3,?3)", params![id,value,now])?;
    Ok(id.to_owned())
}
fn receipt(c: &Connection, request: &str, fingerprint: &str) -> Result<Option<String>> {
    uuid::Uuid::parse_str(request).map_err(|_| Error::new("REQUEST", "请求标识无效"))?;
    let old: Option<(String, String)> = c
        .query_row(
            "SELECT fingerprint,result FROM feature_requests WHERE id=?1",
            [request],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match old {
        Some((fp, _)) if fp != fingerprint => {
            Err(Error::new("REQUEST_CONFLICT", "请求标识已用于不同内容"))
        }
        Some((_, result)) => Ok(Some(result)),
        None => Ok(None),
    }
}
fn record(c: &Connection, request: &str, fingerprint: &str, result: &str) -> Result<()> {
    c.execute(
        "INSERT INTO feature_requests VALUES(?1,?2,?3)",
        params![request, fingerprint, result],
    )?;
    Ok(())
}
impl Store {
    pub fn account_groups_list(&self) -> Result<List> {
        Ok(List {
            generation: self.generation(),
            groups: list(self.conn()?)?,
        })
    }
    pub fn account_group_save(&mut self, input: &Save) -> Result<Group> {
        self.check_generation(&input.generation)?;
        let fp = digest(&serde_json::to_vec(&("account_group_save", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if let Some(result) = receipt(&tx, &input.request_id, &fp)? {
            return Ok(serde_json::from_str(&result)?);
        }
        let value = name(&input.name)?;
        let old = list(&tx)?
            .into_iter()
            .find(|g| Some(&g.id) == input.id.as_ref());
        if (input.id.is_some() && old.is_none())
            || old.as_ref().map(|g| g.revision) != input.expected_revision
        {
            return Err(Error::new("REVISION_CONFLICT", "分组已变化，请重新读取"));
        }
        if find_name(&tx, &value)?.is_some_and(|id| Some(id) != input.id) {
            return Err(Error::new("GROUP_NAME", "已有同名分组"));
        }
        let id = input.id.clone().unwrap_or_else(uid);
        if old.is_some() {
            tx.execute("UPDATE fin_account_groups SET name=?2,revision=revision+1,updated_at=?3 WHERE id=?1",params![id,value,chrono::Utc::now().to_rfc3339()])?;
        } else {
            ensure(&tx, &value, &id)?;
        }
        let result = list(&tx)?
            .into_iter()
            .find(|g| g.id == id)
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到分组"))?;
        record(
            &tx,
            &input.request_id,
            &fp,
            &serde_json::to_string(&result)?,
        )?;
        self.hit("account_group_save.before_commit")?;
        tx.commit()?;
        Ok(result)
    }
    pub fn account_group_delete(&mut self, input: &Delete) -> Result<()> {
        self.check_generation(&input.generation)?;
        let fp = digest(&serde_json::to_vec(&("account_group_delete", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if receipt(&tx, &input.request_id, &fp)?.is_some() {
            return Ok(());
        }
        let old = list(&tx)?
            .into_iter()
            .find(|g| g.id == input.id)
            .ok_or_else(|| Error::new("NOT_FOUND", "找不到分组"))?;
        if old.revision != input.expected_revision || old.accounts != input.expected_accounts {
            return Err(Error::new(
                "REVISION_CONFLICT",
                "分组或关联账户已变化，请重新读取后确认",
            ));
        }
        tx.execute("UPDATE fin_accounts SET group_id=NULL,revision=revision+1,updated_at=?2 WHERE group_id=?1",params![input.id,chrono::Utc::now().to_rfc3339()])?;
        tx.execute("DELETE FROM fin_account_groups WHERE id=?1", [&input.id])?;
        record(&tx, &input.request_id, &fp, "account-groups")?;
        self.hit("account_group_delete.before_commit")?;
        tx.commit()?;
        Ok(())
    }
    pub fn account_groups_reorder(&mut self, input: &Reorder) -> Result<()> {
        self.check_generation(&input.generation)?;
        let fp = digest(&serde_json::to_vec(&("account_groups_reorder", input))?);
        let tx = self.conn()?.unchecked_transaction()?;
        if receipt(&tx, &input.request_id, &fp)?.is_some() {
            return Ok(());
        }
        let groups = list(&tx)?;
        let expected: BTreeSet<_> = groups.iter().map(|g| &g.id).collect();
        let given: BTreeSet<_> = input.ids.iter().collect();
        if input.ids.len() != given.len() || expected != given {
            return Err(Error::new(
                "GROUP_ORDER",
                "分组列表已变化，请重新读取后排序",
            ));
        }
        let now = chrono::Utc::now().to_rfc3339();
        for (position, id) in input.ids.iter().enumerate() {
            tx.execute("UPDATE fin_account_groups SET position=?2,revision=revision+1,updated_at=?3 WHERE id=?1",params![id,position as i64,now])?;
        }
        record(&tx, &input.request_id, &fp, "account-groups")?;
        self.hit("account_groups_reorder.before_commit")?;
        tx.commit()?;
        Ok(())
    }
}
