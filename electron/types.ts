export interface IdfSetup {
  id: string;
  version: string;
  idfPath: string;
  toolsPath: string;
  pythonPath: string;
  valid: boolean;
  missing: string[];
}

export interface PortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

export interface JtagDevice {
  serial: string;
  label: string;
  port?: string;
}

export interface ProjectSettings {
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

export interface AppSettings {
  lastProject: string;
  projects: Record<string, ProjectSettings>;
}

export interface AddComponentDependencyRequest {
  projectPath: string;
  idfPath: string;
  dependency: string;
  component?: string;
  buildDir?: string;
}

export interface CreateProjectFromExampleRequest {
  idfPath: string;
  example: string;
}

export interface TaskRequest {
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

export interface ToolCapabilities {
  git: string;
  openocd: string;
  dfuUtil: string;
  qemuXtensa: string;
  qemuRiscv: string;
  gdb: string;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SdkconfigEntry {
  key: string;
  value: string;
  enabled: boolean;
}

export type KconfigValue = boolean | number | string;

export interface KconfigNode {
  id: string;
  name?: string;
  title?: string;
  type: "menu" | "choice" | "bool" | "int" | "hex" | "string";
  help?: string;
  depends_on?: string;
  range?: [number, number] | null;
  children: KconfigNode[];
}

export interface KconfigState {
  sessionId: string;
  menus: KconfigNode[];
  values: Record<string, KconfigValue>;
  ranges: Record<string, [number, number]>;
  visible: Record<string, boolean>;
  errors?: string[];
}
