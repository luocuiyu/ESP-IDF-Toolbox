import { contextBridge, ipcRenderer } from "electron";
import type { AddComponentDependencyRequest, CreateProjectFromExampleRequest, KconfigValue, ProjectSettings, SdkconfigEntry, TaskRequest } from "./types.js";

function toCloneable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

contextBridge.exposeInMainWorld("idfApi", {
  discoverIdf: () => ipcRenderer.invoke("idf:discover"),
  chooseIdf: () => ipcRenderer.invoke("idf:choose"),
  chooseProject: () => ipcRenderer.invoke("project:choose"),
  listExamples: (idfPath: string) => ipcRenderer.invoke("project:examples", idfPath),
  createProject: (args: { name: string; examplePath?: string }) => ipcRenderer.invoke("project:create", args),
  getTargets: (idfPath: string) => ipcRenderer.invoke("idf:targets", idfPath),
  getCapabilities: (idfPath: string, target: string) => ipcRenderer.invoke("idf:capabilities", idfPath, target),
  runDoctor: (idfPath: string, projectPath: string, target: string) => ipcRenderer.invoke("doctor:run", idfPath, projectPath, target),
  getPorts: () => ipcRenderer.invoke("serial:ports"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveProjectSettings: (projectPath: string, settings: ProjectSettings) =>
    ipcRenderer.invoke("settings:save-project", projectPath, toCloneable(settings)),
  runTask: (request: TaskRequest) => ipcRenderer.invoke("task:run", toCloneable(request)),
  cancelTask: () => ipcRenderer.invoke("task:cancel"),
  openMenuconfig: (projectPath: string, idfPath: string) =>
    ipcRenderer.invoke("task:menuconfig", projectPath, idfPath),
  openIdfTerminal: (projectPath: string, idfPath: string) => ipcRenderer.invoke("task:terminal", projectPath, idfPath),
  openGdb: (projectPath: string, idfPath: string, buildDir?: string) => ipcRenderer.invoke("task:gdb", projectPath, idfPath, buildDir),
  readSdkconfig: (projectPath: string) => ipcRenderer.invoke("sdkconfig:read", projectPath),
  saveSdkconfig: (projectPath: string, updates: SdkconfigEntry[]) => ipcRenderer.invoke("sdkconfig:save", projectPath, toCloneable(updates)),
  readKconfig: (projectPath: string, idfPath: string, buildDir?: string) => ipcRenderer.invoke("kconfig:read", projectPath, idfPath, buildDir),
  updateKconfig: (sessionId: string, projectPath: string, idfPath: string, changes: Record<string, KconfigValue>, buildDir?: string) => ipcRenderer.invoke("kconfig:update", sessionId, projectPath, idfPath, toCloneable(changes), buildDir),
  saveKconfig: (sessionId: string, projectPath: string, idfPath: string, buildDir?: string) => ipcRenderer.invoke("kconfig:save", sessionId, projectPath, idfPath, buildDir),
  discardKconfig: (sessionId: string, projectPath: string, idfPath: string, buildDir?: string) => ipcRenderer.invoke("kconfig:discard", sessionId, projectPath, idfPath, buildDir),
  resetKconfigToDefaults: (sessionId: string, projectPath: string, idfPath: string, buildDir?: string) => ipcRenderer.invoke("kconfig:reset-defaults", sessionId, projectPath, idfPath, buildDir),
  closeKconfig: (sessionId: string) => ipcRenderer.invoke("kconfig:close", sessionId),
  openCsvEditor: (kind: "partition" | "nvs", projectPath: string) => ipcRenderer.invoke("editor:open-csv", kind, projectPath),
  readEditorText: (file: string) => ipcRenderer.invoke("editor:read-text", file),
  saveEditorText: (file: string, content: string) => ipcRenderer.invoke("editor:save-text", file, content),
  chooseKeyFile: (projectPath: string) => ipcRenderer.invoke("editor:choose-key", projectPath),
  generateNvsPartition: (idfPath: string, csvFile: string, options: { encrypt: boolean; encryptKeyPath: string; generateKey: boolean; partitionSize: string }) => ipcRenderer.invoke("nvs:generate", idfPath, csvFile, toCloneable(options)),
  analyzeSize: (projectPath: string, idfPath: string, buildDir?: string) => ipcRenderer.invoke("size:analyze", projectPath, idfPath, buildDir),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  createComponent: (projectPath: string, idfPath: string, name: string, buildDir?: string) => ipcRenderer.invoke("project:create-component", projectPath, idfPath, name, buildDir),
  addComponentDependency: (projectPath: string, idfPath: string, dependency: string, component = "main", buildDir?: string) => {
    const request: AddComponentDependencyRequest = { projectPath, idfPath, dependency, component, buildDir };
    return ipcRenderer.invoke("component:add-dependency", toCloneable(request));
  },
  createProjectFromComponentExample: (idfPath: string, example: string) => {
    const request: CreateProjectFromExampleRequest = { idfPath, example };
    return ipcRenderer.invoke("component:create-project-from-example", toCloneable(request));
  },
  addSupportFiles: (projectPath: string, kind: "vscode" | "devcontainer", idfPath?: string) => ipcRenderer.invoke("project:add-support-files", projectPath, kind, idfPath),
  installQemu: (projectPath: string, idfPath: string) => ipcRenderer.invoke("tool:install-qemu", projectPath, idfPath),
  openInstallManager: (idfPath: string) => ipcRenderer.invoke("tool:install-manager", idfPath),
  installAdf: (projectPath: string, idfPath: string) => ipcRenderer.invoke("tool:install-adf", projectPath, idfPath),
  getJtagDevices: () => ipcRenderer.invoke("jtag:devices"),
  startMonitor: (port: string, baud: number) => ipcRenderer.invoke("serial:start", port, baud),
  stopMonitor: (port?: string) => ipcRenderer.invoke("serial:stop", port),
  writeSerial: (port: string, data: string, mode: "text" | "hex") => ipcRenderer.invoke("serial:write", port, data, mode),
  saveLog: (content: string) => ipcRenderer.invoke("log:save", content),
  playCompletionSound: () => ipcRenderer.invoke("notification:completion-sound"),
  onTaskOutput: (callback: (data: { stream: string; text: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { stream: string; text: string }) => callback(data);
    ipcRenderer.on("task:output", listener);
    return () => ipcRenderer.removeListener("task:output", listener);
  },
  onTaskState: (callback: (data: { running: boolean; code?: number; action?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { running: boolean; code?: number; action?: string }) => callback(data);
    ipcRenderer.on("task:state", listener);
    return () => ipcRenderer.removeListener("task:state", listener);
  },
  onSerialData: (callback: (data: { type: string; port?: string; data?: string; message?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { type: string; port?: string; data?: string; message?: string }) => callback(data);
    ipcRenderer.on("serial:data", listener);
    return () => ipcRenderer.removeListener("serial:data", listener);
  }
});
