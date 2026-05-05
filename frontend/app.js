import { renderDashboard } from './screens/Dashboard.js';
import { renderImportWizard } from './screens/ImportWizard.js';
import { renderDataBrowser } from './screens/DataBrowser.js';
import { renderClientManager } from './screens/ClientManager.js';
import { renderDeleteManager } from './screens/DeleteManager.js';

const SCREENS = {
  dashboard: { label: 'Dashboard', icon: '📊', render: renderDashboard },
  import: { label: 'Import File', icon: '📥', render: renderImportWizard },
  browser: { label: 'Data Browser', icon: '🔍', render: renderDataBrowser },
  clients: { label: 'Clients', icon: '👥', render: renderClientManager },
  delete: { label: 'Delete Manager', icon: '🗑️', render: renderDeleteManager },
};

let currentScreen = 'dashboard';
let appState = { selectedClient: null };

function getState() { return appState; }
function setState(updates) { Object.assign(appState, updates); }
function navigateTo(screen, params = {}) {
  setState(params);
  currentScreen = screen;
  renderShell();
}

function renderShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="sidebar">
      <div class="sidebar-logo">
        <h1>GST Reconciler</h1>
        <span>for Chartered Accountants</span>
      </div>
      <div class="sidebar-section">Navigation</div>
      ${Object.entries(SCREENS).map(([key, s]) => `
        <button class="nav-item ${currentScreen === key ? 'active' : ''}" data-screen="${key}">
          <span class="icon">${s.icon}</span>
          ${s.label}
        </button>
      `).join('')}
      ${appState.selectedClient ? `
        <div class="sidebar-section">Active Client</div>
        <div style="padding: 8px 12px; margin: 0 8px; background: rgba(59,130,246,0.1); border-radius: 8px; border: 1px solid rgba(59,130,246,0.2);">
          <div style="font-size:11px;color:var(--text-muted);">GSTIN</div>
          <div style="font-size:12px;font-weight:600;color:var(--accent);font-family:monospace;">${appState.selectedClient}</div>
        </div>
      ` : ''}
    </div>
    <div class="main-content">
      <div id="screen-content" class="screen active"></div>
    </div>
  `;

  app.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
  });

  const content = document.getElementById('screen-content');
  SCREENS[currentScreen].render(content, { getState, setState, navigateTo });
}

export { getState, setState, navigateTo };
renderShell();
