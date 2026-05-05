const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const API_BASE = 'http://localhost:7432';
let mainWindow;
let backendProcess;

function startBackend() {
  const scriptPath = path.join(__dirname, 'backend', 'server.py');
  backendProcess = spawn('python3', ['-u', scriptPath], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backendProcess.stdout.on('data', (d) => console.log('[backend]', d.toString()));
  backendProcess.stderr.on('data', (d) => console.error('[backend]', d.toString()));
  backendProcess.on('exit', (code) => console.log('[backend] exited with code', code));
}

function waitForBackend(cb, attempts = 0) {
  if (attempts > 30) { cb(new Error('Backend failed to start')); return; }
  http.get(`${API_BASE}/clients`, (res) => {
    if (res.statusCode === 200) cb(null);
    else setTimeout(() => waitForBackend(cb, attempts + 1), 500);
  }).on('error', () => setTimeout(() => waitForBackend(cb, attempts + 1), 500));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
  });
  mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));
}

app.whenReady().then(() => {
  startBackend();
  waitForBackend((err) => {
    if (err) console.error('Could not connect to backend:', err);
    createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

// IPC: file dialog
ipcMain.handle('open-file-dialog', async (_, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    ...opts,
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('save-file-dialog', async (_, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    ...opts,
  });
  return result.canceled ? null : result.filePath;
});

// IPC: API proxy
ipcMain.handle('api', async (_, { method, path: apiPath, body }) => {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 7432,
      path: apiPath,
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch { resolve({ success: false, error: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
});
