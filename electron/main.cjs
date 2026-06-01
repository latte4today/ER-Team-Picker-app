const { app, BrowserWindow, Menu, desktopCapturer, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

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
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}/index.html`);
    });
  });
}

async function createWindow() {
  const url = await startStaticServer();

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ["window", "screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });
    callback({ video: sources[0], audio: null });
  });

  const mainWindow = new BrowserWindow({
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
    },
  });

  Menu.setApplicationMenu(null);
  await mainWindow.loadURL(url);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
