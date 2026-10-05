-- Schema 22: virtual asset labels & billing (VIRTUAL_ASSET_BILLING_DESIGN).
-- Additive where possible; virtual_assets and reminders rebuild only to widen
-- their kind CHECK. Old values, IDs and references are carried over verbatim.
-- Label scope: which domains may pick the label. Existing labels stay physical.
CREATE TABLE label_scopes(label_id TEXT PRIMARY KEY REFERENCES named_choices(id),scope TEXT NOT NULL CHECK(scope IN ('physical','virtual','both')));
INSERT INTO label_scopes(label_id,scope) SELECT id,'physical' FROM named_choices WHERE kind='label';
-- Subscription extensions: fixed-day periods, free trial, per-period special ends.
-- NULL keeps the legacy calendar-month, no-trial semantics.
ALTER TABLE recurring_plans ADD COLUMN interval_days INTEGER CHECK(interval_days IS NULL OR interval_days BETWEEN 1 AND 3650);
ALTER TABLE recurring_plans ADD COLUMN trial_days INTEGER CHECK(trial_days IS NULL OR trial_days BETWEEN 1 AND 3650);
CREATE TABLE plan_period_ends(plan_id TEXT NOT NULL REFERENCES recurring_plans(id) ON DELETE CASCADE,period_start TEXT NOT NULL,coverage_end TEXT NOT NULL,PRIMARY KEY(plan_id,period_start));
-- virtual_assets rebuilt: kind gains the neutral 'general' value, billing mode
-- and the single nullable virtual label join. plan-linked rows bill as
-- subscription, everything else stays a one-time spend.
CREATE TABLE virtual_assets_v22(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('license','domain','subscription','general')),provider TEXT NOT NULL,purchase_date TEXT,price_cents INTEGER CHECK(price_cents BETWEEN 0 AND 99999999999),expires TEXT,plan_id TEXT REFERENCES recurring_plans(id),url TEXT NOT NULL,notes TEXT NOT NULL,stopped_on TEXT,revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,billing TEXT NOT NULL CHECK(billing IN ('single','subscription','topup')),label_id TEXT REFERENCES named_choices(id),pay_method TEXT NOT NULL DEFAULT '',perpetual INTEGER NOT NULL DEFAULT 0 CHECK(perpetual IN (0,1)),CHECK(plan_id IS NULL OR (kind!='license' AND price_cents IS NULL AND expires IS NULL)),CHECK((plan_id IS NOT NULL)=(billing='subscription')),CHECK(billing!='topup' OR (kind='general' AND price_cents IS NULL)),CHECK(perpetual=0 OR (billing='single' AND expires IS NULL)));
INSERT INTO virtual_assets_v22(id,name,kind,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,revision,created_at,updated_at,deleted_at,billing,label_id,pay_method,perpetual) SELECT id,name,kind,provider,purchase_date,price_cents,expires,plan_id,url,notes,stopped_on,revision,created_at,updated_at,deleted_at,CASE WHEN plan_id IS NOT NULL THEN 'subscription' ELSE 'single' END,NULL,'',kind='license' AND expires IS NULL FROM virtual_assets;
DROP TABLE virtual_assets;
ALTER TABLE virtual_assets_v22 RENAME TO virtual_assets;
CREATE UNIQUE INDEX virtual_assets_plan ON virtual_assets(plan_id) WHERE plan_id IS NOT NULL AND deleted_at IS NULL;
-- Stored-value facts: each topup is its own spend source; balances are dated
-- manual check-ins, never derived or spent down automatically.
CREATE TABLE virtual_topups(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES virtual_assets(id),topup_date TEXT,paid_cents INTEGER CHECK(paid_cents BETWEEN 0 AND 99999999999),gift_cents INTEGER CHECK(gift_cents BETWEEN 0 AND 99999999999),credit_cents INTEGER CHECK(credit_cents BETWEEN 0 AND 99999999999),pay_method TEXT NOT NULL,notes TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,CHECK(paid_cents IS NOT NULL OR gift_cents IS NOT NULL OR credit_cents IS NOT NULL));
CREATE INDEX virtual_topups_asset ON virtual_topups(asset_id,topup_date);
CREATE TABLE virtual_balances(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES virtual_assets(id),balance_cents INTEGER NOT NULL CHECK(balance_cents BETWEEN 0 AND 99999999999),recorded_on TEXT NOT NULL,notes TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
CREATE INDEX virtual_balances_asset ON virtual_balances(asset_id,recorded_on);
-- Renewal reminders are opt-in one-shot reminders on a virtual asset.
CREATE TABLE reminders_v22(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('warranty','wishlist','renewal')),entity_id TEXT NOT NULL,source_id TEXT,date TEXT NOT NULL,notes TEXT NOT NULL);
INSERT INTO reminders_v22 SELECT id,kind,entity_id,source_id,date,notes FROM reminders;
DROP TABLE reminders;
ALTER TABLE reminders_v22 RENAME TO reminders;
PRAGMA user_version=22;
