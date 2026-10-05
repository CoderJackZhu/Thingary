-- Existing dated reminders remain one-shot; recurring reminders are opt-in.
ALTER TABLE reminders ADD COLUMN repeat_every_period INTEGER NOT NULL DEFAULT 0 CHECK(repeat_every_period IN (0,1) AND (repeat_every_period=0 OR kind='renewal'));
ALTER TABLE reminders ADD COLUMN lead_days INTEGER NOT NULL DEFAULT 3 CHECK(lead_days BETWEEN 0 AND 30);
PRAGMA user_version=26;
