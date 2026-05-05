SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS import_batches (
    batch_id        TEXT PRIMARY KEY,
    import_ts       TEXT,
    source_file     TEXT,
    source_type     TEXT,
    epr_software    TEXT,
    company_gstin   TEXT,
    financial_year  TEXT,
    tax_period      TEXT,
    row_count       INTEGER
);

CREATE TABLE IF NOT EXISTS gstr2b_b2b (
    row_id            TEXT PRIMARY KEY,
    batch_id          TEXT REFERENCES import_batches(batch_id),
    supplier_gstin    TEXT,
    supplier_name     TEXT,
    invoice_number    TEXT,
    invoice_type      TEXT,
    invoice_date      TEXT,
    invoice_value     REAL,
    taxable_value     REAL,
    igst              REAL,
    cgst              REAL,
    sgst              REAL,
    cess              REAL,
    place_of_supply   TEXT,
    reverse_charge    TEXT,
    itc_availability  TEXT,
    itc_reason        TEXT,
    applicable_tax_rate TEXT,
    source            TEXT,
    irn               TEXT,
    irn_date          TEXT,
    gstr1_period      TEXT,
    gstr1_filing_date TEXT,
    sheet_type        TEXT,
    source_type       TEXT DEFAULT '2B',
    recon_status      TEXT
);

CREATE TABLE IF NOT EXISTS gstr2b_b2ba (
    row_id            TEXT PRIMARY KEY,
    batch_id          TEXT REFERENCES import_batches(batch_id),
    supplier_gstin    TEXT,
    supplier_name     TEXT,
    original_invoice_number TEXT,
    original_invoice_date   TEXT,
    invoice_number    TEXT,
    invoice_type      TEXT,
    invoice_date      TEXT,
    invoice_value     REAL,
    taxable_value     REAL,
    igst              REAL,
    cgst              REAL,
    sgst              REAL,
    cess              REAL,
    place_of_supply   TEXT,
    reverse_charge    TEXT,
    itc_availability  TEXT,
    itc_reason        TEXT,
    gstr1_period      TEXT,
    gstr1_filing_date TEXT,
    sheet_type        TEXT DEFAULT 'B2BA',
    source_type       TEXT DEFAULT '2B',
    recon_status      TEXT
);

CREATE TABLE IF NOT EXISTS gstr2b_cdnr (
    row_id            TEXT PRIMARY KEY,
    batch_id          TEXT REFERENCES import_batches(batch_id),
    supplier_gstin    TEXT,
    supplier_name     TEXT,
    note_number       TEXT,
    note_type         TEXT,
    note_date         TEXT,
    note_value        REAL,
    invoice_number    TEXT,
    invoice_date      TEXT,
    taxable_value     REAL,
    igst              REAL,
    cgst              REAL,
    sgst              REAL,
    cess              REAL,
    place_of_supply   TEXT,
    itc_availability  TEXT,
    itc_reason        TEXT,
    gstr1_period      TEXT,
    gstr1_filing_date TEXT,
    sheet_type        TEXT,
    source_type       TEXT DEFAULT '2B',
    recon_status      TEXT
);

CREATE TABLE IF NOT EXISTS gstr2b_impg (
    row_id            TEXT PRIMARY KEY,
    batch_id          TEXT REFERENCES import_batches(batch_id),
    port_code         TEXT,
    bill_of_entry     TEXT,
    bill_of_entry_date TEXT,
    bill_of_entry_value REAL,
    taxable_value     REAL,
    igst              REAL,
    cess              REAL,
    amended           TEXT,
    sheet_type        TEXT,
    source_type       TEXT DEFAULT '2B',
    recon_status      TEXT
);

