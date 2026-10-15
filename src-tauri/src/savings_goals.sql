-- Schema 42: reference goals, never a second source of account balances.
CREATE TABLE savings_goals (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 target_cents INTEGER NOT NULL CHECK(target_cents BETWEEN 1 AND 99999999999),
 target_date TEXT,
 notes TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>=0),
 revision INTEGER NOT NULL CHECK(revision>0),
 created_on TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 deleted_at TEXT
);
CREATE TABLE savings_goal_accounts (
 goal_id TEXT NOT NULL REFERENCES savings_goals(id),
 account_id TEXT NOT NULL REFERENCES fin_accounts(id),
 PRIMARY KEY(goal_id,account_id)
);
CREATE INDEX savings_goal_account ON savings_goal_accounts(account_id);
PRAGMA user_version=42;
