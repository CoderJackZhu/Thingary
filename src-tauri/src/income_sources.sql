-- Actual income facts keep IDs, amounts, revisions and original receipt fingerprints.
ALTER TABLE plan_income ADD COLUMN category TEXT NOT NULL DEFAULT 'unclassified' CHECK(category IN ('unclassified','non_investment','interest','cash_dividend','other_investment'));
ALTER TABLE plan_income ADD COLUMN source_account_id TEXT REFERENCES fin_accounts(id);
ALTER TABLE plan_income ADD COLUMN destination TEXT CHECK(destination IN ('retained','transferred','unknown'));
ALTER TABLE plan_income ADD COLUMN receiving_account_id TEXT REFERENCES fin_accounts(id);
ALTER TABLE plan_income ADD COLUMN classification_changed INTEGER NOT NULL DEFAULT 0 CHECK(classification_changed IN (0,1));
