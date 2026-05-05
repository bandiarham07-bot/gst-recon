const api = window.electronAPI
  ? window.electronAPI.api
  : async ({ method, path, body }) => {
      const res = await fetch(`http://localhost:7432${path}`, {
        method: method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return res.json();
    };

export const openFileDialog = window.electronAPI?.openFileDialog
  || (() => Promise.resolve(null));

export const saveFileDialog = window.electronAPI?.saveFileDialog
  || (() => Promise.resolve(null));

// Clients
export const listClients = () => api({ method: 'GET', path: '/clients' });
export const initClient = (gstin, legal_name) =>
  api({ method: 'POST', path: `/clients/${gstin}/init`, body: { legal_name } });
export const getClientMeta = (gstin) =>
  api({ method: 'GET', path: `/clients/${gstin}/meta` });
export const getClientPeriods = (gstin) =>
  api({ method: 'GET', path: `/clients/${gstin}/periods` });
export const getClientBatches = (gstin) =>
  api({ method: 'GET', path: `/clients/${gstin}/batches` });
export const getClientStorage = (gstin) =>
  api({ method: 'GET', path: `/clients/${gstin}/storage` });

// File detection
export const detectFile = (path) =>
  api({ method: 'POST', path: '/detect', body: { path } });

// Import 2B
export const import2B = (path, gstin) =>
  api({ method: 'POST', path: '/import/2b', body: { path, gstin } });

// Import EPR
export const detectEPRHeader = (path, sheet_name) =>
  api({ method: 'POST', path: '/import/epr/detect-header', body: { path, sheet_name } });
export const mapEPRColumns = (raw_columns) =>
  api({ method: 'POST', path: '/import/epr/map-columns', body: { raw_columns } });
export const importEPR = (payload) =>
  api({ method: 'POST', path: '/import/epr', body: payload });

// Data browser
export const browseData = (gstin, source_type, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return api({ method: 'GET', path: `/clients/${gstin}/data/${source_type}?${qs}` });
};

// Deletion
export const previewDeletion = (gstin, body) =>
  api({ method: 'POST', path: `/clients/${gstin}/delete/preview`, body });
export const deletePeriod = (gstin, body) =>
  api({ method: 'POST', path: `/clients/${gstin}/delete/period`, body });
export const deletePR = (gstin, body) =>
  api({ method: 'POST', path: `/clients/${gstin}/delete/pr`, body });
export const deleteClient = (gstin, body) =>
  api({ method: 'POST', path: `/clients/${gstin}/delete/client`, body });
export const nuclearDelete = (gstin, body) =>
  api({ method: 'POST', path: `/clients/${gstin}/delete/nuclear`, body });

// Plugins
export const listPlugins = () => api({ method: 'GET', path: '/plugins' });
export const registerPlugin = (body) =>
  api({ method: 'POST', path: '/plugins/register', body });
export const runReconciliation = (gstin, plugin_name) =>
  api({ method: 'POST', path: `/clients/${gstin}/reconcile`, body: { plugin_name } });
