-- Schema 35: unknown monthly deposits and stable income import keys.
CREATE TABLE plan_income_new(id TEXT PRIMARY KEY,date TEXT NOT NULL,net_cents INTEGER NOT NULL CHECK(net_cents BETWEEN 0 AND 99999999999),hpf_cents INTEGER CHECK(hpf_cents BETWEEN 0 AND 99999999999),notes TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
INSERT INTO plan_income_new SELECT id,date,net_cents,hpf_cents,notes,revision,created_at,updated_at,deleted_at FROM plan_income;
DROP TABLE plan_income;
-- replacement checkpoint
ALTER TABLE plan_income_new RENAME TO plan_income;
CREATE INDEX plan_income_date ON plan_income(date);
CREATE TABLE import_external_key_new (
  source_name TEXT NOT NULL,
  mapping_set_id TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK(object_kind IN ('account','snapshot','income')),
  external_key TEXT NOT NULL CHECK(length(external_key) BETWEEN 1 AND 100),
  object_id TEXT NOT NULL,
  value_fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  status TEXT NOT NULL CHECK(status IN ('active','purged')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_name,mapping_set_id,object_kind,external_key)
);
INSERT INTO import_external_key_new SELECT source_name,mapping_set_id,object_kind,external_key,object_id,value_fingerprint,revision,status,created_at,updated_at FROM import_external_key;
DROP TABLE import_external_key;
ALTER TABLE import_external_key_new RENAME TO import_external_key;
CREATE INDEX import_external_object ON import_external_key(object_kind,object_id);
PRAGMA user_version=35;
