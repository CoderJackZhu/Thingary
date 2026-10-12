-- Schema 39: facts are optional, and do not modify snapshot balances.
CREATE TABLE cash_movements (
 id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL CHECK(revision>0),
 fact_revision INTEGER NOT NULL DEFAULT 1 CHECK(fact_revision>0),
 date TEXT NOT NULL,
 from_account_id TEXT REFERENCES fin_accounts(id),
 to_account_id TEXT REFERENCES fin_accounts(id),
 source_kind TEXT CHECK(source_kind IN ('income','expense')),
 source_key TEXT,
 source_basis TEXT,
 payload TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 deleted_at TEXT,
 CHECK(from_account_id IS NOT NULL OR to_account_id IS NOT NULL),
 CHECK(from_account_id IS NULL OR to_account_id IS NULL OR from_account_id<>to_account_id),
 CHECK((source_kind IS NULL AND source_key IS NULL AND source_basis IS NULL) OR (source_kind IS NOT NULL AND source_key IS NOT NULL AND source_basis IS NOT NULL))
);
CREATE INDEX cash_movements_date ON cash_movements(date,id);
CREATE UNIQUE INDEX cash_movements_source ON cash_movements(source_kind,source_key) WHERE deleted_at IS NULL AND source_key IS NOT NULL;
CREATE TABLE investment_flow_sources (
 flow_id TEXT PRIMARY KEY REFERENCES investment_flows(id),
 mode TEXT NOT NULL CHECK(mode IN ('manual','movements')),
 draft TEXT NOT NULL,
 basis_key TEXT NOT NULL,
 needs_review INTEGER NOT NULL CHECK(needs_review IN (0,1))
);
CREATE TABLE planning_flow_audit (
 id INTEGER PRIMARY KEY,
 entity_kind TEXT NOT NULL CHECK(entity_kind IN ('movement','review')),
 entity_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 before_value TEXT NOT NULL,
 after_value TEXT NOT NULL,
 created_at TEXT NOT NULL
);
PRAGMA user_version=39;
