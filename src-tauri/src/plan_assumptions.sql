-- Schema 38: confirmation history is server-owned, outside legacy profile DTOs.
CREATE TABLE plan_assumption_checks (
 id INTEGER PRIMARY KEY CHECK(id=1) REFERENCES plan_profile(id),
 confirmed_values TEXT NOT NULL,
 needs_review INTEGER NOT NULL CHECK(needs_review IN (0,1))
);
PRAGMA user_version=38;
