import os
import sys
import uuid
import json
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

sys.path.insert(0, str(Path(__file__).parent))

from backend.ingestion.detector import detect_file_type, get_sheet_names
from backend.ingestion.parser_2b import parse_2b
from backend.ingestion.parser_epr import detect_header_row, parse_epr
from backend.ingestion.canonical_map import map_columns
from backend.database.db_manager import (
    init_db, list_clients, insert_batch, insert_rows, query_rows, count_rows,
    get_batches, get_periods, get_storage_size, save_column_mapping,
    get_saved_mappings, log_deletion, insert_itc_summary, update_meta,
    read_meta, get_connection, vacuum_db
)
from backend.deletion.delete_manager import (
    delete_period, delete_all_pr, delete_all_client, nuclear_delete, preview_deletion
)
from backend.deletion.secure_wipe import file_sha256
from backend.reconciliation.plugin_runner import list_plugins, run_plugin_by_name, register_plugin

app = Flask(__name__)
CORS(app)


def ok(data=None):
    return jsonify({"success": True, "data": data})


def err(msg, code=400):
    return jsonify({"success": False, "error": msg}), code


# ─── Clients ─────────────────────────────────────────────────────────────────

@app.route("/clients", methods=["GET"])
def api_list_clients():
    return ok(list_clients())


@app.route("/clients/<gstin>/init", methods=["POST"])
def api_init_client(gstin):
    init_db(gstin)
    body = request.json or {}
    update_meta(gstin, {"gstin": gstin, "legal_name": body.get("legal_name", "")})
    return ok({"gstin": gstin})


@app.route("/clients/<gstin>/meta", methods=["GET"])
def api_get_meta(gstin):
    return ok(read_meta(gstin))


@app.route("/clients/<gstin>/periods", methods=["GET"])
def api_get_periods(gstin):
    return ok(get_periods(gstin))


@app.route("/clients/<gstin>/storage", methods=["GET"])
def api_get_storage(gstin):
    return ok({"bytes": get_storage_size(gstin)})


@app.route("/clients/<gstin>/batches", methods=["GET"])
def api_get_batches(gstin):
    return ok(get_batches(gstin))


# ─── File detection ──────────────────────────────────────────────────────────

@app.route("/detect", methods=["POST"])
def api_detect():
    body = request.json
    path = body.get("path")
    if not path or not Path(path).exists():
        return err("File not found")
    file_type = detect_file_type(path)
    sheets = get_sheet_names(path)
    return ok({"file_type": file_type, "sheets": sheets})


# ─── 2B Parsing ──────────────────────────────────────────────────────────────

@app.route("/import/2b", methods=["POST"])
def api_import_2b():
    body = request.json
    path = body.get("path")
    gstin = body.get("gstin")
    if not path or not gstin:
        return err("path and gstin required")
    if not Path(path).exists():
        return err("File not found")

    init_db(gstin)
    batch_id = str(uuid.uuid4())

    meta, all_data, itc_summaries = parse_2b(path, batch_id)
    total_rows = sum(len(v) for v in all_data.values())

    batch = {
        "batch_id": batch_id,
        "source_file": Path(path).name,
        "source_type": "2B",
        "epr_software": "",
        "company_gstin": meta.get("company_gstin", gstin),
        "financial_year": meta.get("financial_year", ""),
        "tax_period": meta.get("tax_period", ""),
        "row_count": total_rows,
    }
    insert_batch(gstin, batch)

    for table, rows in all_data.items():
        insert_rows(gstin, table, rows)

    if itc_summaries:
        insert_itc_summary(gstin, itc_summaries)

    update_meta(gstin, {
        "last_import": batch["import_ts"] if "import_ts" in batch else None,
        "legal_name": meta.get("legal_name", ""),
    })

    return ok({
        "batch_id": batch_id,
        "meta": meta,
        "row_counts": {t: len(r) for t, r in all_data.items()},
        "total_rows": total_rows,
        "itc_summary_rows": len(itc_summaries),
    })


# ─── EPR Parsing ─────────────────────────────────────────────────────────────

@app.route("/import/epr/detect-header", methods=["POST"])
def api_detect_header():
    body = request.json
    path = body.get("path")
    sheet_name = body.get("sheet_name")
    if not path or not Path(path).exists():
        return err("File not found")

    wb_sheets = get_sheet_names(path)
    sheet = sheet_name or wb_sheets[0]
    row_idx, score, candidates = detect_header_row(path, sheet)
    return ok({"header_row_index": row_idx, "score": score, "candidates": [
        {"row_index": c["row_index"], "score": c["score"]} for c in candidates
    ]})


@app.route("/import/epr/map-columns", methods=["POST"])
def api_map_columns():
    body = request.json
    raw_columns = body.get("raw_columns", [])
    return ok(map_columns(raw_columns))


