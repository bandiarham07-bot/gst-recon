import { listClients, getClientPeriods, runReconciliation, listPlugins } from '../api.js';

export async function renderDashboard(container, { getState, setState, navigateTo }) {
  container.innerHTML = `<div class="loading-center"><div class="spinner"></div><span>Loading clients...</span></div>`;

  let clients = [];
  let plugins = [];
  try {
    const [cr, pr] = await Promise.all([listClients(), listPlugins()]);
    clients = cr.data || [];
    plugins = pr.data || [];
  } catch (e) {
    container.innerHTML = `<div class="alert alert-danger">Failed to load: ${e.message}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="screen-header">
      <div>
        <div class="screen-title">Dashboard</div>
        <div class="screen-subtitle">All registered GST clients</div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-sm" id="btn-add-client">＋ Add Client</button>
        <button class="btn btn-primary btn-sm" id="btn-import">📥 Import File</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="label">Total Clients</div>
        <div class="value">${clients.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Plugins Loaded</div>
        <div class="value">${plugins.length}</div>
        <div class="sub">${plugins.length === 0 ? 'No reconciliation engine' : plugins.map(p => p.name).join(', ')}</div>
      </div>
    </div>

    ${clients.length === 0 ? `
      <div class="card" style="text-align:center;padding:48px;">
        <div style="font-size:40px;margin-bottom:12px;">📂</div>
        <h3 style="margin-bottom:8px;">No clients yet</h3>
        <p class="text-muted">Add a client and import their GSTR-2B or Purchase Register files.</p>
        <button class="btn btn-primary mt-4" id="btn-add-client-empty">＋ Add Client</button>
      </div>
    ` : `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>GSTIN</th>
              <th>Legal Name</th>
              <th>Last Import</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${clients.map(c => `
              <tr>
                <td><span class="font-mono">${c.gstin || '—'}</span></td>
                <td>${c.legal_name || '—'}</td>
                <td>${c.last_import ? new Date(c.last_import).toLocaleDateString('en-IN') : '—'}</td>
                <td>
                  <div class="flex gap-2">
                    <button class="btn btn-ghost btn-sm btn-select-client" data-gstin="${c.gstin}">Select</button>
                    <button class="btn btn-ghost btn-sm btn-browse" data-gstin="${c.gstin}">Browse Data</button>
                    ${plugins.length > 0 ? `<button class="btn btn-ghost btn-sm btn-recon" data-gstin="${c.gstin}" data-plugin="${plugins[0].name}">⚙ Reconcile</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  container.querySelector('#btn-import')?.addEventListener('click', () => navigateTo('import'));
  container.querySelector('#btn-add-client')?.addEventListener('click', () => navigateTo('clients'));
  container.querySelector('#btn-add-client-empty')?.addEventListener('click', () => navigateTo('clients'));

  container.querySelectorAll('.btn-select-client').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ selectedClient: btn.dataset.gstin });
      navigateTo('dashboard');
    });
  });

  container.querySelectorAll('.btn-browse').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ selectedClient: btn.dataset.gstin });
      navigateTo('browser');
    });
  });

  container.querySelectorAll('.btn-recon').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '⚙ Running...';
      try {
        const res = await runReconciliation(btn.dataset.gstin, btn.dataset.plugin);
        alert(res.success ? 'Reconciliation complete.' : `Error: ${res.error}`);
      } catch (e) {
        alert('Error: ' + e.message);
      }
      btn.disabled = false;
      btn.textContent = '⚙ Reconcile';
    });
  });
}
