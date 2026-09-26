"""Read-only comparison of the release backup with the isolated restored library."""
import hashlib, json, pathlib, sqlite3
base = pathlib.Path.home() / 'Library/Application Support/local.possio.t21.empty/library'
active = json.loads((base / 'active.json').read_text())
dataset = base / 'datasets' / active['id']
a = sqlite3.connect('file:/tmp/possio-t21/backup-unpacked/data.sqlite?mode=ro', uri=True)
b = sqlite3.connect(f'file:{dataset}/data.sqlite?mode=ro', uri=True)
tables = [r[0] for r in a.execute("select name from sqlite_master where type='table'")]
counts = {}
for table in tables:
    assert table.replace('_', '').isalnum()
    left = sorted(a.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
    right = sorted(b.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
    assert left == right, table
    counts[table] = len(left)
assert b.execute('pragma integrity_check').fetchone()[0] == 'ok'
assert not b.execute('pragma foreign_key_check').fetchall()
files = a.execute('select distinct file,hash,size from attachments union select distinct file,hash,size from wishlist_attachments').fetchall()
for file, digest, size in files:
    content = (dataset / 'files' / file).read_bytes()
    assert len(content) == size and hashlib.sha256(content).hexdigest() == digest
print(json.dumps({'active': active, 'all_tables_identical': counts, 'referenced_originals_verified': len(files), 'integrity':'ok', 'foreign_key_errors':0,'protection_copies':len(list((base/'protection').glob('*.possio')))}, ensure_ascii=False, indent=2))
