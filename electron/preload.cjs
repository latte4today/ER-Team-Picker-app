const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("erUpdater", {
  check: () => ipcRenderer.invoke("auto-update:check"),
  install: () => ipcRenderer.invoke("auto-update:install"),
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("auto-update:status", listener);
    return () => ipcRenderer.removeListener("auto-update:status", listener);
  },
});