CREATE TABLE IF NOT EXISTS gstr2b_isd (
    row_id            TEXT PRIMARY KEY,
    batch_id          TEXT REFERENCES import_batches(batch_id),
    isd_gstin         TEXT,
    isd_name          TEXT,
    document_number   TEXT,
    document_type     TEXT,
    document_date     TEXT,
    original_invoice_number TEXT,
    original_invoice_date   TEXT,
    igst              REAL,
    cgst              REAL,
    sgst              REAL,
    cess              REAL,
    itc_availability  TEXT,
    sheet_type        TEXT,
    source_type       TEXT DEFAULT '2B',
    recon_status      TEXT
);

CREATE TABLE IF NOT EXISTS purchase_register (
    row_id           TEXT PRIMARY KEY,
    batch_id         TEXT REFERENCES import_batches(batch_id),
    supplier_gstin   TEXT,
    supplier_name    TEXT,
    invoice_number   TEXT,
    invoice_date     TEXT,
    taxable_value    REAL,
    igst             REAL,
    cgst             REAL,
    sgst             REAL,
    cess             REAL,
    epr_software     TEXT,
    source_type      TEXT DEFAULT 'PR',
    recon_status     TEXT
);

CREATE TABLE IF NOT EXISTS column_mapping_registry (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_column_name  TEXT,
    canonical_name   TEXT,
    source_type      TEXT,
    epr_software     TEXT,
    confidence_score REAL,
    user_confirmed   INTEGER DEFAULT 0,
    created_at       TEXT
);

CREATE TABLE IF NOT EXISTS itc_summary (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id        TEXT REFERENCES import_batches(batch_id),
    summary_type    TEXT,
    heading         TEXT,
    gstr3b_table    TEXT,
    igst            REAL,
    cgst            REAL,
    sgst            REAL,
    cess            REAL
);

CREATE TABLE IF NOT EXISTS reconciliation_results (
    result_id        TEXT PRIMARY KEY,
    batch_id_2b      TEXT,
    batch_id_pr      TEXT,
    row_id_2b        TEXT,
    row_id_pr        TEXT,
    match_status     TEXT,
    mismatch_fields  TEXT,
    created_at       TEXT
);

CREATE TABLE IF NOT EXISTS deletion_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    deleted_at  TEXT,
    gstin       TEXT,
    mode        TEXT,
    detail      TEXT,
    rows_deleted INTEGER,
    performed_by TEXT
);
"""

TABLES_2B = [
    "gstr2b_b2b", "gstr2b_b2ba", "gstr2b_cdnr", "gstr2b_impg", "gstr2b_isd"
]

SHEET_TABLE_MAP = {
    "B2B": "gstr2b_b2b",
    "B2BA": "gstr2b_b2ba",
    "B2B-CDNR": "gstr2b_cdnr",
    "B2B-CDNRA": "gstr2b_cdnr",
    "ECO": "gstr2b_b2b",
    "ECOA": "gstr2b_b2ba",
    "ISD": "gstr2b_isd",
    "ISDA": "gstr2b_isd",
    "IMPG": "gstr2b_impg",
    "IMPGA": "gstr2b_impg",
    "IMPGSEZ": "gstr2b_impg",
    "IMPGSEZA": "gstr2b_impg",
    "B2B (ITC Reversal)": "gstr2b_b2b",
    "B2BA (ITC Reversal)": "gstr2b_b2ba",
    "Debit notes (Original)": "gstr2b_cdnr",
    "B2B-DNRA": "gstr2b_cdnr",
    "B2B(Rejected)": "gstr2b_b2b",
    "B2BA(Rejected)": "gstr2b_b2ba",
    "B2B-CDNR(Rejected)": "gstr2b_cdnr",
    "B2B-CDNRA(Rejected)": "gstr2b_cdnr",
    "ECO(Rejected)": "gstr2b_b2b",
    "ECOA(Rejected)": "gstr2b_b2ba",
    "ISD(Rejected)": "gstr2b_isd",
    "ISDA(Rejected)": "gstr2b_isd",
}

SUMMARY_SHEETS = ["ITC Available", "ITC not available", "ITC Reversal", "ITC Rejected"]
