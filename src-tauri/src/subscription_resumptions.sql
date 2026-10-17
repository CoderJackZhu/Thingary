-- Explicit boundaries keep ended service and later subscriptions under one ID.
CREATE TABLE plan_resumptions(
 plan_id TEXT NOT NULL REFERENCES recurring_plans(id),
 resumed_on TEXT NOT NULL,
 previous_end TEXT NOT NULL CHECK(previous_end < resumed_on),
 PRIMARY KEY(plan_id,resumed_on)
);
PRAGMA user_version=44;
