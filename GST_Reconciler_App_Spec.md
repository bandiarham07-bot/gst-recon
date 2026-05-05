# GST Reconciler — App Technical Specification

> Scope: Frontend UI + Backend ingestion/storage/privacy. The reconciliation matching algorithm is **not** built here — an external code file (plugin) is integrated at runtime to perform matching against the structured database this app produces.

---

## 1. Overview

A desktop application for Chartered Accountants that:
- Ingests GSTR-2B (`.xlsx`, government portal export) and Purchase Register files (`.xlsx`, from any EPR software — Tally, Busy, Marg, SAP, etc.)
- Parses and normalises all column headings to a canonical schema
- Stores structured, encrypted data in a per-client SQLite database
- Exposes the database to an external reconciliation engine (plugin)
- Provides complete data lifecycle management including secure deletion and deletion certificates

**Stack recommendation:** Electron (frontend) + Python backend via IPC, or PyQt/Tkinter as a pure-Python desktop app. SQLite with SQLCipher for encrypted storage.

---

## 2. Directory Structure

```
gst-reconciler/
├── frontend/
│   ├── screens/
│   │   ├── Dashboard.jsx
│   │   ├── ImportWizard.jsx
│   │   ├── ColumnMapper.jsx
│   │   ├── DataBrowser.jsx
│   │   ├── ClientManager.jsx
│   │   └── DeleteManager.jsx
│   └── components/
│       ├── FileDropZone.jsx
│       ├── PreviewGrid.jsx
│       └── DeletionCertModal.jsx
├── backend/
│   ├── ingestion/
│   │   ├── detector.py         # header row detection
│   │   ├── parser_2b.py        # GSTR-2B specific parser
│   │   ├── parser_epr.py       # generic EPR parser
│   │   └── canonical_map.py    # alias → canonical name mapping
│   ├── database/
│   │   ├── schema.py           # table definitions
│   │   ├── db_manager.py       # connection, CRUD, VACUUM
│   │   └── encryption.py       # SQLCipher key management
│   ├── deletion/
│   │   ├── delete_manager.py   # scoped deletion logic
│   │   ├── secure_wipe.py      # multi-pass overwrite
│   │   └── certificate.py      # deletion certificate generator
│   └── reconciliation/
│       └── plugin_runner.py    # loads + runs external algorithm file
├── clients/                    # one encrypted .db per GSTIN
│   └── <GSTIN>/
│       ├── data.db
│       └── data.db.meta
└── config/
    └── alias_registry.json     # canonical alias dictionary
```

---

## 3. Frontend

### 3.1 Dashboard

The landing screen after login. Shows:
- List of all client GSTINs registered in the app
- Per-client: last import date, periods available, reconciliation status
- Quick actions: Import New File, Browse Data, Run Reconciliation (triggers plugin), Manage/Delete Data

No client data is displayed on this screen — only metadata from `data.db.meta` (non-sensitive).

### 3.2 Import Wizard (3 steps)

**Step 1 — File Selection**
- Drag-and-drop zone accepting `.xlsx` files
- User selects file type: `GSTR-2B` or `Purchase Register`
- App auto-detects file type by checking for the "Read me" sheet (2B marker); auto-detection result shown to user for confirmation
- For PR files: user selects the EPR software from a dropdown (Tally, Busy, Marg, SAP, Unknown). If Unknown, the generic parser runs

**Step 2 — Column Mapping Review**
- App runs the header detection and canonical mapping logic (see Backend §4.2)
- Displays a two-column table: `Detected Column Name` → `Canonical Name`
- Rows where confidence < 0.75 are highlighted in amber; user can override the mapping from a dropdown of canonical names
- Rows the parser could not map are shown in red; user must manually assign or mark as "ignore"
- User clicks "Confirm Mappings" — confirmed mappings are saved to `column_mapping_registry` so future imports from the same software are automatic

**Step 3 — Import Summary**
- Shows: file name, period detected, GSTIN, row counts per sheet/table, any skipped rows
- User clicks "Import" to commit data to the encrypted database
- Progress bar shown during write; on completion shows batch ID and timestamp

### 3.3 Column Mapper (standalone re-access)

Accessible from the dashboard for any past import batch. Allows the user to retrospectively correct a mapping and re-import the batch without re-uploading the file (raw data is re-parsed from the stored batch snapshot).

### 3.4 Data Browser

