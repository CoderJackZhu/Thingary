-- Schema 37 investment interval summaries. Original endpoint content survives
-- later corrections or permanent endpoint removal; these are audit references,
-- not ownership foreign keys. Current results always reread live facts.
CREATE TABLE investment_flows (
 id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL CHECK(revision>0),
 from_snapshot_id TEXT NOT NULL,
 to_snapshot_id TEXT NOT NULL,
 from_date TEXT NOT NULL,
 to_date TEXT NOT NULL CHECK(to_date>from_date),
 scope_key TEXT NOT NULL,
 payload TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 deleted_at TEXT
);
CREATE INDEX investment_flows_interval ON investment_flows(scope_key,from_date,to_date) WHERE deleted_at IS NULL;
