from datetime import datetime
from pathlib import Path
from typing import List, Dict


def generate_certificate_text(
    gstin: str,
    client_name: str,
    deleted_records: List[Dict],
    deletion_method: str,
    pre_wipe_hash: str = "",
    ca_firm: str = "CA Firm",
    app_version: str = "1.0",
) -> str:
    now = datetime.now().strftime("%d/%m/%Y %H:%M:%S IST")
    lines = [
        "DATA DELETION CERTIFICATE",
        "─" * 50,
        f"Issued by:      {ca_firm}",
        f"Software:       GST Reconciler v{app_version}",
        f"Date & Time:    {now}",
        "",
        f"Client GSTIN:   {gstin}",
        f"Client Name:    {client_name}",
        "",
        "Records deleted:",
        f"  {'Table':<30} {'Period':<20} {'Rows':>6}",
    ]
    total = 0
    for rec in deleted_records:
        lines.append(f"  {rec.get('table',''):<30} {rec.get('period',''):<20} {rec.get('rows', 0):>6}")
        total += rec.get("rows", 0)
    lines.append(f"  {'TOTAL':<30} {'':<20} {total:>6}")
    lines.append("")
    lines.append(f"Deletion method:  {deletion_method}")
    if pre_wipe_hash:
        lines.append(f"Pre-wipe SHA-256: {pre_wipe_hash}")
    lines.extend([
        "",
        "This certificate confirms permanent deletion from this",
        "installation. Data is not recoverable by standard means.",
        "─" * 50,
        "[Digital signature placeholder / CA firm stamp]",
    ])
    return "\n".join(lines)


def save_certificate(
    output_path: str,
    gstin: str,
    client_name: str,
    deleted_records: List[Dict],
    deletion_method: str,
    pre_wipe_hash: str = "",
    ca_firm: str = "CA Firm",
    app_version: str = "1.0",
) -> str:
    text = generate_certificate_text(
        gstin, client_name, deleted_records,
        deletion_method, pre_wipe_hash, ca_firm, app_version
    )
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return str(path)


def generate_certificate_pdf(
    output_path: str,
    gstin: str,
    client_name: str,
    deleted_records: List[Dict],
    deletion_method: str,
    pre_wipe_hash: str = "",
    ca_firm: str = "CA Firm",
    app_version: str = "1.0",
) -> str:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas

        text = generate_certificate_text(
            gstin, client_name, deleted_records,
            deletion_method, pre_wipe_hash, ca_firm, app_version
        )
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        c = canvas.Canvas(str(path), pagesize=A4)
        c.setFont("Courier", 11)
        y = 800
        for line in text.split("\n"):
            c.drawString(50, y, line)
            y -= 16
            if y < 50:
                c.showPage()
                c.setFont("Courier", 11)
                y = 800
        c.save()
        return str(path)
    except ImportError:
        txt_path = output_path.replace(".pdf", ".txt")
        return save_certificate(
            txt_path, gstin, client_name, deleted_records,
            deletion_method, pre_wipe_hash, ca_firm, app_version
        )