A searchable, filterable table view of all ingested data for a selected client:
- Toggle between `GSTR-2B` view and `Purchase Register` view
- Filters: period, supplier GSTIN, invoice number, ITC availability, mismatch status (populated after reconciliation plugin runs)
- Export visible rows to Excel at any time
- Individual rows are read-only — no in-app editing of source data

### 3.5 Client Manager

- Add / rename / archive clients
- Per-client: shows storage used, periods imported, reconciliation history
- Links to Delete Manager for data lifecycle actions

### 3.6 Delete Manager

The data deletion interface. Four clearly separated modes (see Backend §4.5 for logic):

| Mode | What is deleted | Reversible |
|---|---|---|
| Selective period wipe | PR or 2B rows for one period | No |
| Full PR wipe | All PR rows for this client | No |
| Full client wipe | All data for this GSTIN | No |
| Nuclear (encrypted file destroy) | Encrypted `.db` file overwritten + deleted | No |

Each mode shows an impact preview (record counts, periods, MB) before action. Final confirmation requires the user to **type the client GSTIN** into a text field — a standard pattern for irreversible operations. On completion, a deletion certificate is generated automatically (see §4.5.3).

---

## 4. Backend

### 4.1 File Type Detection

On file selection, the backend checks for the presence of the "Read me" sheet using `openpyxl`. If found, the file is treated as GSTR-2B. Otherwise it is routed to the generic EPR parser. The detected type is always shown to the user for confirmation before parsing proceeds.

```python
def detect_file_type(path: str) -> str:
    wb = openpyxl.load_workbook(path, read_only=True)
    return "2B" if "Read me" in wb.sheetnames else "EPR"
```

### 4.2 Header Row Detection (EPR Parser)

The most complex ingestion step. Runs a scoring pipeline on the first 20 rows of the file.

**Scoring signals per row:**
- `string_density`: fraction of non-empty cells that are strings (not numbers/dates). Headers are almost entirely strings.
- `numeric_absence`: penalises rows containing currency or date values — header rows don't have these.
- `alias_match_score`: fuzzy-matches each cell value against the canonical alias dictionary using `rapidfuzz.token_sort_ratio > 80`. Each match adds to the score.
- `uniqueness`: checks that all cell values in the row are distinct (duplicate column names are rare in headers, common in data rows).
- `density_jump`: checks if the rows immediately below have significantly higher numeric content — a strong signal that this row is the header boundary.

Each signal contributes a weighted component to a final row score between 0 and 1.

**Decision logic:**
- Score > 0.75 → auto-accept, log confidence
- Score 0.50–0.75 → show top 3 candidate rows to user, ask for selection
- Score < 0.50 → open manual row picker (spreadsheet preview, user clicks the header row)
- Merged cells detected above the best row → trigger multi-row header merge (parent label + child label concatenated with `__`, then looked up in alias dict)

Confirmed header mappings are written to `column_mapping_registry` with the EPR software name and a `user_confirmed = True` flag, so subsequent imports from the same software skip detection entirely.

### 4.3 GSTR-2B Parser

The 2B file has a known, fixed structure. The parser handles each sheet explicitly:

- **Relevant sheets:** B2B, B2BA, B2B-CDNR, B2B-CDNRA, ECO, ECOA, ISD, ISDA, IMPG, IMPGA, IMPGSEZ, IMPGSEZA, B2B (ITC Reversal), B2BA (ITC Reversal), Debit notes (Original), B2B-DNRA — plus their Rejected variants
- **Header location:** rows 4–5 (0-indexed) in each data sheet contain the two-row merged header. The parser reads both rows, merges parent + child labels, maps to canonical names
- **Metadata extraction:** from the "Read me" sheet — Financial Year, Tax Period, GSTIN, Legal Name, Date of generation — stored as batch metadata, not as data rows
- **Summary sheets** (ITC Available, ITC not available, ITC Reversal, ITC Rejected) are parsed for summary figures only and stored in a separate `itc_summary` table, not in the main `gstr2b_b2b` table

Each parsed row is written to the appropriate canonical table with `source_type = '2B'` and the batch ID.

### 4.4 Database Schema

Per-client encrypted SQLite file. All monetary values stored as `REAL`. All dates stored as `TEXT` in `YYYY-MM-DD` format for unambiguous sorting.

