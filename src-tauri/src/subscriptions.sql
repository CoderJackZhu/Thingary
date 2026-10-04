-- Additive migration: NULL retains the existing scheduling/price semantics.
ALTER TABLE recurring_plans ADD COLUMN service_start TEXT;
ALTER TABLE recurring_plans ADD COLUMN coverage_start TEXT;
ALTER TABLE plan_payments ADD COLUMN coverage_start TEXT;
ALTER TABLE plan_payments ADD COLUMN coverage_end TEXT;
CREATE TABLE plan_rates(
 plan_id TEXT NOT NULL REFERENCES recurring_plans(id) ON DELETE CASCADE,
 effective_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 PRIMARY KEY(plan_id,effective_date)
);
PRAGMA user_version=21;
