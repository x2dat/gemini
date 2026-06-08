const { app, BrowserWindow, ipcMain, screen, session, Menu } = require('electron');
const path = require('path');

// Prevent single instance lock conflicts
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  let mainWindow;
  let expanded = false;

  const COLLAPSED = { width: 340, height: 52 };
  const EXPANDED = { width: 340, height: 350 };

  function createWindow() {
    const { x: sx, y: sy, width: sw, height: sh } = screen.getPrimaryDisplay().workArea;

    const customUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    const setupSession = (ses) => {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        if (!details.url.startsWith('http://') && !details.url.startsWith('https://')) {
          callback({ cancel: false });
          return;
        }

        const { requestHeaders } = details;

        const uaKey = Object.keys(requestHeaders).find(k => k.toLowerCase() === 'user-agent') || 'User-Agent';
        requestHeaders[uaKey] = customUA;

        for (const key of Object.keys(requestHeaders)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey.startsWith('sec-ch-ua')) {
            delete requestHeaders[key];
          }
        }

        requestHeaders['sec-ch-ua'] = '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Meow";v="99"';
        requestHeaders['sec-ch-ua-mobile'] = '?0';
        requestHeaders['sec-ch-ua-platform'] = '"Windows"';

        callback({ requestHeaders });
      });
    };

    setupSession(session.defaultSession);
    setupSession(session.fromPartition('persist:gemini'));

    mainWindow = new BrowserWindow({
      width: COLLAPSED.width,
      height: COLLAPSED.height,
      x: sx + sw - COLLAPSED.width - 20,
      y: sy + sh - COLLAPSED.height - 20,
      frame: false,
      transparent: true,
      alwaysOnTop: false,
      resizable: true,
      minimizable: true,
      maximizable: false,
      skipTaskbar: false,
      hasShadow: true,
      maxWidth: 800,
      maxHeight: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webviewTag: true,
      }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  app.whenReady().then(() => {
    createWindow();
  });

  const template = [
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  ipcMain.on('toggle-expand', () => {
    expanded = !expanded;

    const winBounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(winBounds);
    const { x: sx, y: sy, width: sw, height: sh } = display.workArea;

    let targetWidth, targetHeight;
    if (expanded) {
      targetWidth = Math.min(EXPANDED.width, sw - 40);
      targetHeight = Math.min(EXPANDED.height, sh - 40);
    } else {
      targetWidth = COLLAPSED.width;
      targetHeight = COLLAPSED.height;
    }

    const targetX = sx + sw - targetWidth - 20;
    const targetY = sy + sh - targetHeight - 20;

    mainWindow.setSize(targetWidth, targetHeight, true);
    mainWindow.setPosition(targetX, targetY, true);
  });

  ipcMain.on('hide-app', () => {
    mainWindow.minimize();
  });

  ipcMain.on('close-app', () => app.quit());

  ipcMain.on('import-cookies', async (event, cookieStr) => {
    try {
      const ses = session.fromPartition('persist:gemini');
      let cookies = [];

      const trimmed = cookieStr.trim();
      if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        cookies = parsed.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure !== undefined ? c.secure : true,
          httpOnly: c.httpOnly !== undefined ? c.httpOnly : true,
          expirationDate: c.expirationDate || (Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365)
        }));
      } else if (trimmed.includes('\t')) {
        const lines = trimmed.split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          const cols = line.split('\t');
          if (cols.length < 2) continue;

          const name = cols[0].trim();
          const value = cols[1].trim();

          const lowerName = name.toLowerCase();
          if (lowerName === 'name' || value.toLowerCase() === 'value' || lowerName.includes('expires') || lowerName.includes('samesite')) {
            continue;
          }

          const domain = cols[2] ? cols[2].trim() : '.google.com';
          const path = cols[3] ? cols[3].trim() : '/';
          const httpOnly = cols[6] ? (cols[6].includes('✓') || cols[6].toLowerCase() === 'true') : true;
          const secure = cols[7] ? (cols[7].includes('✓') || cols[7].toLowerCase() === 'true') : true;

          cookies.push({
            name,
            value,
            domain,
            path,
            secure,
            httpOnly,
            expirationDate: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365)
          });
        }
      } else {
        cookies = trimmed.split(';').map(item => {
          const parts = item.split('=');
          if (parts.length < 2) return null;
          const name = parts[0].trim();
          const value = parts.slice(1).join('=').trim();

          const lowerName = name.toLowerCase();
          if (['domain', 'path', 'expires', 'samesite', 'secure', 'httponly', 'maxage', 'max-age', 'priority'].includes(lowerName)) {
            return null;
          }

          return {
            name,
            value,
            domain: '.google.com',
            path: '/',
            secure: true,
            httpOnly: true,
            expirationDate: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365)
          };
        }).filter(Boolean);
      }

      if (cookies.length === 0) {
        throw new Error("Aucun cookie valide n'a pu être extrait.");
      }

      const hasAuthCookie = cookies.some(c => c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID');
      if (!hasAuthCookie) {
        throw new Error("Le cookie d'authentification de session (__Secure-1PSID) est manquant. Assurez-vous d'être bien connecté sur Gemini dans votre navigateur.");
      }

      for (const c of cookies) {
        if (!c.name || !c.value) continue;

        const cookieDetails = {
          url: c.domain ? `https://${c.domain.startsWith('.') ? c.domain.substring(1) : c.domain}` : 'https://gemini.google.com',
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate
        };

        if (c.name.startsWith('__Host-')) {
          delete cookieDetails.domain;
          cookieDetails.url = 'https://gemini.google.com';
        }

        try {
          await ses.cookies.set(cookieDetails);
        } catch (err) {
          console.error(`Failed to set cookie ${c.name}:`, err);
        }
      }

      event.reply('import-cookies-success');
    } catch (err) {
      event.reply('import-cookies-error', err.message);
    }
  });

  ipcMain.on('webview-log', (event, message) => {
    console.log(`[Webview] ${message}`);
  });

  app.on('window-all-closed', () => app.quit());
}