**`import_batches`**
```sql
CREATE TABLE import_batches (
    batch_id        TEXT PRIMARY KEY,  -- UUID
    import_ts       TEXT,              -- ISO timestamp
    source_file     TEXT,              -- original filename
    source_type     TEXT,              -- '2B' or 'PR'
    epr_software    TEXT,              -- 'Tally', 'Busy', etc.
    company_gstin   TEXT,
    financial_year  TEXT,
    tax_period      TEXT,
    row_count       INTEGER
);
```

**`gstr2b_b2b`** (and parallel tables per 2B sheet type)
```sql
CREATE TABLE gstr2b_b2b (
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
    itc_availability  TEXT,
    itc_reason        TEXT,
    gstr1_period      TEXT,
    gstr1_filing_date TEXT,
    source_type       TEXT DEFAULT '2B',
    recon_status      TEXT            -- populated by external plugin
);
```

**`purchase_register`**
```sql
CREATE TABLE purchase_register (
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
    recon_status     TEXT            -- populated by external plugin
);
```

**`column_mapping_registry`**
```sql
CREATE TABLE column_mapping_registry (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_column_name  TEXT,
    canonical_name   TEXT,
    source_type      TEXT,
    epr_software     TEXT,
    confidence_score REAL,
    user_confirmed   INTEGER,        -- 0 or 1
    created_at       TEXT
);
```

**`itc_summary`** — stores the period-level ITC Available / Not Available / Reversal / Rejected totals from the 2B summary sheets.

**`deletion_log`** — append-only audit trail of all deletion events (what was deleted, when, by whom, method used).

After any deletion operation, `VACUUM` is run to physically compact the file and remove freed pages from the byte content.

### 4.5 Data Deletion & Privacy

#### 4.5.1 Architecture for Privacy

Each client GSTIN gets its own encrypted `.db` file stored locally:
```
clients/23AAGFM2167A1ZU/data.db        ← SQLCipher encrypted
clients/23AAGFM2167A1ZU/data.db.meta   ← non-sensitive (periods, import dates only)
```

The encryption key is derived from: `PBKDF2(CA_master_password + client_GSTIN, salt, iterations=260000)`. The `.db` file is unreadable without the CA's master password. If someone copies the file off the machine, it contains no recoverable plaintext. The `.meta` file contains no invoice data — only timestamps and period labels, safe to be unencrypted for fast dashboard rendering.

The app never transmits raw invoice data over any network. No telemetry, no cloud sync, no third-party API calls involving client data.

#### 4.5.2 Deletion Modes

**Mode 1 — Selective period wipe:**
```python
def delete_period(gstin, source_type, tax_period):
    db.execute("""
        DELETE FROM gstr2b_b2b
        WHERE batch_id IN (
            SELECT batch_id FROM import_batches
            WHERE source_type = ? AND tax_period = ?
        )
    """, (source_type, tax_period))
    db.execute("DELETE FROM import_batches WHERE source_type=? AND tax_period=?",
               (source_type, tax_period))
    db.execute("VACUUM")
    log_deletion(gstin, mode="period", detail=f"{source_type} {tax_period}")
```

**Mode 2 — Full PR wipe:** Same pattern, no `tax_period` filter, targets `purchase_register` and all PR batches.

**Mode 3 — Full client wipe:** Deletes all rows across all tables for the client, runs `VACUUM`, then proceeds to Mode 4.

**Mode 4 — Nuclear encrypted file destruction:**
```python
def secure_delete_file(db_path: str, passes: int = 3):
    size = os.path.getsize(db_path)
    with open(db_path, "r+b") as f:
        for _ in range(passes):
            f.seek(0); f.write(b'\x00' * size); f.flush(); os.fsync(f.fileno())
            f.seek(0); f.write(b'\xFF' * size); f.flush(); os.fsync(f.fileno())
            f.seek(0); f.write(os.urandom(size)); f.flush(); os.fsync(f.fileno())
    os.unlink(db_path)
    # Also destroy the encryption key from the keystore
    keystore.delete_key(gstin)
```

> Note: On SSDs with wear-levelling, multi-pass overwrite cannot guarantee 100% physical destruction at the hardware level. The combination of SQLCipher encryption (key destroyed first) + multi-pass overwrite provides the strongest practical protection available on standard desktop hardware.

#### 4.5.3 Deletion Certificate

Generated automatically after any deletion event. Saved as PDF to a user-specified location.

