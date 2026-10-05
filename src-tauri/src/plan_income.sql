-- Schema 29: planning module, stage 1 (PLANNING_DESIGN §3, §4.3).
-- One row per month's actual arrival: after-tax pay and housing fund deposit.
-- Not a ledger and not classified by source.
CREATE TABLE plan_income(id TEXT PRIMARY KEY,date TEXT NOT NULL,net_cents INTEGER NOT NULL CHECK(net_cents BETWEEN 0 AND 99999999999),hpf_cents INTEGER NOT NULL CHECK(hpf_cents BETWEEN 0 AND 99999999999),notes TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
CREATE INDEX plan_income_date ON plan_income(date);
-- A check-in whose interval is a one-off change and stays out of the usual
-- savings. Presence of a row means excluded; it never alters the check-in.
CREATE TABLE plan_baseline_marks(snapshot_id TEXT PRIMARY KEY REFERENCES fin_snapshots(id));
PRAGMA user_version=29;
