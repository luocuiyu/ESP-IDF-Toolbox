interface IdfSetup {
  id: string;
  version: string;
  idfPath: string;
  toolsPath: string;
  pythonPath: string;
  valid: boolean;
  missing: string[];
}

interface PortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

interface JtagDevice {
  serial: string;
  label: string;
  port?: string;
}

interface ProjectSettings {
  idfPath: string;
  target: string;
  port?: string;
  flashPort: string;
  monitorPort: string;
  jtagSerial?: string;
  flashMethod: "UART" | "JTAG" | "DFU";
  flashBaud: number;
  monitorBaud: number;
  autoMonitor: boolean;
  completionSound?: boolean;
  activeProfile: string;
  profiles: string[];
  openOcdConfig: string;
  customTasks: Array<{ name: string; command: string }>;
}

interface AddComponentDependencyRequest {
  projectPath: string;
  idfPath: string;
  dependency: string;
  component?: string;
  buildDir?: string;
}

interface CreateProjectFromExampleRequest {
  idfPath: string;
  example: string;
}

interface TaskRequest {
  action: "build" | "set-target" | "flash" | "app-flash" | "bootloader-flash" | "partition-table-flash" | "encrypted-flash" | "efuse-summary" | "erase" | "fullclean" | "reconfigure" | "save-defconfig" | "size" | "size-components" | "size-files" | "app" | "bootloader" | "partition-table" | "diag" | "openocd" | "qemu" | "component-add" | "custom";
  projectPath: string;
  idfPath: string;
  port?: string;
  target?: string;
  baud?: number;
  buildDir?: string;
  flashMethod?: "UART" | "JTAG" | "DFU";
  openOcdConfig?: string;
  jtagSerial?: string;
  component?: string;
  dependency?: string;
  customCommand?: string;
}

interface ToolCapabilities { git: string; openocd: string; dfuUtil: string; qemuXtensa: string; qemuRiscv: string; gdb: string; }
interface DoctorCheck { name: string; ok: boolean; detail: string; }
interface SdkconfigEntry { key: string; value: string; enabled: boolean; }
type KconfigValue = boolean | number | string;
interface KconfigNode {
  id: string;
  name?: string;
  title?: string;
  type: "menu" | "choice" | "bool" | "int" | "hex" | "string";
  help?: string;
  depends_on?: string;
  range?: [number, number] | null;
  children: KconfigNode[];
}
interface KconfigState {
  sessionId: string;
  menus: KconfigNode[];
  values: Record<string, KconfigValue>;
  ranges: Record<string, [number, number]>;
  visible: Record<string, boolean>;
  errors?: string[];
}

interface Window {
  idfApi: {
    discoverIdf(): Promise<IdfSetup[]>;
    chooseIdf(): Promise<IdfSetup | null>;
    chooseProject(): Promise<string | null>;
    listExamples(idfPath: string): Promise<Array<{ name: string; path: string; group: string }>>;
    createProject(args: { name: string; examplePath?: string }): Promise<string | null>;
    getTargets(idfPath: string): Promise<Array<{ target: string; preview: boolean }>>;
    getCapabilities(idfPath: string, target: string): Promise<ToolCapabilities>;
    runDoctor(idfPath: string, projectPath: string, target: string): Promise<DoctorCheck[]>;
    getPorts(): Promise<PortInfo[]>;
    loadSettings(): Promise<{ lastProject: string; projects: Record<string, ProjectSettings> }>;
    saveProjectSettings(projectPath: string, settings: ProjectSettings): Promise<boolean>;
    runTask(request: TaskRequest): Promise<boolean>;
    cancelTask(): Promise<boolean>;
    openMenuconfig(projectPath: string, idfPath: string): Promise<boolean>;
    openIdfTerminal(projectPath: string, idfPath: string): Promise<boolean>;
    openGdb(projectPath: string, idfPath: string, buildDir?: string): Promise<boolean>;
    readSdkconfig(projectPath: string): Promise<SdkconfigEntry[]>;
    saveSdkconfig(projectPath: string, updates: SdkconfigEntry[]): Promise<boolean>;
    readKconfig(projectPath: string, idfPath: string, buildDir?: string): Promise<KconfigState>;
    updateKconfig(sessionId: string, projectPath: string, idfPath: string, changes: Record<string, KconfigValue>, buildDir?: string): Promise<KconfigState>;
    saveKconfig(sessionId: string, projectPath: string, idfPath: string, buildDir?: string): Promise<KconfigState>;
    discardKconfig(sessionId: string, projectPath: string, idfPath: string, buildDir?: string): Promise<KconfigState>;
    resetKconfigToDefaults(sessionId: string, projectPath: string, idfPath: string, buildDir?: string): Promise<KconfigState>;
    closeKconfig(sessionId: string): Promise<boolean>;
    openCsvEditor(kind: "partition" | "nvs", projectPath: string): Promise<{ path: string; csv: string }>;
    readEditorText(file: string): Promise<string>;
    saveEditorText(file: string, content: string): Promise<boolean>;
    chooseKeyFile(projectPath: string): Promise<string>;
    generateNvsPartition(idfPath: string, csvFile: string, options: { encrypt: boolean; encryptKeyPath: string; generateKey: boolean; partitionSize: string }): Promise<{ output: string; log: string }>;
    analyzeSize(projectPath: string, idfPath: string, buildDir?: string): Promise<{ overview: Record<string, unknown>; archives: Record<string, unknown>; files: Record<string, unknown> }>;
    openExternal(url: string): Promise<void>;
    createComponent(projectPath: string, idfPath: string, name: string, buildDir?: string): Promise<boolean>;
    addComponentDependency(projectPath: string, idfPath: string, dependency: string, component?: string, buildDir?: string): Promise<boolean>;
    createProjectFromComponentExample(idfPath: string, example: string): Promise<string | null>;
    addSupportFiles(projectPath: string, kind: "vscode" | "devcontainer", idfPath?: string): Promise<string>;
    installQemu(projectPath: string, idfPath: string): Promise<boolean>;
    openInstallManager(idfPath: string): Promise<boolean>;
    installAdf(projectPath: string, idfPath: string): Promise<boolean>;
    getJtagDevices(): Promise<JtagDevice[]>;
    startMonitor(port: string, baud: number): Promise<boolean>;
    stopMonitor(port?: string): Promise<boolean>;
    writeSerial(port: string, data: string, mode: "text" | "hex"): Promise<boolean>;
    saveLog(content: string): Promise<boolean>;
    playCompletionSound(): Promise<boolean>;
    onTaskOutput(callback: (data: { stream: string; text: string }) => void): () => void;
    onTaskState(callback: (data: { running: boolean; code?: number; action?: string }) => void): () => void;
    onSerialData(callback: (data: { type: string; port?: string; data?: string; message?: string }) => void): () => void;
  };
}