```
DATA DELETION CERTIFICATE
─────────────────────────────────────────────
Issued by:      [CA Firm Name]
Software:       GST Reconciler v1.x
Date & Time:    05/05/2026 14:32:07 IST

Client GSTIN:   23AAGFM2167A1ZU
Client Name:    M Mehta & Company

Records deleted:
  Table             Period          Rows
  purchase_register Jan-Mar 2025-26  412
  import_batches    Jan-Mar 2025-26    2

Deletion method:  SQL DELETE + VACUUM + 3-pass overwrite
Pre-wipe SHA-256: a3f8c2d1... [hash of .db file before wipe]

This certificate confirms permanent deletion from this
installation. Data is not recoverable by standard means.
─────────────────────────────────────────────
[Digital signature placeholder / CA firm stamp]
```

The SHA-256 hash of the database file taken immediately before the wipe is embedded in the certificate — providing proof that the specific file state was destroyed.

### 4.6 External Reconciliation Plugin

The reconciliation matching algorithm is **not built into this app**. An external Python file (or compiled module) is provided separately and integrated via a plugin runner.

**How it works:**
- The external file is placed in `reconciliation/plugins/` and registered in `config/plugins.json` with its name, version, and entry point function
- `plugin_runner.py` imports the module at runtime, passes it a database connection (read + write access to `gstr2b_b2b`, `purchase_register`, and a `reconciliation_results` output table), and calls the entry point
- The plugin reads from the two source tables using the canonical column names, runs its matching logic, and writes results back to `reconciliation_results` and updates the `recon_status` column on matched rows
- The app does not need to know what matching logic the plugin uses — it only needs the plugin to honour the canonical schema

```python
# plugin_runner.py
import importlib.util, sqlite3

def run_plugin(db_path: str, plugin_path: str):
    conn = sqlite3.connect(f"file:{db_path}?mode=rw", uri=True)
    spec = importlib.util.spec_from_file_location("recon_plugin", plugin_path)
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)
    plugin.run(conn)   # entry point convention: run(conn)
    conn.close()
```

The plugin is sandboxed to one client's database — it cannot access other clients' files. Updating the plugin is as simple as replacing the file; no app reinstall needed.

---

## 5. Data Flow Summary

```
User selects file
      │
      ▼
detect_file_type()
      │
   ┌──┴──────────────┐
  2B                EPR
   │                  │
parser_2b.py    detector.py → parser_epr.py
   │                  │
   └──────┬───────────┘
          │
    canonical_map.py
    (alias → canonical name)
          │
    ColumnMapper UI
    (user confirms/overrides)
          │
    db_manager.py
    (write to encrypted SQLite)
          │
    ┌─────┴──────────────┐
    │                    │
DataBrowser UI    plugin_runner.py
(user views data)  (external algorithm reads
                    canonical tables, writes
                    recon_status + results)
          │
    DeleteManager UI
    (scoped deletion → VACUUM
     → optional secure wipe
     → deletion certificate)
```

---

## 6. Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| One `.db` file per client GSTIN | Yes | Data isolation, easy handover, per-client deletion |
| Encryption | SQLCipher (AES-256) | Data unreadable without CA password even if file is copied |
| Raw `.xlsx` files stored? | No | Only parsed structured data stored; saves space, no file handling complexity |
| Cloud sync | None | All data stays on CA's local machine by default |
| Reconciliation engine | External plugin | Decouples matching logic from app; updatable independently |
| Deletion confirmation | Must type GSTIN | Prevents accidental irreversible deletion |
| Deletion audit | `deletion_log` table + PDF certificate | Professional accountability and client proof |
| Column mapping persistence | `column_mapping_registry` | Future imports from same EPR software are fully automatic |

---

## 7. What the External Reconciliation Engine Receives

The plugin connects to a SQLite database where both tables use these exact canonical column names:

**From `gstr2b_b2b`:** `supplier_gstin`, `supplier_name`, `invoice_number`, `invoice_type`, `invoice_date`, `invoice_value`, `taxable_value`, `igst`, `cgst`, `sgst`, `cess`, `place_of_supply`, `itc_availability`, `itc_reason`, `gstr1_period`, `gstr1_filing_date`, `batch_id`

**From `purchase_register`:** `supplier_gstin`, `supplier_name`, `invoice_number`, `invoice_date`, `taxable_value`, `igst`, `cgst`, `sgst`, `cess`, `epr_software`, `batch_id`

**It writes results to:** `reconciliation_results` (schema defined by the plugin team) and updates `recon_status` on source rows to `'matched'`, `'unmatched'`, or `'mismatch'`.

The plugin team needs no knowledge of the original raw file formats — the canonical schema is the only contract.

---

*End of specification.*
