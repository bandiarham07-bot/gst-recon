import {
  listClients, getClientPeriods, previewDeletion,
  deletePeriod, deletePR, deleteClient, nuclearDelete, saveFileDialog
} from '../api.js';

const MODES = [
  {
    id: 'period',
    label: 'Selective Period Wipe',
    icon: '📅',
    color: 'var(--warning)',
    desc: 'Delete all records (2B or PR) for a specific tax period.',
    needsPeriod: true,
    needsType: true,
  },
  {
    id: 'full_pr',
    label: 'Full PR Wipe',
    icon: '📋',
    color: 'var(--warning)',
    desc: 'Delete ALL Purchase Register records for this client.',
    needsPeriod: false,
    needsType: false,
  },
  {
    id: 'full_client',
    label: 'Full Client Wipe',
    icon: '🗂️',
    color: 'var(--danger)',
    desc: 'Delete ALL data (2B + PR) for this client.',
    needsPeriod: false,
    needsType: false,
  },
  {
    id: 'nuclear',
    label: 'Nuclear Delete',
    icon: '☢️',
    color: 'var(--danger)',
    desc: 'Permanently destroy the encrypted .db file with 3-pass overwrite. IRREVERSIBLE.',
    needsPeriod: false,
    needsType: false,
    isNuclear: true,
  },
];

