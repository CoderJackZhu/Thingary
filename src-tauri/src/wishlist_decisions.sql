-- Schema 27: wishes become purchase considerations and decisions
-- (LOW_FREQUENCY_REVIEW_DESIGN §3, §8). decision_state is the single
-- authority; the old status column stays only as a compatibility
-- projection (ongoing/achieved/abandoned) so pre-27 triggers and readers
-- keep their invariants. Old savings fields are never dropped.
ALTER TABLE wishlist_items ADD COLUMN decision_state TEXT NOT NULL DEFAULT 'considering';
ALTER TABLE wishlist_items ADD COLUMN decision_note TEXT NOT NULL DEFAULT '';
ALTER TABLE wishlist_items ADD COLUMN purchase_source TEXT;
ALTER TABLE wishlist_items ADD COLUMN legacy_generated_asset_id TEXT REFERENCES assets(id);
ALTER TABLE wishlist_items ADD COLUMN legacy_generated_at TEXT;
UPDATE wishlist_items SET decision_state=CASE
  WHEN status='abandoned' THEN 'dropped'
  WHEN status='achieved' AND converted_asset_id IS NOT NULL AND coalesce((SELECT json_extract(payload,'$.achievement_source') FROM wishlist_preferences WHERE wishlist_id=wishlist_items.id),'') IN ('manual','conversion') THEN 'purchased'
  WHEN status='achieved' THEN 'legacy_achieved'
  ELSE 'considering' END;
-- Auto/unknown-source achievements were never confirmed purchases: their
-- generated asset becomes a read-only historical relation. The old
-- achievement date moves with it, never rewritten as a confirmation date.
UPDATE wishlist_items SET legacy_generated_asset_id=converted_asset_id,purchase_source='legacy_auto' WHERE decision_state='legacy_achieved' AND converted_asset_id IS NOT NULL;
-- Every pending-verification row keeps its old achievement date as history,
-- including manual/conversion achievements whose link is already missing:
-- they cannot be confirmed purchases without an item, and the verify flow
-- offers the explicit backfill entry (record or link the purchase).
UPDATE wishlist_items SET legacy_generated_at=coalesce(legacy_generated_at,achieved_at) WHERE decision_state='legacy_achieved';
UPDATE wishlist_items SET converted_asset_id=NULL WHERE decision_state='legacy_achieved';
CREATE UNIQUE INDEX wishlist_one_legacy_generated ON wishlist_items(legacy_generated_asset_id) WHERE legacy_generated_asset_id IS NOT NULL;
-- Reminders exist only for wishes still being considered.
DELETE FROM reminders WHERE kind='wishlist' AND entity_id IN (SELECT id FROM wishlist_items WHERE decision_state!='considering');
-- The audit action CHECK widens for the new decision operations.
CREATE TABLE wishlist_audit_v27(sequence INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE,wishlist_id TEXT NOT NULL REFERENCES wishlist_items(id),action TEXT NOT NULL CHECK(action IN ('add','abandon','convert','drop','reconsider','link','verify_purchased','verify_considering','verify_dropped')),snapshot TEXT NOT NULL,created_at TEXT NOT NULL);
INSERT INTO wishlist_audit_v27 SELECT sequence,request_id,wishlist_id,action,snapshot,created_at FROM wishlist_audit;
DROP TABLE wishlist_audit;
ALTER TABLE wishlist_audit_v27 RENAME TO wishlist_audit;
PRAGMA user_version=27;
