// Preload: bezpečný most mezi Electron main procesem a dashboardem (renderer).
// contextIsolation je zapnuté, takže se API vystavuje přes contextBridge.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Verze aplikace (roh dashboardu).
  getVersion: () => ipcRenderer.invoke("app:getVersion"),

  // Stav auto-updatu: main proces posílá { state, version, notes }.
  //   state: "available" | "downloaded" | "none" | "error"
  onUpdate: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("update:status", handler);
    // vyžádat aktuální stav (kdyby událost přišla před připojením listeneru)
    ipcRenderer.send("update:request");
    return () => ipcRenderer.removeListener("update:status", handler);
  },

  // Restartovat a nainstalovat stažený update.
  installUpdate: () => ipcRenderer.send("update:install"),
});
