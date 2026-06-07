const { app, BrowserWindow, Menu, desktopCapturer, ipcMain, session, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let autoUpdater;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch (_error) {
  autoUpdater = undefined;
}

const ROOT = path.resolve(__dirname, "..");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

let server;
let mainWindow;

function safePathFromUrl(url) {
  const parsed = new URL(url, "http://127.0.0.1");
  const pathname = decodeURIComponent(parsed.pathname === "/" ? "/index.html" : parsed.pathname);
  const requested = path.resolve(ROOT, `.${pathname}`);
  if (!requested.startsWith(ROOT)) return undefined;
  return requested;
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const filePath = safePathFromUrl(request.url);
      if (!filePath) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        response.writeHead(200, {
          "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
        });
        response.end(data);
      });
    });

    server.on("error", reject);
    const FIXED_PORT = 34579;
    server.listen(FIXED_PORT, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}/index.html`);
    });
  });
}

function sendUpdateStatus(payload) {
  mainWindow?.webContents.send("auto-update:status", payload);
}

function setupAutoUpdater() {
  if (!autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({ type: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({ type: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", (info) => {
    sendUpdateStatus({ type: "not-available", version: info.version });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus({
      type: "progress",
      percent: Math.round(progress.percent ?? 0),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendUpdateStatus({ type: "downloaded", version: info.version });
  });

  autoUpdater.on("error", (error) => {
    sendUpdateStatus({
      type: "error",
      message: error.message,
    });
  });
}

ipcMain.handle("auto-update:check", async () => {
  if (!autoUpdater) {
    sendUpdateStatus({ type: "unavailable", message: "자동 업데이트 모듈이 설치되어 있지 않습니다." });
    return { ok: false };
  }

  if (!app.isPackaged) {
    sendUpdateStatus({ type: "dev", message: "개발 실행에서는 자동 업데이트가 꺼져 있습니다." });
    return { ok: false };
  }

  await autoUpdater.checkForUpdates();
  return { ok: true };
});

ipcMain.handle("auto-update:install", () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false };
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

async function createWindow() {
  const url = await startStaticServer();
  const appSession = session.fromPartition("persist:er-team-picker");

  appSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });
    callback({ video: sources[0], audio: null });
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "Eternal Return Team Picker",
    icon: path.join(ROOT, "assets", "app-icon.png"),
    backgroundColor: "#101116",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      session: appSession,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  await mainWindow.loadURL(url);
}

app.whenReady().then(() => {
  setupAutoUpdater();
  createWindow();
});

app.on("window-all-closed", () => {
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
