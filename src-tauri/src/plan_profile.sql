-- Schema 30 introduced the single profile payload. Schema 36 converts legacy
-- policy inputs to general planning fields; policy estimates are not active.
CREATE TABLE plan_profile(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL);
PRAGMA user_version=30;
