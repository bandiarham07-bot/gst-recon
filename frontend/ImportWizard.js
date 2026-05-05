import {
  openFileDialog, detectFile, import2B,
  detectEPRHeader, mapEPRColumns, importEPR, listClients
} from '../api.js';

const EPR_SOFTWARE = ['Tally', 'Busy', 'Marg', 'SAP', 'Unknown'];

export function renderImportWizard(container, { getState, setState, navigateTo }) {
  let step = 1;
  let wizardData = {
    filePath: null,
    fileType: null,
    sheets: [],
    gstin: getState().selectedClient || '',
    eprSoftware: 'Unknown',
    headerRowIdx: 0,
    rawColumns: [],
    colMappings: [],
    taxPeriod: '',
    financialYear: '',
  };

  function renderStep() {
    container.innerHTML = `
      <div class="screen-header">
        <div>
          <div class="screen-title">Import File</div>
          <div class="screen-subtitle">Import GSTR-2B or Purchase Register</div>
        </div>
      </div>
      <div class="wizard-steps">
        ${['File Selection', 'Column Mapping', 'Import'].map((label, i) => `
          <div class="wizard-step ${step === i+1 ? 'active' : step > i+1 ? 'done' : ''}">
            <div class="wizard-step-num">${step > i+1 ? '✓' : i+1}</div>
            ${label}
          </div>
        `).join('')}
      </div>
      <div id="step-content"></div>
    `;
    const sc = container.querySelector('#step-content');
    if (step === 1) renderStep1(sc);
    else if (step === 2) renderStep2(sc);
    else renderStep3(sc);
  }

  async function renderStep1(sc) {
    let clients = [];
    try { clients = (await listClients()).data || []; } catch {}

    sc.innerHTML = `
      <div class="card">
        <div class="form-group">
          <label class="form-label">Client GSTIN *</label>
          <select id="gstin-select">
            <option value="">-- Select client --</option>
            ${clients.map(c => `<option value="${c.gstin}" ${wizardData.gstin === c.gstin ? 'selected' : ''}>${c.gstin} — ${c.legal_name || ''}</option>`).join('')}
          </select>
        </div>

        <div class="drop-zone" id="drop-zone">
          <div class="icon">📄</div>
          <h3>Drop .xlsx file here</h3>
          <p>or click to browse</p>
        </div>

        ${wizardData.filePath ? `
          <div class="alert alert-info mt-2">
            <strong>File:</strong> ${wizardData.filePath.split(/[/\\]/).pop()}<br/>
            <strong>Detected type:</strong> ${wizardData.fileType === '2B' ? '🟢 GSTR-2B' : '📋 Purchase Register (EPR)'}
          </div>
        ` : ''}

        ${wizardData.fileType === 'EPR' ? `
          <div class="form-group mt-2">
            <label class="form-label">EPR Software</label>
            <select id="epr-software">
              ${EPR_SOFTWARE.map(s => `<option value="${s}" ${wizardData.eprSoftware === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Tax Period (e.g. Jan-Mar)</label>
            <input type="text" id="tax-period" value="${wizardData.taxPeriod}" placeholder="Jan-Mar" />
          </div>
          <div class="form-group">
            <label class="form-label">Financial Year (e.g. 2025-26)</label>
            <input type="text" id="fin-year" value="${wizardData.financialYear}" placeholder="2025-26" />
          </div>
        ` : ''}

        <div class="flex gap-2 mt-4" style="justify-content:flex-end;">
          <button class="btn btn-primary" id="btn-next" ${!wizardData.filePath || !wizardData.gstin ? 'disabled' : ''}>
            Next →
          </button>
        </div>
      </div>
    `;

    sc.querySelector('#gstin-select').addEventListener('change', e => {
      wizardData.gstin = e.target.value;
      sc.querySelector('#btn-next').disabled = !wizardData.filePath || !wizardData.gstin;
    });

    sc.querySelector('#epr-software')?.addEventListener('change', e => { wizardData.eprSoftware = e.target.value; });
    sc.querySelector('#tax-period')?.addEventListener('input', e => { wizardData.taxPeriod = e.target.value; });
    sc.querySelector('#fin-year')?.addEventListener('input', e => { wizardData.financialYear = e.target.value; });

    const dropZone = sc.querySelector('#drop-zone');
    dropZone.addEventListener('click', async () => {
      const path = await openFileDialog({ title: 'Select Excel file' });
      if (!path) return;
      await handleFileSelected(path, sc);
    });

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', async e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) await handleFileSelected(file.path || file.name, sc);
    });

    sc.querySelector('#btn-next').addEventListener('click', async () => {
      if (wizardData.fileType === '2B') {
        step = 3;
      } else {
        await prepareStep2();
        step = 2;
      }
      renderStep();
    });
  }

  async function handleFileSelected(path, sc) {
    sc.querySelector('#drop-zone').innerHTML = `<div class="spinner"></div>`;
    try {
      const res = await detectFile(path);
      wizardData.filePath = path;
      wizardData.fileType = res.data.file_type;
      wizardData.sheets = res.data.sheets || [];
    } catch (e) {
      alert('Detection failed: ' + e.message);
    }
    renderStep1(sc);
  }

  async function prepareStep2() {
    const { data } = await detectEPRHeader(wizardData.filePath, wizardData.sheets[0]);
    wizardData.headerRowIdx = data.header_row_index ?? 0;

    const openpyxl = await window.electronAPI?.api({
      method: 'POST', path: '/import/epr/detect-header',
      body: { path: wizardData.filePath, sheet_name: wizardData.sheets[0] }
    });

    // Get raw columns by fetching a few rows
    const detectRes = await window.electronAPI?.api({
      method: 'POST', path: '/import/epr/detect-header',
      body: { path: wizardData.filePath, sheet_name: wizardData.sheets[0] }
    }) || { data: { header_row_index: 0 } };

    wizardData.headerRowIdx = detectRes.data?.header_row_index ?? 0;
  }

  function renderStep2(sc) {
    const mappings = wizardData.colMappings;
    const CANONICAL_OPTIONS = [
      '', 'supplier_gstin', 'supplier_name', 'invoice_number', 'invoice_date',
      'invoice_value', 'taxable_value', 'igst', 'cgst', 'sgst', 'cess',
      'place_of_supply', 'itc_availability', 'itc_reason', 'invoice_type',
      'gstr1_period', 'gstr1_filing_date', 'reverse_charge', 'source', 'irn', 'irn_date'
    ];

    sc.innerHTML = `
      <div class="card">
        <div class="card-title">Column Mapping Review</div>
        <p class="text-muted mb-4">Review detected column mappings. Amber = low confidence (override if needed). Red = unmapped (must assign or ignore).</p>
        <div class="table-wrap" style="max-height:400px;overflow-y:auto;">
          <table>
            <thead><tr><th>Detected Column</th><th>→ Canonical Name</th><th>Confidence</th><th>Status</th></tr></thead>
            <tbody>
              ${mappings.map((m, i) => `
                <tr class="${m.status === 'low_confidence' ? 'mapping-row-amber' : m.status === 'unmatched' ? 'mapping-row-red' : ''}">
                  <td><span class="font-mono">${m.raw}</span></td>
                  <td>
                    <select class="map-select" data-idx="${i}" style="width:200px;">
                      <option value="">— ignore —</option>
                      ${CANONICAL_OPTIONS.filter(o=>o).map(o =>
                        `<option value="${o}" ${m.canonical === o ? 'selected' : ''}>${o}</option>`
                      ).join('')}
                    </select>
                  </td>
                  <td>${m.score ? (m.score * 100).toFixed(0) + '%' : '—'}</td>
                  <td>
                    <span class="badge ${m.status === 'auto' ? 'badge-green' : m.status === 'low_confidence' ? 'badge-amber' : 'badge-red'}">
                      ${m.status}
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="flex gap-2 mt-4" style="justify-content:flex-end;">
          <button class="btn btn-ghost" id="btn-back">← Back</button>
          <button class="btn btn-primary" id="btn-confirm-map">Confirm Mappings →</button>
        </div>
      </div>
    `;

    sc.querySelectorAll('.map-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.idx);
        wizardData.colMappings[idx].canonical = e.target.value;
      });
    });

    sc.querySelector('#btn-back').addEventListener('click', () => { step = 1; renderStep(); });
    sc.querySelector('#btn-confirm-map').addEventListener('click', () => { step = 3; renderStep(); });
  }

  function renderStep3(sc) {
    sc.innerHTML = `
      <div class="card">
        <div class="card-title">Import Summary</div>
        <div class="alert alert-info">
          <strong>File:</strong> ${wizardData.filePath?.split(/[/\\]/).pop() || 'Unknown'}<br/>
          <strong>Type:</strong> ${wizardData.fileType === '2B' ? 'GSTR-2B' : 'Purchase Register'}<br/>
          <strong>Client GSTIN:</strong> ${wizardData.gstin}<br/>
          ${wizardData.fileType === 'EPR' ? `<strong>EPR Software:</strong> ${wizardData.eprSoftware}<br/>` : ''}
        </div>
        <div id="import-progress" class="hidden">
          <div class="progress-bar-wrap"><div class="progress-bar-fill" id="prog" style="width:0%"></div></div>
          <p id="prog-label" class="text-muted text-sm text-center">Importing...</p>
        </div>
        <div id="import-result" class="hidden"></div>
        <div class="flex gap-2 mt-4" style="justify-content:flex-end;">
          <button class="btn btn-ghost" id="btn-back2">← Back</button>
          <button class="btn btn-primary btn-lg" id="btn-import">📥 Import</button>
        </div>
      </div>
    `;

    sc.querySelector('#btn-back2').addEventListener('click', () => {
      step = wizardData.fileType === '2B' ? 1 : 2;
      renderStep();
    });

    sc.querySelector('#btn-import').addEventListener('click', async () => {
      const btn = sc.querySelector('#btn-import');
      const prog = sc.querySelector('#import-progress');
      const result = sc.querySelector('#import-result');
      btn.disabled = true;
      btn.textContent = 'Importing...';
      prog.classList.remove('hidden');

      const animate = setInterval(() => {
        const fill = sc.querySelector('#prog');
        const current = parseInt(fill.style.width) || 0;
        if (current < 85) fill.style.width = (current + 5) + '%';
      }, 200);

      try {
        let res;
        if (wizardData.fileType === '2B') {
          res = await import2B(wizardData.filePath, wizardData.gstin);
        } else {
          const colMap = {};
          wizardData.colMappings.forEach(m => { if (m.canonical) colMap[m.raw] = m.canonical; });
          res = await importEPR({
            path: wizardData.filePath,
            gstin: wizardData.gstin,
            epr_software: wizardData.eprSoftware,
            header_row_index: wizardData.headerRowIdx,
            col_mapping: colMap,
            tax_period: wizardData.taxPeriod,
            financial_year: wizardData.financialYear,
          });
        }

        clearInterval(animate);
        sc.querySelector('#prog').style.width = '100%';
        sc.querySelector('#prog-label').textContent = 'Complete!';

        if (res.success) {
          result.classList.remove('hidden');
          const d = res.data;
          result.innerHTML = `
            <div class="alert alert-success">
              ✅ Import successful!<br/>
              <strong>Batch ID:</strong> <span class="font-mono">${d.batch_id}</span><br/>
              <strong>Total rows imported:</strong> ${d.total_rows || d.row_count}<br/>
              ${d.row_counts ? Object.entries(d.row_counts).map(([t,n]) => `${t}: ${n} rows`).join(' | ') : ''}
            </div>
          `;
          setState({ selectedClient: wizardData.gstin });
        } else {
          result.classList.remove('hidden');
          result.innerHTML = `<div class="alert alert-danger">❌ ${res.error}</div>`;
        }
      } catch (e) {
        clearInterval(animate);
        result.classList.remove('hidden');
        result.innerHTML = `<div class="alert alert-danger">❌ ${e.message}</div>`;
      }

      btn.disabled = false;
      btn.textContent = '📥 Import Again';
    });
  }

  renderStep();
}
