-- Original-currency amount of an expense, income or wish estimate. The record's own CNY column stays what every calculation reads.
CREATE TABLE amount_origin(
 kind TEXT NOT NULL CHECK(kind IN ('expense','income','wish')),
 record_id TEXT NOT NULL,
 currency TEXT NOT NULL CHECK(length(currency)=3 AND currency!='CNY'),
 original_minor INTEGER NOT NULL CHECK(original_minor>=0),
 fx_rate_micro INTEGER NOT NULL CHECK(fx_rate_micro>0),
 PRIMARY KEY(kind,record_id)
);
PRAGMA user_version=46;
