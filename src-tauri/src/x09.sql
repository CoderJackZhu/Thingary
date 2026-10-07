-- 关联订阅整组删除（EXPENSE_OVERVIEW_SUBSCRIPTION_LINKS_DESIGN §7/§8）。
-- 组记录删除归属与恢复集合；成员是虚拟档案与周期计划，member_id 不设外键，
-- 因为永久清除后组仅保留操作归属记录。迁移只建结构，不修复任何历史关系。
CREATE TABLE link_trash_groups(
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('deleted','restored','purged')),
  source_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0)
);
CREATE TABLE link_trash_members(
  group_id TEXT NOT NULL REFERENCES link_trash_groups(id),
  member_kind TEXT NOT NULL CHECK(member_kind IN ('virtual','plan')),
  member_id TEXT NOT NULL,
  revision_before INTEGER NOT NULL CHECK(revision_before>0),
  revision_after INTEGER NOT NULL CHECK(revision_after>0),
  restore_member INTEGER NOT NULL CHECK(restore_member IN (0,1)),
  PRIMARY KEY(group_id,member_kind)
);
CREATE INDEX link_trash_members_lookup ON link_trash_members(member_id);
PRAGMA user_version=32;
