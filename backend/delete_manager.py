from pathlib import Path
from typing import Optional, List, Dict

from backend.database.db_manager import (
    get_connection, vacuum_db, log_deletion, get_db_path, get_meta_path
)
from backend.deletion.secure_wipe import secure_wipe, file_sha256
from backend.deletion.certificate import generate_certificate_pdf
from backend.database.encryption import delete_key


def _count_before_delete(conn, table: str, where: str, params: list) -> int:
    row = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", params).fetchone()
    return row[0] if row else 0


def delete_period(gstin: str, source_type: str, tax_period: str) -> Dict:
    conn = get_connection(gstin)
    records_deleted = []

    if source_type == "2B":
        tables = ["gstr2b_b2b", "gstr2b_b2ba", "gstr2b_cdnr", "gstr2b_impg", "gstr2b_isd"]
    else:
        tables = ["purchase_register"]

    batch_ids = [
        r[0] for r in conn.execute(
            "SELECT batch_id FROM import_batches WHERE source_type=? AND tax_period=?",
            (source_type, tax_period)
        ).fetchall()
    ]

    for table in tables:
        for bid in batch_ids:
            count = _count_before_delete(conn, table, "batch_id=?", [bid])
            if count > 0:
                conn.execute(f"DELETE FROM {table} WHERE batch_id=?", (bid,))
                records_deleted.append({"table": table, "period": tax_period, "rows": count})

    batch_count = conn.execute(
        "SELECT COUNT(*) FROM import_batches WHERE source_type=? AND tax_period=?",
        (source_type, tax_period)
    ).fetchone()[0]
    conn.execute(
        "DELETE FROM import_batches WHERE source_type=? AND tax_period=?",
        (source_type, tax_period)
    )
    records_deleted.append({"table": "import_batches", "period": tax_period, "rows": batch_count})

    conn.commit()
    conn.close()
    vacuum_db(gstin)
    log_deletion(gstin, "period", f"{source_type} {tax_period}", sum(r["rows"] for r in records_deleted))
    return {"records_deleted": records_deleted}


def delete_all_pr(gstin: str) -> Dict:
    conn = get_connection(gstin)
    records_deleted = []

    count = _count_before_delete(conn, "purchase_register", "1=1", [])
    conn.execute("DELETE FROM purchase_register")
    records_deleted.append({"table": "purchase_register", "period": "ALL", "rows": count})

    batch_count = conn.execute(
        "SELECT COUNT(*) FROM import_batches WHERE source_type='PR'"
    ).fetchone()[0]
    conn.execute("DELETE FROM import_batches WHERE source_type='PR'")
    records_deleted.append({"table": "import_batches", "period": "ALL PR", "rows": batch_count})

    conn.commit()
    conn.close()
    vacuum_db(gstin)
    log_deletion(gstin, "full_pr", "All PR data", sum(r["rows"] for r in records_deleted))
    return {"records_deleted": records_deleted}


def delete_all_client(gstin: str) -> Dict:
    conn = get_connection(gstin)
    records_deleted = []

    all_tables = [
        "gstr2b_b2b", "gstr2b_b2ba", "gstr2b_cdnr", "gstr2b_impg",
        "gstr2b_isd", "purchase_register", "itc_summary",
        "reconciliation_results", "column_mapping_registry"
    ]
    for table in all_tables:
        try:
            count = _count_before_delete(conn, table, "1=1", [])
            conn.execute(f"DELETE FROM {table}")
            records_deleted.append({"table": table, "period": "ALL", "rows": count})
        except Exception:
            pass

    batch_count = conn.execute("SELECT COUNT(*) FROM import_batches").fetchone()[0]
    conn.execute("DELETE FROM import_batches")
    records_deleted.append({"table": "import_batches", "period": "ALL", "rows": batch_count})

    conn.commit()
    conn.close()
    vacuum_db(gstin)
    log_deletion(gstin, "full_client", "All client data", sum(r["rows"] for r in records_deleted))
    return {"records_deleted": records_deleted}


def nuclear_delete(gstin: str, cert_output_path: Optional[str] = None,
                   client_name: str = "", ca_firm: str = "CA Firm") -> Dict:
    db_path = str(get_db_path(gstin))
    meta_path = str(get_meta_path(gstin))

    pre_wipe_hash = ""
    try:
        pre_wipe_hash = file_sha256(db_path)
    except Exception:
        pass

    deleted_result = delete_all_client(gstin)

    cert_path = None
    if cert_output_path:
        cert_path = generate_certificate_pdf(
            output_path=cert_output_path,
            gstin=gstin,
            client_name=client_name,
            deleted_records=deleted_result["records_deleted"],
            deletion_method="SQL DELETE + VACUUM + 3-pass overwrite",
            pre_wipe_hash=pre_wipe_hash,
            ca_firm=ca_firm,
        )

    try:
        secure_wipe(db_path, passes=3)
    except Exception:
        pass

    try:
        Path(meta_path).unlink(missing_ok=True)
    except Exception:
        pass

    delete_key(gstin)

    return {
        "records_deleted": deleted_result["records_deleted"],
        "pre_wipe_hash": pre_wipe_hash,
        "cert_path": cert_path,
    }


def preview_deletion(gstin: str, mode: str, source_type: str = "", tax_period: str = "") -> Dict:
    conn = get_connection(gstin)
    preview = {"rows": {}, "total_rows": 0, "size_mb": 0}

    db_path = get_db_path(gstin)
    if db_path.exists():
        preview["size_mb"] = round(db_path.stat().st_size / (1024 * 1024), 2)

    if mode == "period":
        tables = ["gstr2b_b2b", "gstr2b_b2ba", "gstr2b_cdnr", "gstr2b_impg", "gstr2b_isd"] \
            if source_type == "2B" else ["purchase_register"]
        batch_ids = [
            r[0] for r in conn.execute(
                "SELECT batch_id FROM import_batches WHERE source_type=? AND tax_period=?",
                (source_type, tax_period)
            ).fetchall()
        ]
        for table in tables:
            count = 0
            for bid in batch_ids:
                count += _count_before_delete(conn, table, "batch_id=?", [bid])
            preview["rows"][table] = count
    elif mode == "full_pr":
        preview["rows"]["purchase_register"] = _count_before_delete(conn, "purchase_register", "1=1", [])
    elif mode in ("full_client", "nuclear"):
        for table in ["gstr2b_b2b", "gstr2b_b2ba", "gstr2b_cdnr", "gstr2b_impg",
                      "gstr2b_isd", "purchase_register"]:
            try:
                preview["rows"][table] = _count_before_delete(conn, table, "1=1", [])
            except Exception:
                pass

    preview["total_rows"] = sum(preview["rows"].values())
    conn.close()
    return preview
