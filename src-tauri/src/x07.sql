-- Schema 23: billing-rule segments (review R4) and a service-bounded end date (R2).
-- plan_rules keeps every effective coverage rule (anchor + period length) so a
-- later period/trial/anchor correction never rewrites historical estimates;
-- the initial row mirrors the schema-21/22 single-rule behaviour exactly.
CREATE TABLE plan_rules(
 plan_id TEXT NOT NULL REFERENCES recurring_plans(id) ON DELETE CASCADE,
 effective_date TEXT NOT NULL,
 anchor TEXT NOT NULL,
 interval_months INTEGER NOT NULL CHECK(interval_months IN (1,3,6,12)),
 interval_days INTEGER CHECK(interval_days IS NULL OR interval_days BETWEEN 1 AND 3650),
 PRIMARY KEY(plan_id,effective_date),
 CHECK((interval_days IS NULL) OR (interval_months=1))
);
INSERT INTO plan_rules(plan_id,effective_date,anchor,interval_months,interval_days)
 SELECT id,coalesce(service_start,first_due),coalesce(coverage_start,first_due),interval_months,interval_days FROM recurring_plans;
-- recurring_plans is rebuilt to relax the schema-17 CHECK(end_date>=first_due):
-- the lower bound for service-based plans is the service start, so a service
-- that ended inside a free trial can be stored as a zero-cost ended record.
CREATE TABLE recurring_plans_v23(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('rent','subscription','utilities','insurance','membership','other')),amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 99999999999),interval_months INTEGER NOT NULL CHECK(interval_months IN (1,3,6,12)),first_due TEXT NOT NULL,end_date TEXT,paused INTEGER NOT NULL CHECK(paused IN (0,1)),active_from TEXT NOT NULL,notes TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,service_start TEXT,coverage_start TEXT,interval_days INTEGER CHECK(interval_days IS NULL OR interval_days BETWEEN 1 AND 3650),trial_days INTEGER CHECK(trial_days IS NULL OR trial_days BETWEEN 1 AND 3650),CHECK(end_date IS NULL OR end_date>=CASE WHEN service_start IS NOT NULL THEN service_start ELSE first_due END));
INSERT INTO recurring_plans_v23 SELECT id,name,category,amount_cents,interval_months,first_due,end_date,paused,active_from,notes,revision,created_at,updated_at,deleted_at,service_start,coverage_start,interval_days,trial_days FROM recurring_plans;
DROP TABLE recurring_plans;
ALTER TABLE recurring_plans_v23 RENAME TO recurring_plans;
PRAGMA user_version=23;
