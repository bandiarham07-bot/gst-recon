import { browseData, listClients, getClientPeriods } from '../api.js';

const VIEWS = {
  '2B': {
    table: 'gstr2b_b2b',
    cols: ['supplier_gstin', 'supplier_name', 'invoice_number', 'invoice_type',
           'invoice_date', 'invoice_value', 'taxable_value', 'igst', 'cgst',
           'sgst', 'cess', 'itc_availability', 'recon_status'],
    labels: ['Supplier GSTIN', 'Supplier Name', 'Invoice No.', 'Type',
             'Date', 'Invoice Value', 'Taxable Value', 'IGST', 'CGST',
             'SGST', 'Cess', 'ITC Avail.', 'Recon Status'],
  },
  'PR': {
    table: 'purchase_register',
    cols: ['supplier_gstin', 'supplier_name', 'invoice_number', 'invoice_date',
           'taxable_value', 'igst', 'cgst', 'sgst', 'cess', 'epr_software', 'recon_status'],
    labels: ['Supplier GSTIN', 'Supplier Name', 'Invoice No.', 'Date',
             'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess', 'Software', 'Recon Status'],
  },
};

export async function renderDataBrowser(container, { getState, setState, navigateTo }) {
  let state = {
    gstin: getState().selectedClient || '',
    view: '2B',
    period: '',
    supplierGstin: '',
    reconStatus: '',
    offset: 0,
    limit: 100,
    rows: [],
    total: 0,
    loading: false,
    clients: [],
    periods: [],
  };

  async function load() {
    state.loading = true;
    renderBrowser();
    try {
      const params = { limit: state.limit, offset: state.offset };
      if (state.period) params.tax_period = state.period;
      if (state.supplierGstin) params.supplier_gstin = state.supplierGstin;
      if (state.reconStatus) params.recon_status = state.reconStatus;
      const res = await browseData(state.gstin, state.view, params);
      state.rows = res.data?.rows || [];
      state.total = res.data?.total || 0;
    } catch (e) {
      state.rows = [];
      state.total = 0;
    }
    state.loading = false;
    renderBrowser();
  }

  async function init() {
    try {
      const cr = await listClients();
      state.clients = cr.data || [];
      if (!state.gstin && state.clients.length > 0) state.gstin = state.clients[0].gstin;
    } catch {}
    if (state.gstin) {
      try {
        const pr = await getClientPeriods(state.gstin);
        state.periods = pr.data || [];
      } catch {}
    }
    await load();
  }

  function fmt(val, col) {
    if (val === null || val === undefined || val === '') return '—';
    if (['invoice_value','taxable_value','igst','cgst','sgst','cess'].includes(col)) {
      return typeof val === 'number' ? '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : val;
    }
    if (col === 'recon_status') {
      const cls = val === 'matched' ? 'badge-green' : val === 'mismatch' ? 'badge-amber' : val === 'unmatched' ? 'badge-red' : 'badge-gray';
      return `<span class="badge ${cls}">${val}</span>`;
    }
    return String(val);
  }

  function renderBrowser() {
    const view = VIEWS[state.view];
    container.innerHTML = `
      <div class="screen-header">
        <div>
          <div class="screen-title">Data Browser</div>
          <div class="screen-subtitle">View ingested records for a client</div>
        </div>
      </div>

      <div class="card mb-4">
        <div class="flex gap-3 items-center flex-wrap">
          <div class="form-group" style="margin:0;min-width:220px;">
            <select id="sel-client">
              ${state.clients.map(c => `<option value="${c.gstin}" ${state.gstin === c.gstin ? 'selected':''}>${c.gstin}</option>`).join('')}
            </select>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm ${state.view==='2B'?'btn-primary':''}" data-view="2B">GSTR-2B</button>
            <button class="btn btn-secondary btn-sm ${state.view==='PR'?'btn-primary':''}" data-view="PR">Purchase Register</button>
          </div>
          <select id="sel-period" style="width:150px;">
            <option value="">All Periods</option>
            ${state.periods.map(p => `<option value="${p}" ${state.period===p?'selected':''}>${p}</option>`).join('')}
          </select>
          <input type="text" id="filter-gstin" placeholder="Filter by Supplier GSTIN" value="${state.supplierGstin}" style="width:200px;" />
          <select id="filter-recon" style="width:160px;">
            <option value="">All Statuses</option>
            <option value="matched" ${state.reconStatus==='matched'?'selected':''}>Matched</option>
            <option value="unmatched" ${state.reconStatus==='unmatched'?'selected':''}>Unmatched</option>
            <option value="mismatch" ${state.reconStatus==='mismatch'?'selected':''}>Mismatch</option>
          </select>
          <button class="btn btn-primary btn-sm" id="btn-filter">🔍 Filter</button>
        </div>
      </div>

      ${state.loading ? `<div class="loading-center"><div class="spinner"></div><span>Loading...</span></div>` : `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span class="text-muted text-sm">Showing ${state.rows.length} of ${state.total} records</span>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" id="btn-prev" ${state.offset===0?'disabled':''}>← Prev</button>
            <button class="btn btn-ghost btn-sm" id="btn-next" ${state.offset+state.limit>=state.total?'disabled':''}>Next →</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>${view.labels.map(l => `<th>${l}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${state.rows.length === 0 ? `<tr><td colspan="${view.cols.length}" style="text-align:center;padding:32px;color:var(--text-muted);">No records found</td></tr>` :
                state.rows.map(row => `<tr>${view.cols.map(c => `<td>${fmt(row[c], c)}</td>`).join('')}</tr>`).join('')
              }
            </tbody>
          </table>
        </div>
      `}
    `;

    container.querySelector('#sel-client')?.addEventListener('change', async e => {
      state.gstin = e.target.value;
      state.offset = 0;
      setState({ selectedClient: state.gstin });
      const pr = await getClientPeriods(state.gstin);
      state.periods = pr.data || [];
      await load();
    });

    container.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => { state.view = btn.dataset.view; state.offset = 0; load(); });
    });

    container.querySelector('#sel-period')?.addEventListener('change', e => { state.period = e.target.value; });
    container.querySelector('#filter-gstin')?.addEventListener('input', e => { state.supplierGstin = e.target.value; });
    container.querySelector('#filter-recon')?.addEventListener('change', e => { state.reconStatus = e.target.value; });

    container.querySelector('#btn-filter')?.addEventListener('click', () => { state.offset = 0; load(); });
    container.querySelector('#btn-prev')?.addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); load(); });
    container.querySelector('#btn-next')?.addEventListener('click', () => { state.offset += state.limit; load(); });
  }

  await init();
}
