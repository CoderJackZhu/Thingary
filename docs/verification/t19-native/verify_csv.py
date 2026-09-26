import csv, sqlite3, sys, json, os
root = os.path.expanduser("~/Library/Application Support/local.possio.t06b.preview/library")
ds = json.load(open(f"{root}/active.json"))["id"]
db = sqlite3.connect(f"file:{root}/datasets/{ds}/data.sqlite?mode=ro", uri=True)
raw = open(sys.argv[1], "rb").read()
assert raw.startswith(b"\xef\xbb\xbf"), "no BOM"
assert b"\r\n" in raw and raw.replace(b"\r\n", b"").count(b"\n") == raw.count(b"\n") - raw.count(b"\r\n")
rows = list(csv.reader(open(sys.argv[1], encoding="utf-8-sig", newline="")))
head, body = rows[0], rows[1:]
assert head == ["档案编号","名称","分类","品牌","型号","购入价（元）","币种","购入日期","渠道","状态","售出日期","售价（元）","备注"], head
def money(c): return "" if c is None else f"{'-' if c<0 else ''}{abs(c)//100}.{abs(c)%100:02d}"
def txt(v):
    v = v or ""
    return "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v
state = {"active": "使用中", "retired": "已退役", "sold": "已售出"}
expect = {}
for r in db.execute("""SELECT a.id, a.name, (SELECT name FROM categories WHERE id=a.category_id),
    p.brand, p.model, a.price_cents, a.purchase_date, (SELECT name FROM channels WHERE id=a.channel_id),
    a.lifecycle_state, p.notes FROM assets a LEFT JOIN asset_profiles p ON p.asset_id=a.id WHERE a.deleted_at IS NULL"""):
    sale = db.execute("SELECT date, price_cents FROM sales WHERE asset_id=? AND revoked_at IS NULL", (r[0],)).fetchall()
    assert len(sale) <= 1
    sd, sp = sale[0] if sale else (None, None)
    expect[r[0]] = [r[0], txt(r[1]), txt(r[2]), txt(r[3]), txt(r[4]), money(r[5]), "CNY", r[6] or "",
                    txt(r[7]), state.get(r[8], "使用中"), sd or "", money(sp), txt(r[9])]
got = {b[0]: b for b in body}
assert len(body) == len(got) == len(expect), (len(body), len(expect))
deleted = {x for (x,) in db.execute("SELECT id FROM assets WHERE deleted_at IS NOT NULL")}
assert not deleted & got.keys()
bad = [(k, expect[k], got.get(k)) for k in expect if expect[k] != got.get(k)]
for b in bad: print("MISMATCH", b)
assert not bad
st = {}
for b in body: st[b[9]] = st.get(b[9], 0) + 1
print(f"OK rows={len(body)} deleted_excluded={len(deleted)} states={st}",
      f"unknown_price={sum(b[5]=='' for b in body)} zero_price={sum(b[5]=='0.00' for b in body)}",
      f"unknown_date={sum(b[7]=='' for b in body)} sold_with_date={sum(b[10]!='' for b in body)} uncategorized={sum(b[2]=='' for b in body)}")
