import { listClients, initClient, getClientStorage, getClientPeriods, getClientBatches } from '../api.js';

export async function renderClientManager(container, { getState, setState, navigateTo }) {
  let clients = [];
  let selectedGstin = null;
  let clientDetail = null;

  async function loadClients() {
    try {
      const res = await listClients();
      clients = res.data || [];
    } catch {}
    render();
  }

  async function loadClientDetail(gstin) {
    selectedGstin = gstin;
    setState({ selectedClient: gstin });
    try {
      const [storage, periods, batches] = await Promise.all([
        getClientStorage(gstin),
        getClientPeriods(gstin),
        getClientBatches(gstin),
      ]);
      clientDetail = {
        storage: storage.data?.bytes || 0,
        periods: periods.data || [],
        batches: batches.data || [],
      };
    } catch {
      clientDetail = { storage: 0, periods: [], batches: [] };
    }
    render();
  }

  function render() {
    container.innerHTML = `
      <div class="screen-header">
        <div>
          <div class="screen-title">Client Manager</div>
          <div class="screen-subtitle">Manage GST client registrations</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-add">＋ Add Client</button>
      </div>

      <div class="flex gap-4" style="align-items:flex-start;">
        <!-- Client list -->
        <div style="width:300px;min-width:300px;">
          <div class="card" style="padding:12px;">
            ${clients.length === 0 ? `<p class="text-muted text-sm" style="padding:8px;">No clients. Add one →</p>` :
              clients.map(c => `
                <div class="nav-item ${selectedGstin === c.gstin ? 'active' : ''}" data-gstin="${c.gstin}" style="width:100%;border-radius:6px;">
                  <div>
                    <div style="font-family:monospace;font-size:12px;">${c.gstin}</div>
                    <div style="font-size:11px;color:${selectedGstin===c.gstin?'rgba(255,255,255,0.7)':'var(--text-muted)'};">${c.legal_name || 'Unknown'}</div>
                  </div>
                </div>
              `).join('')
            }
          </div>
        </div>

        <!-- Detail panel -->
        <div style="flex:1;">
          ${!selectedGstin ? `
            <div class="card" style="text-align:center;padding:48px;">
              <div style="font-size:36px;margin-bottom:12px;">👈</div>
              <p class="text-muted">Select a client to view details</p>
            </div>
          ` : !clientDetail ? `<div class="loading-center"><div class="spinner"></div></div>` : `
            <div class="card">
              <div class="card-title">Client Details</div>
              <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);">
                <div class="stat-card">
                  <div class="label">Storage Used</div>
                  <div class="value">${(clientDetail.storage / 1024).toFixed(1)}<span style="font-size:14px;"> KB</span></div>
                </div>
                <div class="stat-card">
                  <div class="label">Periods Imported</div>
                  <div class="value">${clientDetail.periods.length}</div>
                </div>
                <div class="stat-card">
                  <div class="label">Total Batches</div>
                  <div class="value">${clientDetail.batches.length}</div>
                </div>
              </div>

              <div style="margin-bottom:12px;">
                <div class="text-muted text-sm" style="margin-bottom:6px;">Periods available</div>
                <div class="flex gap-2 flex-wrap">
                  ${clientDetail.periods.length === 0 ? '<span class="text-muted text-sm">None</span>' :
                    clientDetail.periods.map(p => `<span class="badge badge-blue">${p}</span>`).join('')}
                </div>
              </div>

              <div class="flex gap-2">
                <button class="btn btn-secondary btn-sm" id="btn-browse">🔍 Browse Data</button>
                <button class="btn btn-danger btn-sm" id="btn-delete">🗑 Delete Data</button>
              </div>
            </div>

            <div class="card">
              <div class="card-title">Import History</div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Batch ID</th><th>Type</th><th>Period</th><th>Software</th><th>Rows</th><th>Imported</th></tr></thead>
                  <tbody>
                    ${clientDetail.batches.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">No imports yet</td></tr>' :
                      clientDetail.batches.map(b => `
                        <tr>
                          <td class="font-mono">${b.batch_id.slice(0,8)}...</td>
                          <td><span class="badge ${b.source_type==='2B'?'badge-green':'badge-blue'}">${b.source_type}</span></td>
                          <td>${b.tax_period || '—'}</td>
                          <td>${b.epr_software || '—'}</td>
                          <td>${b.row_count}</td>
                          <td>${b.import_ts ? new Date(b.import_ts).toLocaleDateString('en-IN') : '—'}</td>
                        </tr>
                      `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `}
        </div>
      </div>

      <!-- Add client modal -->
      <div id="add-modal" class="modal-overlay hidden">
        <div class="modal">
          <h2>Add New Client</h2>
          <p>Register a new client GSTIN in the system. This creates an encrypted local database for the client.</p>
          <div class="form-group">
            <label class="form-label">GSTIN *</label>
            <input type="text" id="new-gstin" placeholder="23AAGFM2167A1ZU" maxlength="15" style="font-family:monospace;" />
          </div>
          <div class="form-group">
            <label class="form-label">Legal Name</label>
            <input type="text" id="new-name" placeholder="M Mehta & Company" />
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="btn-cancel-add">Cancel</button>
            <button class="btn btn-primary" id="btn-confirm-add">Create Client</button>
          </div>
        </div>
      </div>
    `;

    container.querySelectorAll('[data-gstin]').forEach(el => {
      el.addEventListener('click', () => loadClientDetail(el.dataset.gstin));
    });

    container.querySelector('#btn-browse')?.addEventListener('click', () => navigateTo('browser'));
    container.querySelector('#btn-delete')?.addEventListener('click', () => navigateTo('delete'));

    container.querySelector('#btn-add')?.addEventListener('click', () => {
      container.querySelector('#add-modal').classList.remove('hidden');
    });

    container.querySelector('#btn-cancel-add')?.addEventListener('click', () => {
      container.querySelector('#add-modal').classList.add('hidden');
    });

    container.querySelector('#btn-confirm-add')?.addEventListener('click', async () => {
      const gstin = container.querySelector('#new-gstin').value.trim().toUpperCase();
      const name = container.querySelector('#new-name').value.trim();
      if (!gstin || gstin.length !== 15) {
        alert('Please enter a valid 15-character GSTIN');
        return;
      }
      const btn = container.querySelector('#btn-confirm-add');
      btn.disabled = true;
      btn.textContent = 'Creating...';
      try {
        await initClient(gstin, name);
        container.querySelector('#add-modal').classList.add('hidden');
        await loadClients();
        await loadClientDetail(gstin);
      } catch (e) {
        alert('Error: ' + e.message);
      }
      btn.disabled = false;
      btn.textContent = 'Create Client';
    });
  }

  await loadClients();
}
