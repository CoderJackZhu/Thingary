-- Schema 28: a wish may name one item it is considering replacing
-- (LOW_FREQUENCY_REVIEW_DESIGN §7.1). The relation is independent of the
-- purchase link (converted_asset_id) and never blocks the item's own
-- lifecycle; when the item is purged the FK is cleared and the item's name
-- is kept here as the minimum display history of a stale relation.
ALTER TABLE wishlist_items ADD COLUMN replacement_asset_id TEXT REFERENCES assets(id);
ALTER TABLE wishlist_items ADD COLUMN replacement_asset_name TEXT NOT NULL DEFAULT '';
PRAGMA user_version=28;
