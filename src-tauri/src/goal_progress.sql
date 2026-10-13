-- Schema 40: the goal conclusion as it stood when a complete check-in was first
-- viewed. A derived record, never an asset fact: it changes no balance, and a
-- corrected check-in (higher revision) simply replaces its stale record.
CREATE TABLE goal_progress (
 snapshot_id TEXT PRIMARY KEY REFERENCES fin_snapshots(id),
 snapshot_revision INTEGER NOT NULL CHECK(snapshot_revision>0),
 recorded_on TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 created_at TEXT NOT NULL
);
PRAGMA user_version=40;
