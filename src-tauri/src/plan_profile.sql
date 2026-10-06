-- Schema 30: planning module, stage 2 (PLANNING_DESIGN §5). One personal
-- profile with strictly validated JSON; the pension estimate itself is never
-- stored and is recomputed from this, the check-ins and the income rows.
CREATE TABLE plan_profile(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL);
PRAGMA user_version=30;
