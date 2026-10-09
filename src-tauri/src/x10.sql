CREATE TABLE import_external_key (
  source_name TEXT NOT NULL,
  mapping_set_id TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK(object_kind IN ('account','snapshot')),
  external_key TEXT NOT NULL CHECK(length(external_key) BETWEEN 1 AND 100),
  object_id TEXT NOT NULL,
  value_fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  status TEXT NOT NULL CHECK(status IN ('active','purged')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_name,mapping_set_id,object_kind,external_key)
);
CREATE INDEX import_external_object ON import_external_key(object_kind,object_id);
CREATE TABLE import_receipt (
  request_id TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  batch_fingerprint TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  mapping_set_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status='committed')
);
PRAGMA user_version=34;
