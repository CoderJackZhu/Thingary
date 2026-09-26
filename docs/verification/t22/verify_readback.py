"""Independent, read-only T22 temporary-library backup/CSV/restore comparison."""
import argparse
import csv
import hashlib
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path


def library_db(root: Path) -> Path:
    active = json.loads((root / "active.json").read_text())
    return root / "datasets" / active["id"] / "data.sqlite"


def connect(path: Path, immutable=False):
    suffix = "&immutable=1" if immutable else ""
    return sqlite3.connect(f"file:{path}?mode=ro{suffix}", uri=True)


def rows(db, table):
    assert table.replace("_", "").isalnum()
    return sorted(db.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)


def csv_text(value):
    value = value or ""
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def csv_money(cents):
    return "" if cents is None else f"{'-' if cents < 0 else ''}{abs(cents)//100}.{abs(cents)%100:02d}"


parser = argparse.ArgumentParser()
parser.add_argument("--backup", type=Path, required=True)
parser.add_argument("--csv", type=Path, required=True)
parser.add_argument("--restored-library", type=Path)
args = parser.parse_args()

with tempfile.TemporaryDirectory(prefix="possio-t22-readback-") as folder:
    with zipfile.ZipFile(args.backup) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        for name, meta in manifest["entries"].items():
            content = archive.read(name)
            assert len(content) == meta["size"]
            assert hashlib.sha256(content).hexdigest() == meta["hash"]
            target = Path(folder) / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    source = connect(Path(folder) / "data.sqlite", immutable=True)
    assert source.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert not source.execute("PRAGMA foreign_key_check").fetchall()

    with args.csv.open("rb") as handle:
        raw = handle.read()
    assert raw.startswith(b"\xef\xbb\xbf") and b"\r\n" in raw
    with args.csv.open(encoding="utf-8-sig", newline="") as handle:
        header, *actual = csv.reader(handle)
    assert header == ["档案编号", "名称", "分类", "品牌", "型号", "购入价（元）", "币种", "购入日期", "渠道", "状态", "售出日期", "售价（元）", "备注"]
    expected = {}
    assets = source.execute("""SELECT a.id, a.name, c.name, p.brand, p.model, a.price_cents,
        a.purchase_date, h.name, a.lifecycle_state, p.notes
        FROM assets a LEFT JOIN asset_profiles p ON p.asset_id = a.id
        LEFT JOIN categories c ON c.id = a.category_id
        LEFT JOIN channels h ON h.id = a.channel_id WHERE a.deleted_at IS NULL""").fetchall()
    for asset in assets:
        sale = source.execute("SELECT date, price_cents FROM sales WHERE asset_id=? AND revoked_at IS NULL", (asset[0],)).fetchall()
        assert len(sale) <= 1
        date, price = sale[0] if sale else (None, None)
        expected[asset[0]] = [asset[0], csv_text(asset[1]), csv_text(asset[2]), csv_text(asset[3]),
                              csv_text(asset[4]), csv_money(asset[5]), "CNY", asset[6] or "",
                              csv_text(asset[7]), {"active": "使用中", "retired": "已退役", "sold": "已售出"}[asset[8]],
                              date or "", csv_money(price), csv_text(asset[9])]
    assert len(actual) == len(expected)
    assert {row[0]: row for row in actual} == expected

    result = {"manifest_entries_verified": len(manifest["entries"]), "csv_rows_verified": len(actual),
              "backup_asset_rows": source.execute("SELECT count(*) FROM assets").fetchone()[0],
              "backup_integrity": "ok", "backup_foreign_key_errors": 0}
    if args.restored_library:
        target = connect(library_db(args.restored_library))
        assert target.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not target.execute("PRAGMA foreign_key_check").fetchall()
        tables = [item[0] for item in source.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for table in tables:
            assert rows(source, table) == rows(target, table), table
        result["restored_tables_identical"] = len(tables)
        result["restored_foreign_key_errors"] = 0
    print(json.dumps(result, ensure_ascii=False, indent=2))
