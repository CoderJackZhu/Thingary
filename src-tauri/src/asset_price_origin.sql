-- Original-currency price of an item. `assets.price_cents` stays the converted CNY amount used by every calculation.
CREATE TABLE asset_price_origin(
 asset_id TEXT PRIMARY KEY REFERENCES assets(id),
 currency TEXT NOT NULL CHECK(length(currency)=3 AND currency!='CNY'),
 original_minor INTEGER NOT NULL CHECK(original_minor>=0),
 fx_rate_micro INTEGER NOT NULL CHECK(fx_rate_micro>0)
);
PRAGMA user_version=45;
