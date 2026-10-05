-- Schema 24: persist independent renewal state and complete billing-rule history.
ALTER TABLE recurring_plans ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 1 CHECK(auto_renew IN (0,1));
ALTER TABLE plan_rules ADD COLUMN first_due TEXT;
ALTER TABLE plan_rules ADD COLUMN service_start TEXT;
ALTER TABLE plan_rules ADD COLUMN trial_days INTEGER CHECK(trial_days IS NULL OR trial_days BETWEEN 1 AND 3650);
UPDATE plan_rules SET first_due=(SELECT first_due FROM recurring_plans WHERE id=plan_id),service_start=(SELECT service_start FROM recurring_plans WHERE id=plan_id),trial_days=(SELECT trial_days FROM recurring_plans WHERE id=plan_id);
-- Single-segment v23 preview libraries can recover their original fixed-day rule.
UPDATE plan_rules SET interval_days=(SELECT interval_days FROM recurring_plans WHERE id=plan_id) WHERE (SELECT count(*) FROM plan_rules r WHERE r.plan_id=plan_rules.plan_id)=1;
PRAGMA user_version=24;