@app.route("/import/epr", methods=["POST"])
def api_import_epr():
    body = request.json
    path = body.get("path")
    gstin = body.get("gstin")
    epr_software = body.get("epr_software", "Unknown")
    header_row_idx = body.get("header_row_index", 0)
    col_mapping = body.get("col_mapping", {})
    tax_period = body.get("tax_period", "")
    financial_year = body.get("financial_year", "")

    if not path or not gstin:
        return err("path and gstin required")
    if not Path(path).exists():
        return err("File not found")

    init_db(gstin)
    batch_id = str(uuid.uuid4())

    rows = parse_epr(path, batch_id, epr_software, header_row_idx, col_mapping)
    batch = {
        "batch_id": batch_id,
        "source_file": Path(path).name,
        "source_type": "PR",
        "epr_software": epr_software,
        "company_gstin": gstin,
        "financial_year": financial_year,
        "tax_period": tax_period,
        "row_count": len(rows),
    }
    insert_batch(gstin, batch)
    insert_rows(gstin, "purchase_register", rows)

    mappings = [
        {
            "raw_column_name": raw,
            "canonical_name": canonical,
            "source_type": "PR",
            "epr_software": epr_software,
            "confidence_score": 1.0,
            "user_confirmed": 1,
        }
        for raw, canonical in col_mapping.items() if canonical
    ]
    if mappings:
        save_column_mapping(gstin, mappings)

    return ok({"batch_id": batch_id, "row_count": len(rows)})


# ─── Data Browser ────────────────────────────────────────────────────────────

@app.route("/clients/<gstin>/data/<source_type>", methods=["GET"])
def api_browse_data(gstin, source_type):
    table = "purchase_register" if source_type == "PR" else "gstr2b_b2b"
    filters = {
        k: request.args.get(k)
        for k in ["batch_id", "supplier_gstin", "invoice_number", "recon_status", "tax_period"]
        if request.args.get(k)
    }
    limit = int(request.args.get("limit", 500))
    offset = int(request.args.get("offset", 0))
    rows = query_rows(gstin, table, filters, limit, offset)
    total = count_rows(gstin, table, filters)
    return ok({"rows": rows, "total": total, "limit": limit, "offset": offset})


# ─── Deletion ────────────────────────────────────────────────────────────────

@app.route("/clients/<gstin>/delete/preview", methods=["POST"])
def api_delete_preview(gstin):
    body = request.json
    preview = preview_deletion(
        gstin,
        mode=body.get("mode"),
        source_type=body.get("source_type", ""),
        tax_period=body.get("tax_period", "")
    )
    return ok(preview)


@app.route("/clients/<gstin>/delete/period", methods=["POST"])
def api_delete_period(gstin):
    body = request.json
    confirm_gstin = body.get("confirm_gstin")
    if confirm_gstin != gstin:
        return err("GSTIN confirmation does not match")
    result = delete_period(gstin, body.get("source_type"), body.get("tax_period"))
    return ok(result)


@app.route("/clients/<gstin>/delete/pr", methods=["POST"])
def api_delete_pr(gstin):
    body = request.json
    if body.get("confirm_gstin") != gstin:
        return err("GSTIN confirmation does not match")
    result = delete_all_pr(gstin)
    return ok(result)


@app.route("/clients/<gstin>/delete/client", methods=["POST"])
def api_delete_client(gstin):
    body = request.json
    if body.get("confirm_gstin") != gstin:
        return err("GSTIN confirmation does not match")
    result = delete_all_client(gstin)
    return ok(result)


@app.route("/clients/<gstin>/delete/nuclear", methods=["POST"])
def api_delete_nuclear(gstin):
    body = request.json
    if body.get("confirm_gstin") != gstin:
        return err("GSTIN confirmation does not match")
    result = nuclear_delete(
        gstin,
        cert_output_path=body.get("cert_output_path"),
        client_name=body.get("client_name", ""),
        ca_firm=body.get("ca_firm", "CA Firm")
    )
    return ok(result)


# ─── Plugins ─────────────────────────────────────────────────────────────────

@app.route("/plugins", methods=["GET"])
def api_list_plugins():
    return ok(list_plugins())


@app.route("/plugins/register", methods=["POST"])
def api_register_plugin():
    body = request.json
    register_plugin(
        body.get("name"), body.get("version"),
        body.get("path"), body.get("entry_point", "run")
    )
    return ok({"registered": True})


@app.route("/clients/<gstin>/reconcile", methods=["POST"])
def api_reconcile(gstin):
    body = request.json
    plugin_name = body.get("plugin_name")
    if not plugin_name:
        return err("plugin_name required")
    try:
        result = run_plugin_by_name(gstin, plugin_name)
        return ok(result)
    except Exception as e:
        return err(str(e))


if __name__ == "__main__":
    app.run(port=7432, debug=False)
