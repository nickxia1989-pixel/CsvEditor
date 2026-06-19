const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("csvDesktop", {
  pickDirectory: () => ipcRenderer.invoke("csv:pick-directory"),
  listDirectory: (directoryPath) => ipcRenderer.invoke("csv:list-directory", directoryPath),
  readFile: (filePath) => ipcRenderer.invoke("csv:read-file", filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke("csv:write-file", filePath, data),
  getVersion: (filePath) => ipcRenderer.invoke("csv:get-version", filePath),
  openSvnCommit: (directoryPath) => ipcRenderer.invoke("csv:open-svn-commit", directoryPath),
  openSvnUpdate: (directoryPath) => ipcRenderer.invoke("csv:open-svn-update", directoryPath),
  getWindowState: () => ipcRenderer.invoke("csv:window-get-state"),
  minimizeWindow: () => ipcRenderer.invoke("csv:window-minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("csv:window-toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("csv:window-close"),
  getFavorites: () => ipcRenderer.invoke("csv:favorites-get"),
  setFavorites: (favorites) => ipcRenderer.invoke("csv:favorites-set", favorites),
  getWorkspaceState: () => ipcRenderer.invoke("csv:workspace-get"),
  setWorkspaceState: (workspace) => ipcRenderer.invoke("csv:workspace-set", workspace),
  onWindowStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("csv:window-state", listener);
    return () => ipcRenderer.removeListener("csv:window-state", listener);
  }
});