export async function renderDeleteManager(container, { getState, setState, navigateTo }) {
  let state = {
    gstin: getState().selectedClient || '',
    clients: [],
    periods: [],
    mode: null,
    sourceType: '2B',
    period: '',
    confirmGstin: '',
    preview: null,
    loading: false,
  };

  async function loadClients() {
    try { state.clients = (await listClients()).data || []; } catch {}
    if (!state.gstin && state.clients.length > 0) state.gstin = state.clients[0].gstin;
    if (state.gstin) await loadPeriods();
    render();
  }

  async function loadPeriods() {
    try { state.periods = (await getClientPeriods(state.gstin)).data || []; } catch {}
  }

  async function fetchPreview() {
    if (!state.mode || !state.gstin) return;
    state.loading = true;
    render();
    try {
      const res = await previewDeletion(state.gstin, {
        mode: state.mode,
        source_type: state.sourceType,
        tax_period: state.period,
      });
      state.preview = res.data;
    } catch { state.preview = null; }
    state.loading = false;
    render();
  }

  async function executeDelete() {
    if (state.confirmGstin !== state.gstin) {
      alert('GSTIN confirmation does not match. Operation cancelled.');
      return;
    }
    const btn = container.querySelector('#btn-execute');
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }

    try {
      let res;
      const body = { confirm_gstin: state.gstin };

      if (state.mode === 'period') {
        res = await deletePeriod(state.gstin, { ...body, source_type: state.sourceType, tax_period: state.period });
      } else if (state.mode === 'full_pr') {
        res = await deletePR(state.gstin, body);
      } else if (state.mode === 'full_client') {
        res = await deleteClient(state.gstin, body);
      } else if (state.mode === 'nuclear') {
        const certPath = await saveFileDialog({ title: 'Save Deletion Certificate', defaultPath: `deletion_cert_${state.gstin}.pdf` });
        res = await nuclearDelete(state.gstin, {
          ...body,
          cert_output_path: certPath,
          client_name: state.clients.find(c => c.gstin === state.gstin)?.legal_name || '',
        });
      }

      if (res?.success) {
        const total = (res.data?.records_deleted || []).reduce((s, r) => s + r.rows, 0);
        alert(`✅ Deletion complete. ${total} records removed.\n${res.data?.cert_path ? `Certificate saved: ${res.data.cert_path}` : ''}`);
        state.mode = null;
        state.preview = null;
        state.confirmGstin = '';
        await loadPeriods();
        render();
      } else {
        alert('❌ Error: ' + (res?.error || 'Unknown error'));
      }
    } catch (e) {
      alert('❌ ' + e.message);
    }
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Execute Deletion'; }
  }

  function render() {
    const modeConfig = MODES.find(m => m.id === state.mode);

    container.innerHTML = `
      <div class="screen-header">
        <div>
          <div class="screen-title">Delete Manager</div>
          <div class="screen-subtitle">Permanent data deletion with audit trail</div>
        </div>
      </div>

      <div class="alert alert-warning">
        ⚠️ All deletion operations are <strong>irreversible</strong>. A deletion certificate is generated automatically.
      </div>

      <div class="flex gap-4" style="align-items:flex-start;">
        <!-- Left: mode selection -->
        <div style="width:280px;min-width:280px;">
          <div class="card" style="padding:12px;">
            <div class="form-group" style="margin-bottom:12px;">
              <label class="form-label">Client GSTIN</label>
              <select id="sel-gstin">
                ${state.clients.map(c => `<option value="${c.gstin}" ${state.gstin===c.gstin?'selected':''}>${c.gstin}</option>`).join('')}
              </select>
            </div>
            ${MODES.map(m => `
              <div class="nav-item ${state.mode===m.id?'active':''}" data-mode="${m.id}"
                   style="border-left:3px solid ${state.mode===m.id?m.color:'transparent'};flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;">
                <div style="display:flex;gap:8px;align-items:center;">
                  <span>${m.icon}</span>
                  <span style="font-weight:600;font-size:13px;">${m.label}</span>
                </div>
                <span style="font-size:11px;color:var(--text-muted);padding-left:24px;">${m.desc}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Right: configuration and preview -->
        <div style="flex:1;">
          ${!state.mode ? `
            <div class="card" style="text-align:center;padding:48px;">
              <div style="font-size:36px;margin-bottom:12px;">🔍</div>
              <p class="text-muted">Select a deletion mode to configure and preview.</p>
            </div>
          ` : `
            <div class="card">
              <div class="card-title" style="color:${modeConfig.color};">${modeConfig.icon} ${modeConfig.label}</div>

              ${modeConfig.needsType ? `
                <div class="form-group">
                  <label class="form-label">Source Type</label>
                  <select id="sel-type">
                    <option value="2B" ${state.sourceType==='2B'?'selected':''}>GSTR-2B</option>
                    <option value="PR" ${state.sourceType==='PR'?'selected':''}>Purchase Register</option>
                  </select>
                </div>
              ` : ''}

              ${modeConfig.needsPeriod ? `
                <div class="form-group">
                  <label class="form-label">Tax Period</label>
                  <select id="sel-period">
                    <option value="">-- Select period --</option>
                    ${state.periods.map(p => `<option value="${p}" ${state.period===p?'selected':''}>${p}</option>`).join('')}
                  </select>
                </div>
              ` : ''}

              <button class="btn btn-ghost btn-sm" id="btn-preview">Preview Impact</button>

              ${state.loading ? `<div class="loading-center" style="padding:24px;"><div class="spinner"></div></div>` : ''}

              ${state.preview && !state.loading ? `
                <div class="alert ${modeConfig.isNuclear ? 'alert-danger' : 'alert-warning'} mt-2">
                  <strong>Impact Preview</strong><br/>
                  Total records to be deleted: <strong>${state.preview.total_rows}</strong><br/>
                  Database size: <strong>${state.preview.size_mb} MB</strong>
                  <div class="table-wrap mt-2">
                    <table style="font-size:12px;">
                      <thead><tr><th>Table</th><th>Rows</th></tr></thead>
                      <tbody>
                        ${Object.entries(state.preview.rows || {}).map(([t,n]) =>
                          `<tr><td class="font-mono">${t}</td><td>${n}</td></tr>`
                        ).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>

                <hr class="divider"/>

                <div class="alert alert-danger">
                  <strong>Confirmation Required</strong><br/>
                  Type the client GSTIN to confirm deletion:
                  <span class="font-mono" style="display:block;margin:8px 0;font-size:14px;color:var(--text-primary);">${state.gstin}</span>
                  <input type="text" id="confirm-gstin" value="${state.confirmGstin}"
                    placeholder="Type GSTIN here" style="font-family:monospace;margin-top:6px;" />
                </div>

                <button class="btn btn-danger btn-lg w-full" id="btn-execute"
                  ${state.confirmGstin !== state.gstin ? 'disabled' : ''}>
                  🗑 Execute Deletion
                </button>
              ` : ''}
            </div>
          `}
        </div>
      </div>
    `;

    container.querySelector('#sel-gstin')?.addEventListener('change', async e => {
      state.gstin = e.target.value;
      state.preview = null;
      setState({ selectedClient: state.gstin });
      await loadPeriods();
      render();
    });

    container.querySelectorAll('[data-mode]').forEach(el => {
      el.addEventListener('click', () => {
        state.mode = el.dataset.mode;
        state.preview = null;
        state.confirmGstin = '';
        render();
      });
    });

    container.querySelector('#sel-type')?.addEventListener('change', e => { state.sourceType = e.target.value; });
    container.querySelector('#sel-period')?.addEventListener('change', e => { state.period = e.target.value; });
    container.querySelector('#btn-preview')?.addEventListener('click', () => fetchPreview());

    container.querySelector('#confirm-gstin')?.addEventListener('input', e => {
      state.confirmGstin = e.target.value;
      const btn = container.querySelector('#btn-execute');
      if (btn) btn.disabled = state.confirmGstin !== state.gstin;
    });

    container.querySelector('#btn-execute')?.addEventListener('click', () => executeDelete());
  }

  await loadClients();
}
