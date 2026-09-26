import sqlite3,json,pathlib,hashlib,zipfile,datetime,statistics
root=pathlib.Path.home()/'Library/Application Support/local.possio.t21.release/library'
a=json.loads((root/'active.json').read_text());ds=root/'datasets'/a['id'];db=sqlite3.connect(f'file:{ds}/data.sqlite?mode=ro',uri=True);db.row_factory=sqlite3.Row
rows=[dict(r) for r in db.execute('select * from assets where deleted_at is null')]; held=[r for r in rows if r['lifecycle_state']!='sold']; dates=[(datetime.date(2026,9,26)-datetime.date.fromisoformat(r['purchase_date'])).days+1 for r in held if r['purchase_date']]
out={'dataset':a,'integrity':db.execute('pragma integrity_check').fetchone()[0],'foreign_key_errors':list(db.execute('pragma foreign_key_check')),'held':len(held),'held_price_cents':sum(r['price_cents'] or 0 for r in held),'held_unknown_price':sum(r['price_cents'] is None for r in held),'historical_price_cents':sum(r['price_cents'] or 0 for r in rows),'held_days_mean':statistics.mean(dates),'held_days_median':statistics.median(dates),'held_unknown_date':sum(r['purchase_date'] is None for r in held),'repurchase':[dict(r) for r in db.execute("select a.*,s.date sale_date,s.price_cents sale_price from assets a left join sales s on s.asset_id=a.id and s.revoked_at is null where a.name='iPad Air 4'")]}
for t in ['assets','wishlist_items','maintenances','warranties','attachments']:
 try:out[t]=db.execute('select count(*) from '+t).fetchone()[0]
 except sqlite3.OperationalError:pass
z=zipfile.ZipFile('/tmp/possio-t21/物志备份-20260926-1438.possio');m=json.loads(z.read('manifest.json'))
for name,e in m['entries'].items():
 b=z.read(name);assert len(b)==e['size'] and hashlib.sha256(b).hexdigest()==e['hash']
out['backup_manifest_entries']=len(m['entries']);out['original_files']=len([n for n in m['entries'] if n.startswith('files/')]);out['backup_bytes']=pathlib.Path(z.filename).stat().st_size
z.extract('data.sqlite','/tmp/possio-t21/backup-unpacked')
b=sqlite3.connect('/tmp/possio-t21/backup-unpacked/data.sqlite');out['backup_integrity']=b.execute('pragma integrity_check').fetchone()[0]
# Independent baseline before the native buyback: exclude only its observed new ID.
prior = [r for r in held if r['id'] != '1e7dfc48-0ea1-410a-adc3-3b3b5059584f']
prior_days = [(datetime.date(2026,9,26)-datetime.date.fromisoformat(r['purchase_date'])).days+1 for r in prior if r['purchase_date']]
out['before_buyback']={'held':len(prior),'held_price_cents':sum(r['price_cents'] or 0 for r in prior),'days_mean':statistics.mean(prior_days),'days_median':statistics.median(prior_days),'days_max':max(prior_days)}
assert out['before_buyback'] == {'held':15,'held_price_cents':3921550,'days_mean':688.7,'days_median':516.0,'days_max':2054}
assert out['held'] == 16 and out['held_price_cents'] == 4021550 and out['historical_price_cents'] == 4501450
old,new=sorted(out['repurchase'],key=lambda x:x['purchase_date'])
assert old['id']!=new['id'] and old['lifecycle_state']=='sold' and new['lifecycle_state']=='active'
assert old['sale_price']==180000 and new['sale_price'] is None
out['buyback_costs']={'old_investment':479900,'old_recovery':180000,'old_net':299900,'old_days':1412,'new_investment':100000,'new_days':1}
assert db.execute('select sum(cost_cents) from maintenances where asset_id=? and deleted_at is null',(old['id'],)).fetchone()[0]==0
assert db.execute('select count(*) from maintenances where asset_id=?',(new['id'],)).fetchone()[0]==0

print(json.dumps(out,ensure_ascii=False,indent=2))
