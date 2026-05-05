import sqlite3
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

from backend.database.schema import SCHEMA_SQL
from backend.database.encryption import get_key

CLIENTS_DIR = Path("clients")


def get_db_path(gstin: str) -> Path:
    return CLIENTS_DIR / gstin / "data.db"


def get_meta_path(gstin: str) -> Path:
    return CLIENTS_DIR / gstin / "data.db.meta"


def ensure_client_dir(gstin: str):
    (CLIENTS_DIR / gstin).mkdir(parents=True, exist_ok=True)


def get_connection(gstin: str) -> sqlite3.Connection:
    db_path = get_db_path(gstin)
    ensure_client_dir(gstin)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(gstin: str):
    conn = get_connection(gstin)
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()
    _init_meta(gstin)


def _init_meta(gstin: str):
    meta_path = get_meta_path(gstin)
    if not meta_path.exists():
        meta = {"gstin": gstin, "created_at": datetime.now().isoformat(), "periods": [], "last_import": None}
        with open(meta_path, "w") as f:
            json.dump(meta, f)


def read_meta(gstin: str) -> dict:
    meta_path = get_meta_path(gstin)
    if meta_path.exists():
        with open(meta_path, "r") as f:
            return json.load(f)
    return {}


def update_meta(gstin: str, updates: dict):
    meta = read_meta(gstin)
    meta.update(updates)
    with open(get_meta_path(gstin), "w") as f:
        json.dump(meta, f, indent=2)


def list_clients() -> List[dict]:
    clients = []
    if not CLIENTS_DIR.exists():
        return clients
    for d in CLIENTS_DIR.iterdir():
        if d.is_dir():
            meta = read_meta(d.name)
            if meta:
                clients.append(meta)
    return clients


def insert_batch(gstin: str, batch_data: dict) -> str:
    batch_id = str(uuid.uuid4())
    batch_data["batch_id"] = batch_id
    batch_data["import_ts"] = datetime.now().isoformat()
    conn = get_connection(gstin)
    conn.execute("""
        INSERT INTO import_batches
        (batch_id, import_ts, source_file, source_type, epr_software,
         company_gstin, financial_year, tax_period, row_count)
        VALUES (:batch_id, :import_ts, :source_file, :source_type, :epr_software,
                :company_gstin, :financial_year, :tax_period, :row_count)
    """, batch_data)
    conn.commit()
    conn.close()
    return batch_id


def insert_rows(gstin: str, table: str, rows: List[dict]):
    if not rows:
        return
    conn = get_connection(gstin)
    keys = rows[0].keys()
    placeholders = ", ".join([f":{k}" for k in keys])
    cols = ", ".join(keys)
    sql = f"INSERT OR REPLACE INTO {table} ({cols}) VALUES ({placeholders})"
    conn.executemany(sql, rows)
    conn.commit()
    conn.close()


def query_rows(gstin: str, table: str, filters: Optional[dict] = None,
               limit: int = 1000, offset: int = 0) -> List[dict]:
    conn = get_connection(gstin)
    where_clauses = []
    params = []
    if filters:
        for k, v in filters.items():
            if v:
                where_clauses.append(f"{k} = ?")
                params.append(v)
    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    rows = conn.execute(
        f"SELECT * FROM {table} {where_sql} LIMIT ? OFFSET ?",
        params + [limit, offset]
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def count_rows(gstin: str, table: str, filters: Optional[dict] = None) -> int:
    conn = get_connection(gstin)
    where_clauses = []
    params = []
    if filters:
        for k, v in filters.items():
            if v:
                where_clauses.append(f"{k} = ?")
                params.append(v)
    where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    count = conn.execute(f"SELECT COUNT(*) FROM {table} {where_sql}", params).fetchone()[0]
    conn.close()
    return count


def get_batches(gstin: str) -> List[dict]:
    conn = get_connection(gstin)
    rows = conn.execute("SELECT * FROM import_batches ORDER BY import_ts DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_periods(gstin: str) -> List[str]:
    conn = get_connection(gstin)
    rows = conn.execute(
        "SELECT DISTINCT tax_period FROM import_batches ORDER BY tax_period"
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]


def get_storage_size(gstin: str) -> int:
    db_path = get_db_path(gstin)
    return db_path.stat().st_size if db_path.exists() else 0


def vacuum_db(gstin: str):
    conn = get_connection(gstin)
    conn.execute("VACUUM")
    conn.close()


def save_column_mapping(gstin: str, mappings: List[dict]):
    conn = get_connection(gstin)
    for m in mappings:
        m["created_at"] = datetime.now().isoformat()
        existing = conn.execute(
            "SELECT id FROM column_mapping_registry WHERE raw_column_name=? AND source_type=? AND epr_software=?",
            (m.get("raw_column_name"), m.get("source_type"), m.get("epr_software", ""))
        ).fetchone()
        if existing:
            conn.execute("""
                UPDATE column_mapping_registry
                SET canonical_name=?, confidence_score=?, user_confirmed=?
                WHERE id=?
            """, (m.get("canonical_name"), m.get("confidence_score", 1.0),
                  int(m.get("user_confirmed", True)), existing[0]))
        else:
            conn.execute("""
                INSERT INTO column_mapping_registry
                (raw_column_name, canonical_name, source_type, epr_software,
                 confidence_score, user_confirmed, created_at)
                VALUES (:raw_column_name, :canonical_name, :source_type, :epr_software,
                        :confidence_score, :user_confirmed, :created_at)
            """, m)
    conn.commit()
    conn.close()


def get_saved_mappings(gstin: str, source_type: str, epr_software: str = "") -> Dict[str, str]:
    conn = get_connection(gstin)
    rows = conn.execute(
        """SELECT raw_column_name, canonical_name FROM column_mapping_registry
           WHERE source_type=? AND epr_software=? AND user_confirmed=1""",
        (source_type, epr_software)
    ).fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows}


def log_deletion(gstin: str, mode: str, detail: str, rows_deleted: int):
    conn = get_connection(gstin)
    conn.execute("""
        INSERT INTO deletion_log (deleted_at, gstin, mode, detail, rows_deleted, performed_by)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (datetime.now().isoformat(), gstin, mode, detail, rows_deleted, "CA User"))
    conn.commit()
    conn.close()


def get_deletion_log(gstin: str) -> List[dict]:
    conn = get_connection(gstin)
    rows = conn.execute("SELECT * FROM deletion_log ORDER BY deleted_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def insert_itc_summary(gstin: str, rows: List[dict]):
    if not rows:
        return
    conn = get_connection(gstin)
    for row in rows:
        conn.execute("""
            INSERT INTO itc_summary
            (batch_id, summary_type, heading, gstr3b_table, igst, cgst, sgst, cess)
            VALUES (:batch_id, :summary_type, :heading, :gstr3b_table, :igst, :cgst, :sgst, :cess)
        """, row)
    conn.commit()
    conn.close()
