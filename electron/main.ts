import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SerialPort } from "serialport";
import type { AddComponentDependencyRequest, AppSettings, CreateProjectFromExampleRequest, DoctorCheck, IdfSetup, JtagDevice, KconfigNode, KconfigState, KconfigValue, ProjectSettings, SdkconfigEntry, TaskRequest, ToolCapabilities } from "./types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
if (process.env.IDF_TOOLBOX_SOFTWARE_RENDERING === "1") app.disableHardwareAcceleration();
let mainWindow: BrowserWindow | null = null;
let runningTask: ChildProcessWithoutNullStreams | null = null;
let runningTaskAction = "";
type MonitorSession = { port: SerialPort; baud: number; wanted: boolean; reconnectTimer: NodeJS.Timeout | null };
const monitorSessions = new Map<string, MonitorSession>();

function send(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function assertNoRunningTask() {
  if (runningTask) throw new Error("任务正在运行，请等待完成或先停止任务");
}

function releaseRunningTask(child: ChildProcessWithoutNullStreams) {
  if (runningTask !== child) return false;
  runningTask = null;
  runningTaskAction = "";
  return true;
}

function stopRunningTask() {
  const child = runningTask;
  if (!child) return false;

  if (process.platform === "win32" && child.pid) {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    if (!result.error && result.status === 0) return true;
  }

  return child.kill();
}

function trustedAppUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    try {
      const configured = new URL(devUrl);
      const loopback = configured.hostname === "localhost" || configured.hostname === "127.0.0.1" || configured.hostname === "[::1]";
      return loopback && configured.protocol === "http:" && url.origin === configured.origin;
    } catch {
      return false;
    }
  }
  if (url.protocol !== "file:") return false;
  try {
    const loadedFile = path.normalize(fileURLToPath(url));
    const appFile = path.normalize(path.join(currentDir, "..", "dist", "index.html"));
    return process.platform === "win32" ? loadedFile.toLowerCase() === appFile.toLowerCase() : loadedFile === appFile;
  } catch {
    return false;
  }
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent) {
  const window = mainWindow;
  const frame = event.senderFrame;
  if (!window || window.isDestroyed() || event.sender !== window.webContents || !frame || frame !== event.sender.mainFrame || !trustedAppUrl(frame.url)) {
    throw new Error("已拒绝非主应用页面发起的特权操作");
  }
}

function trustedHandle<TArgs extends unknown[], TResult>(channel: string, listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return listener(event, ...args as TArgs);
  });
}

function approvedExternalUrl(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\0\r\n]/.test(value)) {
    throw new Error("外部链接无效");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("外部链接格式无效");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("只允许打开受信任的 HTTPS 链接");
  }
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  const allowed = hostname === "components.espressif.com"
    || hostname === "docs.espressif.com"
    || hostname === "github.com" && (pathname === "/espressif" || pathname.startsWith("/espressif/"));
  if (!allowed) throw new Error("该外部链接不在允许列表中");
  return url;
}

function openApprovedExternal(value: unknown) {
  return shell.openExternal(approvedExternalUrl(value).href);
}

function diagnosticLog(message: string) {
  try {
    const file = path.join(app.getPath("userData"), "diagnostic.log");
    appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Diagnostics must never prevent the application from starting.
  }
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings(): AppSettings {
  try {
    return JSON.parse(readFileSync(settingsPath(), "utf8")) as AppSettings;
  } catch {
    return { lastProject: "", projects: {} };
  }
}

function saveSettings(settings: AppSettings) {
  mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

function readIdfVersion(idfPath: string, versionHint = ""): string {
  const versionCmake = path.join(idfPath, "tools", "cmake", "version.cmake");
  if (existsSync(versionCmake)) {
    try {
      const text = readFileSync(versionCmake, "utf8");
      const part = (name: string) => text.match(new RegExp(`IDF_VERSION_${name}\\s+([0-9]+)`))?.[1] || "";
      const major = part("MAJOR");
      const minor = part("MINOR");
      const patch = part("PATCH");
      if (major && minor) return [major, minor, patch].filter(Boolean).join(".");
    } catch {
      // Continue with the remaining version sources.
    }
  }
  const versionFile = path.join(idfPath, "version.txt");
  if (existsSync(versionFile)) {
    try {
      const matched = readFileSync(versionFile, "utf8").match(/\d+\.\d+(?:\.\d+)?/)?.[0];
      if (matched) return matched;
    } catch {
      // Continue with the hint and path name.
    }
  }
  if (versionHint) return versionHint.replace(/^v/i, "");
  return idfPath.match(/[\\/]v?(\d+\.\d+(?:\.\d+)?)(?:[\\/]|$)/i)?.[1] || "";
}

function findPython(toolsPath: string, version: string, idfPath: string): string {
  const root = path.join(toolsPath, "python_env");
  if (!existsSync(root)) return "";
  const allCandidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      pythonPath: path.join(root, entry.name, "Scripts", "python.exe")
    }))
    .filter((entry) => existsSync(entry.pythonPath));
  const compatibleVersion = version.match(/\d+\.\d+/)?.[0] || "";
  if (compatibleVersion) {
    const exact = allCandidates.find((entry) => entry.name.toLowerCase().startsWith(`idf${compatibleVersion}_py`));
    if (exact) return exact.pythonPath;
  }
  const idfPy = path.join(idfPath, "tools", "idf.py");
  for (const candidate of allCandidates) {
    const result = spawnSync(candidate.pythonPath, [idfPy, "--version"], {
      cwd: idfPath,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000
    });
    if (result.status !== 0) continue;
    const reported = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (!compatibleVersion || reported.includes(compatibleVersion)) return candidate.pythonPath;
  }
  return "";
}

function inspectSetup(idfPath: string, versionHint = ""): IdfSetup {
  const toolsPath = path.join(homedir(), ".espressif");
  const version = readIdfVersion(idfPath, versionHint);
  const pythonPath = findPython(toolsPath, version, idfPath);
  const required: Array<[string, string]> = [
    ["idf.py", path.join(idfPath, "tools", "idf.py")],
    ["idf_tools.py", path.join(idfPath, "tools", "idf_tools.py")],
    ["Python 虚拟环境", pythonPath]
  ];
  const missing = required.filter(([, value]) => !value || !existsSync(value)).map(([name]) => name);
  return {
    id: idfPath.toLowerCase(),
    version: version || "未知",
    idfPath,
    toolsPath,
    pythonPath,
    valid: missing.length === 0,
    missing
  };
}

function discoverSetups(): IdfSetup[] {
  const found = new Map<string, IdfSetup>();
  const files = [path.join(homedir(), ".espressif", "idf-env.json"), path.join(homedir(), ".espressif", "esp_idf.json")];
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      const installed = data.idfInstalled || {};
      for (const item of Object.values(installed) as Array<{ path?: string; version?: string }>) {
        if (!item.path || !existsSync(item.path)) continue;
        const setup = inspectSetup(path.resolve(item.path), item.version || "");
        found.set(setup.id, setup);
      }
    } catch {
      // A damaged registry is reported through an empty result and manual selection remains available.
    }
  }
  const environmentIdfPath = process.env.IDF_PATH;
  if (environmentIdfPath && existsSync(environmentIdfPath)) {
    const setup = inspectSetup(path.resolve(environmentIdfPath));
    found.set(setup.id, setup);
  }
  return [...found.values()];
}

function buildEnvironment(setup: IdfSetup): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, IDF_PATH: setup.idfPath, IDF_TOOLS_PATH: setup.toolsPath };
  const systemPath = Object.entries(process.env).find(([key]) => key.toUpperCase() === "PATH")?.[1] || "";
  if (!setup.pythonPath) return env;
  const result = spawnSync(
    setup.pythonPath,
    [path.join(setup.idfPath, "tools", "idf_tools.py"), "export", "--format=key-value"],
    { cwd: setup.idfPath, env, encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "ESP-IDF 环境加载失败").trim());
  for (const line of result.stdout.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    let value = line.slice(separator + 1);
    if (key.toUpperCase() === "PATH") {
      const hasPlaceholder = /%PATH%/i.test(value);
      value = value.replace(/%PATH%/gi, systemPath);
      if (!hasPlaceholder && systemPath) value = `${value};${systemPath}`;
      for (const existingKey of Object.keys(env)) {
        if (existingKey.toUpperCase() === "PATH") delete env[existingKey];
      }
      env.PATH = value;
      continue;
    }
    env[key] = value;
  }
  return env;
}

function environmentPath(env: NodeJS.ProcessEnv) {
  return Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] || "";
}

function findExecutable(env: NodeJS.ProcessEnv, names: string[]): string {
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const folder of environmentPath(env).split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      for (const suffix of suffixes) {
        const candidate = path.join(folder.replace(/^"|"$/g, ""), `${name}${suffix}`);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return "";
}

function getCapabilities(setup: IdfSetup, target = "esp32"): ToolCapabilities {
  const env = buildEnvironment(setup);
  return {
    git: findExecutable(env, ["git"]),
    openocd: findExecutable(env, ["openocd"]),
    dfuUtil: findExecutable(env, ["dfu-util"]),
    qemuXtensa: findExecutable(env, ["qemu-system-xtensa"]),
    qemuRiscv: findExecutable(env, ["qemu-system-riscv32"]),
    gdb: findExecutable(env, [`xtensa-${target}-elf-gdb`, `riscv32-${target}-elf-gdb`, "xtensa-esp32s3-elf-gdb", "xtensa-esp32-elf-gdb"])
  };
}

function profileBuildDir(projectPath: string, buildDir?: string) {
  if (!buildDir || buildDir === "build") return path.join(projectPath, "build");
  return path.isAbsolute(buildDir) ? buildDir : path.join(projectPath, buildDir);
}

function environmentValue(env: NodeJS.ProcessEnv, name: string) {
  return Object.entries(env).find(([key]) => key.toUpperCase() === name.toUpperCase())?.[1] || "";
}

function resolveOpenOcdConfig(configValue: string, projectPath: string, env: NodeJS.ProcessEnv) {
  const config = configValue.trim();
  if (!config) throw new Error("请选择 OpenOCD 配置文件后再通过 JTAG 烧录");
  if (config.length > 1024 || /[\0\r\n]/.test(config)) throw new Error("OpenOCD 配置路径无效");
  if (path.extname(config).toLowerCase() !== ".cfg") throw new Error("OpenOCD 配置必须是 .cfg 文件");
  if (!path.isAbsolute(config) && config.split(/[\\/]+/).includes("..")) {
    throw new Error("OpenOCD 配置不支持相对上级路径，请使用 scripts 内路径或绝对路径");
  }

  const candidates = path.isAbsolute(config)
    ? [path.normalize(config)]
    : [
        path.resolve(projectPath, config),
        ...environmentValue(env, "OPENOCD_SCRIPTS").split(path.delimiter).filter(Boolean).map((root) => path.resolve(root.replace(/^"|"$/g, ""), config))
      ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`找不到 OpenOCD 配置“${config}”。请选择与开发板/调试器匹配的配置，例如 board/esp32s3-builtin.cfg`);
  }
  return resolved;
}

function validatedComponentName(value?: string) {
  const component = (value || "main").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(component)) {
    throw new Error("目标组件名只能包含字母、数字、下划线和短横线，且长度不能超过 80 个字符");
  }
  return component;
}

function validatedDependency(value?: string) {
  const dependency = (value || "").trim();
  if (!dependency) throw new Error("请输入要添加的组件依赖，例如 espressif/led_strip^2.5.0");
  if (dependency.length > 320 || dependency.startsWith("-") || dependency.includes("..") || /[\s\\:\0\r\n]/.test(dependency)) {
    throw new Error("组件依赖格式无效，请使用组件注册表名称和可选版本，例如 espressif/led_strip^2.5.0");
  }
  if (!/^[A-Za-z0-9_.@/+^~<>=!*,|-]+$/.test(dependency) || !/[A-Za-z0-9]/.test(dependency)) {
    throw new Error("组件依赖包含不支持的字符");
  }
  return dependency;
}

function validatedRegistryExample(value: string) {
  const example = value.trim();
  if (!example || example.length > 380 || example.startsWith("-") || example.includes("..") || /[\s\\\0\r\n]/.test(example)) {
    throw new Error("组件示例格式无效，请使用 namespace/name=1.0.0:example 形式");
  }
  const separator = example.lastIndexOf(":");
  const componentSpec = separator > 0 ? example.slice(0, separator) : "";
  const exampleName = separator > 0 ? example.slice(separator + 1) : "";
  if (!componentSpec || !exampleName || !/^[A-Za-z0-9_.@/+^~<>=!*,|-]+$/.test(componentSpec) || !/^[A-Za-z0-9_.\/-]+$/.test(exampleName)) {
    throw new Error("组件示例格式无效，请使用 namespace/name=1.0.0:example 形式");
  }
  return example;
}

function runTrackedCommand(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, action: string) {
  if (runningTask) throw new Error("已有任务正在运行，请先等待或取消");
  send("task:state", { running: true, action });
  send("task:output", { stream: "stdout", text: `\n$ ${path.basename(executable)} ${args.join(" ")}\n` });
  return new Promise<void>((resolve, reject) => {
    let spawnError: Error | null = null;
    let spawnFinished = false;
    const child = spawn(executable, args, { cwd, env, windowsHide: true });
    runningTask = child;
    runningTaskAction = action;
    child.stdout.on("data", (data) => send("task:output", { stream: "stdout", text: data.toString() }));
    child.stderr.on("data", (data) => send("task:output", { stream: "stderr", text: data.toString() }));
    child.once("error", (error) => {
      if (spawnFinished) return;
      spawnFinished = true;
      spawnError = error;
      send("task:output", { stream: "stderr", text: `${error.message}\n` });
      releaseRunningTask(child);
      send("task:state", { running: false, code: -1, action });
      reject(error);
    });
    child.once("close", (code) => {
      if (spawnFinished) return;
      spawnFinished = true;
      releaseRunningTask(child);
      const exitCode = code ?? -1;
      send("task:state", { running: false, code: exitCode, action });
      if (exitCode === 0) resolve();
      else reject(new Error(spawnError?.message || `命令执行失败（退出码 ${exitCode}）`));
    });
  });
}

function readSdkconfig(projectPath: string): SdkconfigEntry[] {
  const file = path.join(projectPath, "sdkconfig");
  if (!existsSync(file)) throw new Error("工程还没有 sdkconfig，请先构建或设置目标芯片");
  const entries: SdkconfigEntry[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const enabled = line.match(/^(CONFIG_[A-Za-z0-9_]+)=(.*)$/);
    if (enabled) entries.push({ key: enabled[1], value: enabled[2], enabled: true });
    const disabled = line.match(/^# (CONFIG_[A-Za-z0-9_]+) is not set$/);
    if (disabled) entries.push({ key: disabled[1], value: "n", enabled: false });
  }
  return entries;
}

function configuredProjectTarget(projectPath: string) {
  const file = path.join(projectPath, "sdkconfig");
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").match(/^CONFIG_IDF_TARGET="([^"]+)"/m)?.[1] || "";
}

function saveSdkconfig(projectPath: string, updates: SdkconfigEntry[]) {
  const file = path.join(projectPath, "sdkconfig");
  if (!existsSync(file)) throw new Error("工程还没有 sdkconfig");
  const updateMap = new Map(updates.map((entry) => [entry.key, entry]));
  const lines = readFileSync(file, "utf8").split(/\r?\n/).map((line) => {
    const key = line.match(/^(CONFIG_[A-Za-z0-9_]+)=/)?.[1] || line.match(/^# (CONFIG_[A-Za-z0-9_]+) is not set$/)?.[1];
    if (!key || !updateMap.has(key)) return line;
    const entry = updateMap.get(key)!;
    updateMap.delete(key);
    return entry.enabled ? `${entry.key}=${entry.value}` : `# ${entry.key} is not set`;
  });
  for (const entry of updateMap.values()) lines.push(entry.enabled ? `${entry.key}=${entry.value}` : `# ${entry.key} is not set`);
  writeFileSync(file, lines.join("\n"), "utf8");
  return true;
}

async function openCsvEditor(kind: "partition" | "nvs", projectPath: string) {
  if (!validateProject(projectPath)) throw new Error("所选目录不是标准 ESP-IDF 工程");
  let file = "";
  if (kind === "partition") {
    const sdkconfig = path.join(projectPath, "sdkconfig");
    if (existsSync(sdkconfig)) {
      const match = readFileSync(sdkconfig, "utf8").match(/^CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="([^"]+)"/m);
      if (match) file = path.resolve(projectPath, match[1]);
    }
    if (!file) {
      for (const candidate of ["partitions.csv", "partition_table.csv"]) {
        const candidatePath = path.join(projectPath, candidate);
        if (existsSync(candidatePath)) { file = candidatePath; break; }
      }
    }
  }
  if (!file || !existsSync(file)) {
    const selected = await dialog.showOpenDialog(mainWindow!, {
      title: kind === "partition" ? "选择 ESP-IDF 分区表 CSV" : "选择 NVS CSV",
      defaultPath: projectPath,
      properties: ["openFile"],
      filters: [{ name: "CSV 文件", extensions: ["csv"] }]
    });
    if (selected.canceled || !selected.filePaths[0]) throw new Error(kind === "partition" ? "未找到工程分区表，请先在 sdkconfig 中启用自定义分区表或选择 CSV 文件" : "未选择 NVS CSV 文件");
    file = selected.filePaths[0];
  }
  return { path: file, csv: readFileSync(file, "utf8") };
}

function saveEditorText(file: string, content: string) {
  if (!file || !existsSync(path.dirname(file))) throw new Error("保存目录不存在");
  writeFileSync(file, content, "utf8");
  return true;
}

function readEditorText(file: string) {
  if (!file || !existsSync(file)) throw new Error("编辑器源文件不存在");
  return readFileSync(file, "utf8");
}

async function chooseKeyFile(projectPath: string) {
  const selected = await dialog.showOpenDialog(mainWindow!, { title: "选择 NVS 加密密钥", defaultPath: projectPath, properties: ["openFile"] });
  return selected.canceled ? "" : selected.filePaths[0] || "";
}

function generateNvsPartition(idfPath: string, csvFile: string, options: { encrypt: boolean; encryptKeyPath: string; generateKey: boolean; partitionSize: string }) {
  const setup = inspectSetup(idfPath);
  if (!setup.valid) throw new Error(`ESP-IDF 环境不完整：${setup.missing.join("、")}`);
  if (!existsSync(csvFile)) throw new Error("NVS CSV 文件不存在，请先保存");
  const generator = path.join(idfPath, "components", "nvs_flash", "nvs_partition_generator", "nvs_partition_gen.py");
  if (!existsSync(generator)) throw new Error("未找到 nvs_partition_gen.py");
  const directory = path.dirname(csvFile);
  const input = path.basename(csvFile);
  const output = input.replace(/\.csv$/i, ".bin");
  const args = [generator, options.encrypt ? "encrypt" : "generate", input, output, options.partitionSize];
  if (options.encrypt) {
    if (options.generateKey) args.push("--keygen");
    else {
      if (!options.encryptKeyPath) throw new Error("请选择 NVS 加密密钥文件");
      args.push("--inputkey", options.encryptKeyPath);
    }
  }
  const result = spawnSync(setup.pythonPath, args, { cwd: directory, env: buildEnvironment(setup), encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "生成 NVS 分区失败").trim());
  return { output: path.join(directory, output), log: (result.stdout || result.stderr || "NVS 分区已生成").trim() };
}

async function analyzeProjectSize(projectPath: string, idfPath: string, buildDir?: string) {
  const setup = inspectSetup(idfPath);
  if (!setup.valid) throw new Error(`ESP-IDF 环境不完整：${setup.missing.join("、")}`);
  const outputDir = profileBuildDir(projectPath, buildDir);
  if (!existsSync(outputDir)) throw new Error("尚未生成构建目录，请先编译工程");
  const mapName = readdirSync(outputDir).find((name) => name.toLowerCase().endsWith(".map"));
  if (!mapName) throw new Error("构建目录中没有 .map 文件，请先完整编译工程");
  const tool = path.join(idfPath, "tools", "idf_size.py");
  const mapFile = path.join(outputDir, mapName);
  const env = buildEnvironment(setup);
  const invoke = (extra: string[]) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(setup.pythonPath, [tool, mapFile, ...extra, "--format", "json2"], { cwd: path.join(idfPath, "tools"), env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => reject(new Error(`无法启动大小分析：${error.message}`)));
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error((stderr || stdout || "大小分析失败").trim()));
      try { resolve(JSON.parse(stdout) as Record<string, unknown>); }
      catch { reject(new Error("大小分析返回了无法识别的数据")); }
    });
  });
  const [overview, archives, files] = await Promise.all([invoke([]), invoke(["--archives"]), invoke(["--files"])]);
  return { overview, archives, files };
}

type ConfserverResponse = {
  version?: number;
  values?: Record<string, KconfigValue>;
  ranges?: Record<string, [number, number]>;
  visible?: Record<string, boolean>;
  error?: unknown[];
};

type ConfserverWaiter = {
  resolve: (response: ConfserverResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const KCONFIG_TEMP_PREFIX = "idf-toolbox-kconfig-";

function kconfigKey(projectPath: string, idfPath: string, buildDir?: string) {
  const normalized = [path.resolve(projectPath), path.resolve(idfPath), path.resolve(profileBuildDir(projectPath, buildDir))]
    .map((item) => process.platform === "win32" ? item.toLowerCase() : item);
  return JSON.stringify(normalized);
}

function removeKconfigTempDirectory(directory: string) {
  if (!directory) return true;
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(tmpdir());
  const sameParent = (process.platform === "win32" ? path.dirname(resolved).toLowerCase() : path.dirname(resolved))
    === (process.platform === "win32" ? tempRoot.toLowerCase() : tempRoot);
  if (!sameParent || !path.basename(resolved).startsWith(KCONFIG_TEMP_PREFIX)) {
    diagnosticLog(`refused to remove unexpected Kconfig temp path: ${resolved}`);
    return false;
  }
  try {
    rmSync(resolved, { recursive: true, force: true });
    return !existsSync(resolved);
  } catch (error) {
    diagnosticLog(`failed to remove Kconfig temp path ${resolved}: ${String(error)}`);
    return false;
  }
}

function sameResolvedPath(left: string, right: string) {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function isPathInside(candidate: string, parent: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function canReuseGeneratedKconfigEnvironment(configEnv: string, buildDirectory: string, idfPath: string, configuredTarget: string) {
  if (!existsSync(configEnv)) return false;
  try {
    const generated = JSON.parse(readFileSync(configEnv, "utf8")) as Record<string, string>;
    if (!generated.IDF_PATH || !sameResolvedPath(generated.IDF_PATH, idfPath)) return false;
    if (configuredTarget && generated.IDF_TARGET !== configuredTarget) return false;
    const sourceFiles = [generated.COMPONENT_KCONFIGS_SOURCE_FILE, generated.COMPONENT_KCONFIGS_PROJBUILD_SOURCE_FILE];
    if (!sourceFiles.every((file) => Boolean(file) && existsSync(file) && isPathInside(file, buildDirectory))) return false;
    const menuFile = path.join(buildDirectory, "config", "kconfig_menus.json");
    const menus = JSON.parse(readFileSync(menuFile, "utf8"));
    return Array.isArray(menus);
  } catch {
    return false;
  }
}

class KconfigSessionController {
  readonly sessionId = randomUUID();
  readonly key: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private menus: KconfigNode[] = [];
  private values: Record<string, KconfigValue> = {};
  private ranges: Record<string, [number, number]> = {};
  private visible: Record<string, boolean> = {};
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private bufferedResponses: ConfserverResponse[] = [];
  private waiters: ConfserverWaiter[] = [];
  private operation: Promise<void> = Promise.resolve();
  private tempDirectory = "";
  private closed = false;

  private projectPath: string;
  private idfPath: string;
  private buildDir?: string;

  constructor(projectPath: string, idfPath: string, buildDir?: string) {
    this.projectPath = path.resolve(projectPath);
    this.idfPath = path.resolve(idfPath);
    this.buildDir = buildDir;
    this.key = kconfigKey(this.projectPath, this.idfPath, buildDir);
  }

  get isClosed() { return this.closed; }

  async start(): Promise<KconfigState> {
    if (runningTask) throw new Error("已有任务正在运行，请等待任务结束后再打开 SDK 配置编辑器");
    if (!validateProject(this.projectPath)) throw new Error("所选目录不是标准 ESP-IDF 工程");
    const setup = inspectSetup(this.idfPath);
    if (!setup.valid) throw new Error(`ESP-IDF 环境不完整：${setup.missing.join("、")}`);

    const realConfig = path.join(this.projectPath, "sdkconfig");
    if (!existsSync(realConfig)) throw new Error("工程还没有 sdkconfig，请先构建或设置目标芯片");
    const resolvedBuildDir = profileBuildDir(this.projectPath, this.buildDir);
    const configEnv = path.join(resolvedBuildDir, "config.env");

    this.tempDirectory = mkdtempSync(path.join(tmpdir(), KCONFIG_TEMP_PREFIX));
    const temporaryConfig = path.join(this.tempDirectory, "sdkconfig");
    const isolatedBuildDirectory = path.join(this.tempDirectory, "build");
    copyFileSync(realConfig, temporaryConfig);

    const env = buildEnvironment(setup);
    const useGeneratedConfiguration = canReuseGeneratedKconfigEnvironment(configEnv, resolvedBuildDir, this.idfPath, configuredProjectTarget(this.projectPath));
    const menuFile = path.join(useGeneratedConfiguration ? resolvedBuildDir : isolatedBuildDirectory, "config", "kconfig_menus.json");
    const args = useGeneratedConfiguration
      ? ["-m", "kconfserver", "--env-file", configEnv, "--kconfig", path.join(this.idfPath, "Kconfig"), "--sdkconfig-rename", path.join(this.idfPath, "sdkconfig.rename"), "--config", temporaryConfig]
      : [path.join(this.idfPath, "tools", "idf.py"), "-C", this.projectPath, "-B", isolatedBuildDirectory, "-D", `SDKCONFIG=${temporaryConfig}`, "confserver", "--buffer-size", "4096"];

    this.child = spawn(setup.pythonPath, args, {
      cwd: useGeneratedConfiguration ? resolvedBuildDir : this.projectPath,
      env,
      windowsHide: true
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk.toString("utf8")}`.slice(-65536);
    });
    this.child.once("error", (error) => this.fail(new Error(`无法启动 ESP-IDF 配置服务器：${error.message}`)));
    this.child.once("close", (code) => {
      if (!this.closed) this.fail(new Error((this.stderrBuffer || `ESP-IDF 配置服务器已退出，代码 ${code ?? -1}`).trim()));
    });

    const initial = await this.waitForResponse(90000);
    const initialErrors = this.mergeResponse(initial);
    if (initialErrors.length) throw new Error(initialErrors.join("；"));
    if (!existsSync(menuFile)) throw new Error("ESP-IDF 配置服务器未生成 Kconfig 菜单数据");
    this.menus = JSON.parse(readFileSync(menuFile, "utf8")) as KconfigNode[];
    // confserver has fully loaded the temporary copy at this point. Keeping it is
    // unnecessary, and deleting it now avoids Windows file-lock leftovers at exit.
    if (removeKconfigTempDirectory(this.tempDirectory)) this.tempDirectory = "";
    return this.snapshot();
  }

  update(changes: Record<string, KconfigValue>) {
    if (!Object.keys(changes).length) return Promise.resolve(this.snapshot());
    return this.request({ version: 2, set: changes });
  }

  save() {
    return this.request({ version: 2, save: path.join(this.projectPath, "sdkconfig") });
  }

  discard() {
    return this.request({ version: 2, load: path.join(this.projectPath, "sdkconfig") });
  }

  resetToDefaults() {
    // Ask the already-running confserver to load an empty sdkconfig. kconfiglib
    // resolves that into the ESP-IDF/Kconfig defaults, while the project's real
    // sdkconfig remains untouched until the caller explicitly sends "save".
    const resetDirectory = mkdtempSync(path.join(tmpdir(), KCONFIG_TEMP_PREFIX));
    const resetConfig = path.join(resetDirectory, "sdkconfig");
    writeFileSync(resetConfig, "", "utf8");
    return this.request({ version: 2, load: resetConfig })
      .finally(() => { removeKconfigTempDirectory(resetDirectory); });
  }

  snapshot(errors: string[] = []): KconfigState {
    return {
      sessionId: this.sessionId,
      menus: this.menus,
      values: { ...this.values },
      ranges: { ...this.ranges },
      visible: { ...this.visible },
      ...(errors.length ? { errors } : {})
    };
  }

  close() {
    this.fail(new Error("SDK 配置会话已关闭"));
  }

  private request(payload: Record<string, unknown>): Promise<KconfigState> {
    const run = async () => {
      if (this.closed || !this.child) throw new Error("SDK 配置会话已失效，请重新打开编辑器");
      const responsePromise = this.waitForResponse(60000);
      try { this.child.stdin.write(`${JSON.stringify(payload)}\n`); }
      catch (error) {
        const failure = new Error(`无法向 ESP-IDF 配置服务器发送请求：${String(error)}`);
        this.fail(failure);
        throw failure;
      }
      const response = await responsePromise;
      const errors = this.mergeResponse(response);
      return this.snapshot(errors);
    };
    const result = this.operation.then(run, run);
    this.operation = result.then(() => undefined, () => undefined);
    return result;
  }

  private handleStdout(chunk: Buffer) {
    this.stdoutBuffer += chunk.toString("utf8");
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.startsWith("{")) {
        try { this.deliverResponse(JSON.parse(line) as ConfserverResponse); }
        catch { /* Ignore non-protocol output and wait for a complete JSON response. */ }
      }
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private deliverResponse(response: ConfserverResponse) {
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.bufferedResponses.push(response);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(response);
  }

  private waitForResponse(timeoutMs: number): Promise<ConfserverResponse> {
    const buffered = this.bufferedResponses.shift();
    if (buffered) return Promise.resolve(buffered);
    if (this.closed) return Promise.reject(new Error("SDK 配置会话已关闭"));
    return new Promise((resolve, reject) => {
      const waiter: ConfserverWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => this.fail(new Error("ESP-IDF 配置服务器响应超时")), timeoutMs)
      };
      this.waiters.push(waiter);
    });
  }

  private mergeResponse(response: ConfserverResponse) {
    Object.assign(this.values, response.values || {});
    Object.assign(this.ranges, response.ranges || {});
    Object.assign(this.visible, response.visible || {});
    return (response.error || []).map((item) => typeof item === "string" ? item : JSON.stringify(item));
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.bufferedResponses = [];
    if (this.child && !this.child.killed) this.child.kill();
    this.child = null;
    if (removeKconfigTempDirectory(this.tempDirectory)) this.tempDirectory = "";
  }
}

let kconfigSession: KconfigSessionController | null = null;

function closeKconfigSession(sessionId?: string) {
  const session = kconfigSession;
  if (sessionId !== undefined && (!sessionId || session?.sessionId !== sessionId)) return false;
  kconfigSession = null;
  session?.close();
  return true;
}

async function openKconfigSession(projectPath: string, idfPath: string, buildDir?: string) {
  closeKconfigSession();
  const session = new KconfigSessionController(projectPath, idfPath, buildDir);
  kconfigSession = session;
  try { return await session.start(); }
  catch (error) {
    if (kconfigSession === session) kconfigSession = null;
    session.close();
    throw error;
  }
}

function activeKconfigSession(sessionId: string, projectPath: string, idfPath: string, buildDir?: string) {
  const session = kconfigSession;
  if (!session || session.isClosed || session.sessionId !== sessionId || session.key !== kconfigKey(projectPath, idfPath, buildDir)) {
    throw new Error("SDK 配置会话已失效，请关闭后重新打开编辑器");
  }
  return session;
}

function runDoctor(setup: IdfSetup, projectPath: string, target: string): DoctorCheck[] {
  const capabilities = getCapabilities(setup, target);
  const checks: DoctorCheck[] = [
    { name: "ESP-IDF", ok: setup.valid, detail: setup.valid ? `${setup.version} · ${setup.idfPath}` : `缺少：${setup.missing.join("、")}` },
    { name: "工程", ok: validateProject(projectPath), detail: projectPath || "未选择工程" },
    { name: "Python", ok: Boolean(setup.pythonPath), detail: setup.pythonPath || "未找到" },
    { name: "Git", ok: Boolean(capabilities.git), detail: capabilities.git || "未找到（部分组件与安装功能不可用）" },
    { name: "OpenOCD", ok: Boolean(capabilities.openocd), detail: capabilities.openocd || "未安装" },
    { name: "DFU-Util", ok: Boolean(capabilities.dfuUtil), detail: capabilities.dfuUtil || "未安装" },
    { name: "QEMU", ok: Boolean(capabilities.qemuXtensa || capabilities.qemuRiscv), detail: capabilities.qemuXtensa || capabilities.qemuRiscv || "未安装" },
    { name: "GDB", ok: Boolean(capabilities.gdb), detail: capabilities.gdb || "未找到对应调试器" }
  ];
  return checks;
}

function validateProject(projectPath: string) {
  const cmake = path.join(projectPath, "CMakeLists.txt");
  if (!existsSync(cmake)) return false;
  try {
    return readFileSync(cmake, "utf8").includes("project.cmake");
  } catch {
    return false;
  }
}

function listExamples(idfPath: string) {
  const root = path.join(idfPath, "examples");
  const results: Array<{ name: string; path: string; group: string }> = [];
  if (!existsSync(root)) return results;
  for (const group of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const groupPath = path.join(root, group.name);
    for (const example of readdirSync(groupPath, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const examplePath = path.join(groupPath, example.name);
      if (validateProject(examplePath)) results.push({ name: example.name, path: examplePath, group: group.name });
    }
  }
  return results;
}

function createBlankProject(destination: string, name: string) {
  const projectPath = path.join(destination, name);
  if (existsSync(projectPath) && readdirSync(projectPath).length > 0) throw new Error("目标工程目录已存在且不为空");
  mkdirSync(path.join(projectPath, "main"), { recursive: true });
  writeFileSync(
    path.join(projectPath, "CMakeLists.txt"),
    `cmake_minimum_required(VERSION 3.16)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(${name})\n`,
    "utf8"
  );
  writeFileSync(path.join(projectPath, "main", "CMakeLists.txt"), 'idf_component_register(SRCS "main.c" INCLUDE_DIRS ".")\n', "utf8");
  writeFileSync(
    path.join(projectPath, "main", "main.c"),
    '#include <stdio.h>\n\nvoid app_main(void)\n{\n    printf("ESP-IDF 工程已启动\\n");\n}\n',
    "utf8"
  );
  return projectPath;
}

function runIdfTask(request: TaskRequest) {
  if (runningTask) throw new Error("已有任务正在运行，请先等待或取消");
  const setup = inspectSetup(request.idfPath);
  if (!setup.valid) throw new Error(`ESP-IDF 环境不完整：${setup.missing.join("、")}`);
  if (!validateProject(request.projectPath)) throw new Error("所选目录不是标准 ESP-IDF 工程");
  const env = buildEnvironment(setup);
  const capabilities = getCapabilities(setup, request.target || "esp32");
  const idfPy = path.join(setup.idfPath, "tools", "idf.py");
  const baseArgs = [idfPy, "-C", request.projectPath];
  if (request.buildDir) baseArgs.push("-B", request.buildDir);
  const idfStep = (...commands: string[]) => ({ executable: setup.pythonPath, args: [...baseArgs, ...commands] });
  const steps: Array<{ executable: string; args: string[] }> = [];
  const requestedTarget = request.target || "";
  const currentTarget = configuredProjectTarget(request.projectPath);
  if ((request.action === "build" || request.action === "flash") && requestedTarget && currentTarget && requestedTarget !== currentTarget) {
    send("task:output", { stream: "stdout", text: `检测到工程目标为 ${currentTarget}，界面选择为 ${requestedTarget}；正在自动切换目标。\n` });
    steps.push(idfStep("set-target", requestedTarget));
  }
  if (["build", "fullclean", "reconfigure", "save-defconfig", "size", "size-components", "size-files", "app", "bootloader", "partition-table", "diag", "openocd", "qemu"].includes(request.action)) {
    if (request.action === "openocd" && !capabilities.openocd) throw new Error("缺少 OpenOCD，请先安装 ESP-IDF OpenOCD 工具");
    if (request.action === "qemu" && !capabilities.qemuXtensa && !capabilities.qemuRiscv) throw new Error("缺少 Espressif QEMU，可在高级工具中安装后再试");
    steps.push(idfStep(request.action));
  }
  if (request.action === "set-target") steps.push(idfStep("set-target", request.target || "esp32"));
  if (request.action === "erase") {
    if (!request.port) throw new Error("请先选择烧录端口");
    steps.push(idfStep("-p", request.port, "erase-flash"));
  }
  if (request.action === "flash") {
    const method = request.flashMethod || "UART";
    if (method === "UART") {
      if (!request.port) throw new Error("请先选择烧录端口");
      steps.push(idfStep("-p", request.port, "-b", String(request.baud || 460800), "flash"));
    } else if (method === "DFU") {
      const dfuTarget = (request.target || currentTarget || "").toLowerCase();
      if (!["esp32s2", "esp32s3", "esp32p4"].includes(dfuTarget)) throw new Error("DFU 烧录只适用于 ESP32-S2、ESP32-S3 或 ESP32-P4");
      if (!capabilities.dfuUtil) throw new Error("缺少 dfu-util，请先安装 ESP-IDF DFU 工具");
      steps.push(idfStep("dfu-flash"));
    } else {
      if (!capabilities.openocd) throw new Error("缺少 OpenOCD，无法通过 JTAG 烧录");
      if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i.test(request.jtagSerial || "")) throw new Error("JTAG 烧录需要先选择具体的 USB-JTAG 设备");
      const buildDir = profileBuildDir(request.projectPath, request.buildDir);
      const config = resolveOpenOcdConfig(request.openOcdConfig || `board/${request.target || currentTarget || "esp32"}-builtin.cfg`, request.projectPath, env);
      steps.push(idfStep("build"));
      steps.push({
        executable: capabilities.openocd,
        args: ["-c", `adapter serial ${request.jtagSerial}`, "-f", config, "-c", `program_esp_bins \"${buildDir.replace(/\\/g, "/")}\" flasher_args.json verify reset exit`]
      });
    }
  }
  if (request.action === "component-add") {
    const component = validatedComponentName(request.component);
    const dependency = validatedDependency(request.dependency);
    steps.push(idfStep("add-dependency", `--component=${component}`, dependency, "reconfigure"));
  }
  if (["app-flash", "bootloader-flash", "partition-table-flash", "encrypted-flash"].includes(request.action)) {
    if (!request.port) throw new Error("请先选择烧录端口");
    steps.push(idfStep("-p", request.port, "-b", String(request.baud || 460800), request.action));
  }
  if (request.action === "efuse-summary") {
    if (!request.port) throw new Error("请先选择串口");
    steps.push({ executable: setup.pythonPath, args: ["-m", "espefuse", "--port", request.port, "summary"] });
  }
  if (request.action === "custom") {
    if (!request.customCommand?.trim()) throw new Error("自定义任务命令不能为空");
    const commandProcessor = process.env.ComSpec || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
    steps.push({ executable: commandProcessor, args: ["/d", "/s", "/c", request.customCommand] });
  }
  if (!steps.length) throw new Error(`不支持的任务：${request.action}`);
  send("task:state", { running: true, action: request.action });
  const runStep = (index: number) => {
    const step = steps[index];
    send("task:output", { stream: "stdout", text: `\n$ ${path.basename(step.executable)} ${step.args.join(" ")}\n` });
    const child = spawn(step.executable, step.args, { cwd: request.projectPath, env, windowsHide: true });
    let stepFinished = false;
    runningTask = child;
    runningTaskAction = request.action;
    child.stdout.on("data", (data) => send("task:output", { stream: "stdout", text: data.toString() }));
    child.stderr.on("data", (data) => send("task:output", { stream: "stderr", text: data.toString() }));
    child.once("error", (error) => {
      if (stepFinished) return;
      stepFinished = true;
      send("task:output", { stream: "stderr", text: `${error.message}\n` });
      releaseRunningTask(child);
      send("task:state", { running: false, code: -1, action: request.action });
    });
    child.once("close", (code) => {
      if (stepFinished) return;
      stepFinished = true;
      releaseRunningTask(child);
      if (code === 0 && index + 1 < steps.length) runStep(index + 1);
      else send("task:state", { running: false, code: code ?? -1, action: request.action });
    });
  };
  runStep(0);
}

async function closeMonitor(portPath?: string) {
  const entries = portPath ? [[portPath, monitorSessions.get(portPath)] as const] : [...monitorSessions.entries()];
  await Promise.all(entries.map(async ([name, session]) => {
    if (!session) return;
    session.wanted = false;
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
    monitorSessions.delete(name);
    if (session.port.isOpen) await new Promise<void>((resolve) => session.port.close(() => resolve()));
  }));
}

function scheduleReconnect(portPath: string) {
  const session = monitorSessions.get(portPath);
  if (!session?.wanted || session.reconnectTimer) return;
  send("serial:data", { type: "status", port: portPath, message: "串口已断开，2 秒后尝试重连…" });
  session.reconnectTimer = setTimeout(() => {
    const current = monitorSessions.get(portPath);
    if (!current) return;
    current.reconnectTimer = null;
    if (current.wanted) void openMonitor(portPath, current.baud);
  }, 2000);
}

async function openMonitor(portPath: string, baud: number) {
  const existing = monitorSessions.get(portPath);
  if (existing?.port.isOpen) return true;
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer);
  const port = new SerialPort({ path: portPath, baudRate: baud, autoOpen: false });
  const session: MonitorSession = { port, baud, wanted: true, reconnectTimer: null };
  monitorSessions.set(portPath, session);
  port.on("data", (data: Buffer) => send("serial:data", { type: "data", port: portPath, data: data.toString("utf8") }));
  port.on("error", (error) => send("serial:data", { type: "error", port: portPath, message: error.message }));
  port.on("close", () => scheduleReconnect(portPath));
  try {
    await new Promise<void>((resolve, reject) => {
      port.open((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } catch (error) {
    monitorSessions.delete(portPath);
    throw error;
  }
  send("serial:data", { type: "status", port: portPath, message: `已连接 ${portPath} @ ${baud}` });
  return true;
}

function listBuiltinJtagDevices(): JtagDevice[] {
  if (process.platform !== "win32") return [];
  const result = spawnSync("pnputil.exe", ["/enum-devices", "/connected", "/class", "USB", "/properties", "/format", "xml"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const portResult = spawnSync("pnputil.exe", ["/enum-devices", "/connected", "/class", "Ports", "/format", "xml"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  const portOutput = `${portResult.stdout || ""}\n${portResult.stderr || ""}`;
  const interfaceToSerial = new Map<string, string>();
  const serials: string[] = [];
  for (const match of output.matchAll(/<Device\s+InstanceId="USB\\VID_303A&amp;PID_1001\\([0-9A-F]{2}(?::[0-9A-F]{2}){5})">([\s\S]*?)<\/Device>/gi)) {
    const serial = match[1].toUpperCase();
    const block = match[2];
    serials.push(serial);
    const interfaceId = block.match(/<Value>USB\\VID_303A&amp;PID_1001&amp;MI_00\\([^<\r\n]+)/i)?.[1]?.trim();
    if (interfaceId) interfaceToSerial.set(interfaceId.toLowerCase(), serial);
  }
  const serialToPort = new Map<string, string>();
  for (const match of portOutput.matchAll(/<Device\s+InstanceId="USB\\VID_303A&amp;PID_1001&amp;MI_00\\([^"]+)">([\s\S]*?)<\/Device>/gi)) {
    const serial = interfaceToSerial.get(match[1].trim().toLowerCase());
    const port = match[2].match(/\(COM(\d+)\)/i)?.[0]?.replace(/[()]/g, "").toUpperCase();
    if (serial && port) serialToPort.set(serial, port);
  }
  return [...new Set(serials)].map((serial) => {
    const port = serialToPort.get(serial);
    return { serial, port, label: port ? `${port} · USB-JTAG` : `USB-JTAG · ${serial}` };
  });
}

function commandProcessorPath() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  return process.env.ComSpec && existsSync(process.env.ComSpec) ? process.env.ComSpec : path.join(systemRoot, "System32", "cmd.exe");
}

async function openActivatedTerminal(setup: IdfSetup, projectPath: string, title: string, commands: string[] = [], closeAfter = false) {
  if (!setup.valid) throw new Error(`ESP-IDF 环境不完整：${setup.missing.join("、")}`);
  if (projectPath && !validateProject(projectPath)) throw new Error("所选目录不是标准 ESP-IDF 工程");
  const env = buildEnvironment(setup);
  const launcherDir = path.join(app.getPath("userData"), "terminal");
  const scriptPath = path.join(launcherDir, `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "idf"}.cmd`);
  mkdirSync(launcherDir, { recursive: true });
  const lines = ["@echo off", "chcp 65001 >nul", `title ${title}`, projectPath ? `cd /d "${projectPath}"` : "", ...commands].filter(Boolean);
  if (commands.length) lines.push("set \"IDF_TOOL_EXIT=%ERRORLEVEL%\"", "echo.", "if not \"%IDF_TOOL_EXIT%\"==\"0\" echo [ERROR] Command exited with code %IDF_TOOL_EXIT%.", "echo Press any key to close this window...", "pause >nul", "exit /b %IDF_TOOL_EXIT%");
  else lines.push("echo ESP-IDF environment is ready.");
  writeFileSync(scriptPath, lines.join("\r\n"), "utf8");
  await new Promise<void>((resolve, reject) => {
    const terminal = spawn(commandProcessorPath(), ["/d", closeAfter || commands.length ? "/c" : "/k", "call", scriptPath], {
      cwd: projectPath || setup.idfPath,
      env,
      detached: true,
      windowsHide: false,
      stdio: "ignore"
    });
    terminal.once("spawn", () => { terminal.unref(); resolve(); });
    terminal.once("error", (error) => reject(new Error(`无法打开独立终端：${error.message}`)));
  });
  return true;
}

function addProjectSupportFiles(projectPath: string, kind: "vscode" | "devcontainer") {
  if (!validateProject(projectPath)) throw new Error("所选目录不是标准 ESP-IDF 工程");
  if (kind === "vscode") {
    const folder = path.join(projectPath, ".vscode");
    mkdirSync(folder, { recursive: true });
    const settingsFile = path.join(folder, "settings.json");
    const launchFile = path.join(folder, "launch.json");
    if (!existsSync(settingsFile)) writeFileSync(settingsFile, JSON.stringify({ "C_Cpp.intelliSenseEngine": "default" }, null, 2), "utf8");
    if (!existsSync(launchFile)) writeFileSync(launchFile, JSON.stringify({ version: "0.2.0", configurations: [{ name: "ESP-IDF Debug", type: "cppdbg", request: "launch", program: "${workspaceFolder}/build/${command:espIdf.getProjectName}.elf", cwd: "${workspaceFolder}" }] }, null, 2), "utf8");
    return folder;
  }
  const folder = path.join(projectPath, ".devcontainer");
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "devcontainer.json");
  if (!existsSync(file)) writeFileSync(file, JSON.stringify({ name: "ESP-IDF", image: "espressif/idf:release-v5.5", runArgs: ["--privileged"], customizations: { vscode: { extensions: ["espressif.esp-idf-extension"] } } }, null, 2), "utf8");
  return folder;
}

function registerIpc() {
  trustedHandle("idf:discover", () => discoverSetups());
  trustedHandle("idf:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "选择 ESP-IDF 根目录" });
    if (result.canceled || !result.filePaths[0]) return null;
    return inspectSetup(result.filePaths[0]);
  });
  trustedHandle("idf:targets", (_event, idfPath: string) => {
    const file = path.join(idfPath, "tools", "idf_py_actions", "constants.py");
    if (!existsSync(file)) throw new Error("找不到 ESP-IDF 芯片定义文件");
    const source = readFileSync(file, "utf8");
    const parse = (name: string) => {
      const body = source.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`, "m"))?.[1] || "";
      return [...body.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
    };
    return [...parse("SUPPORTED_TARGETS").map((target) => ({ target, preview: false })), ...parse("PREVIEW_TARGETS").map((target) => ({ target, preview: true }))];
  });
  trustedHandle("idf:capabilities", (_event, idfPath: string, target: string) => getCapabilities(inspectSetup(idfPath), target));
  trustedHandle("doctor:run", (_event, idfPath: string, projectPath: string, target: string) => runDoctor(inspectSetup(idfPath), projectPath, target));
  trustedHandle("jtag:devices", () => listBuiltinJtagDevices());
  trustedHandle("serial:ports", async () => (await SerialPort.list()).map((port) => ({
    path: port.path,
    manufacturer: port.manufacturer,
    vendorId: port.vendorId,
    productId: port.productId,
    serialNumber: port.serialNumber
  })));
  trustedHandle("project:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "选择 ESP-IDF 工程" });
    if (result.canceled || !result.filePaths[0]) return null;
    if (!validateProject(result.filePaths[0])) throw new Error("所选目录不是标准 ESP-IDF 工程");
    return result.filePaths[0];
  });
  trustedHandle("project:examples", (_event, idfPath: string) => listExamples(idfPath));
  trustedHandle("project:add-support-files", (_event, projectPath: string, kind: "vscode" | "devcontainer") => addProjectSupportFiles(projectPath, kind));
  trustedHandle("project:create-component", (_event, projectPath: string, idfPath: string, name: string, buildDir?: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("组件名只能包含字母、数字、下划线和短横线");
    const setup = inspectSetup(idfPath);
    runIdfTask({ action: "custom", projectPath, idfPath, buildDir, customCommand: `"${setup.pythonPath}" "${path.join(idfPath, "tools", "idf.py")}" -C "${projectPath}" create-component "${name}"` });
    return true;
  });
  trustedHandle("component:add-dependency", async (_event, request: AddComponentDependencyRequest) => {
    assertNoRunningTask();
    closeKconfigSession();
    runIdfTask({
      action: "component-add",
      projectPath: request.projectPath,
      idfPath: request.idfPath,
      buildDir: request.buildDir,
      component: request.component,
      dependency: request.dependency
    });
    return true;
  });
  trustedHandle("component:create-project-from-example", async (_event, request: CreateProjectFromExampleRequest) => {
    assertNoRunningTask();
    const example = validatedRegistryExample(request.example);
    const setup = inspectSetup(request.idfPath);
    if (!setup.valid) throw new Error(`ESP-IDF 环境不完整：${setup.missing.join("、")}`);
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "选择组件示例工程的空目录"
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const destination = path.resolve(result.filePaths[0]);
    if (readdirSync(destination).length > 0) throw new Error("目标目录必须为空，请新建或选择一个空目录");

    assertNoRunningTask();
    closeKconfigSession();
    await closeMonitor();
    const env = buildEnvironment(setup);
    const idfPy = path.join(setup.idfPath, "tools", "idf.py");
    await runTrackedCommand(
      setup.pythonPath,
      [idfPy, "create-project-from-example", "--path", destination, example],
      path.dirname(destination),
      env,
      "component-example"
    );
    if (!validateProject(destination)) throw new Error("命令已结束，但目标目录中没有生成有效的 ESP-IDF 工程");
    return destination;
  });
  trustedHandle("project:create", async (_event, args: { name: string; examplePath?: string }) => {
    if (!/^[\w.-]+$/.test(args.name)) throw new Error("工程名只能包含字母、数字、下划线、点和短横线");
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "选择工程保存位置" });
    if (result.canceled || !result.filePaths[0]) return null;
    const projectPath = path.join(result.filePaths[0], args.name);
    if (args.examplePath) {
      if (!existsSync(args.examplePath) || !validateProject(args.examplePath)) throw new Error("示例工程不存在");
      if (existsSync(projectPath) && readdirSync(projectPath).length > 0) throw new Error("目标工程目录已存在且不为空");
      mkdirSync(projectPath, { recursive: true });
      cpSync(args.examplePath, projectPath, { recursive: true });
      return projectPath;
    }
    return createBlankProject(result.filePaths[0], args.name);
  });
  trustedHandle("settings:load", () => loadSettings());
  trustedHandle("settings:save-project", (_event, projectPath: string, projectSettings: ProjectSettings) => {
    const settings = loadSettings();
    settings.lastProject = projectPath;
    settings.projects[projectPath] = projectSettings;
    saveSettings(settings);
    return true;
  });
  trustedHandle("task:run", async (_event, request: TaskRequest) => {
    closeKconfigSession();
    const needsFlashPort = request.action === "erase" || ["app-flash", "bootloader-flash", "partition-table-flash", "encrypted-flash"].includes(request.action) || (request.action === "flash" && (request.flashMethod || "UART") === "UART");
    if (needsFlashPort && request.port) await closeMonitor(request.port);
    runIdfTask(request);
    return true;
  });
  trustedHandle("task:cancel", () => {
    const child = runningTask;
    if (!child) return false;
    const action = runningTaskAction || "task";
    if (!stopRunningTask()) throw new Error("Unable to stop the current task");
    setTimeout(() => {
      if (runningTask !== child) return;
      releaseRunningTask(child);
      send("task:output", { stream: "stderr", text: "Stop request timed out; the interface has been released.\n" });
      send("task:state", { running: false, code: -1, action });
    }, 1800).unref();
    return true;
  });
  trustedHandle("task:menuconfig", async (_event, projectPath: string, idfPath: string) => {
    const setup = inspectSetup(idfPath);
    return openActivatedTerminal(setup, projectPath, "ESP-IDF menuconfig", [`"${setup.pythonPath}" "${path.join(idfPath, "tools", "idf.py")}" -C "${projectPath}" menuconfig`], true);
  });
  trustedHandle("task:terminal", (_event, projectPath: string, idfPath: string) => openActivatedTerminal(inspectSetup(idfPath), projectPath, "ESP-IDF Terminal"));
  trustedHandle("task:gdb", (_event, projectPath: string, idfPath: string, buildDir?: string) => {
    const setup = inspectSetup(idfPath);
    const buildArg = buildDir ? ` -B "${buildDir}"` : "";
    return openActivatedTerminal(setup, projectPath, "ESP-IDF GDB", [`"${setup.pythonPath}" "${path.join(idfPath, "tools", "idf.py")}" -C "${projectPath}"${buildArg} gdb`], true);
  });
  trustedHandle("sdkconfig:read", (_event, projectPath: string) => readSdkconfig(projectPath));
  trustedHandle("sdkconfig:save", (_event, projectPath: string, updates: SdkconfigEntry[]) => saveSdkconfig(projectPath, updates));
  trustedHandle("kconfig:read", (_event, projectPath: string, idfPath: string, buildDir?: string) => openKconfigSession(projectPath, idfPath, buildDir));
  trustedHandle("kconfig:update", (_event, sessionId: string, projectPath: string, idfPath: string, changes: Record<string, KconfigValue>, buildDir?: string) => activeKconfigSession(sessionId, projectPath, idfPath, buildDir).update(changes));
  trustedHandle("kconfig:save", (_event, sessionId: string, projectPath: string, idfPath: string, buildDir?: string) => activeKconfigSession(sessionId, projectPath, idfPath, buildDir).save());
  trustedHandle("kconfig:discard", (_event, sessionId: string, projectPath: string, idfPath: string, buildDir?: string) => activeKconfigSession(sessionId, projectPath, idfPath, buildDir).discard());
  trustedHandle("kconfig:reset-defaults", (_event, sessionId: string, projectPath: string, idfPath: string, buildDir?: string) => activeKconfigSession(sessionId, projectPath, idfPath, buildDir).resetToDefaults());
  trustedHandle("kconfig:close", (_event, sessionId: string) => closeKconfigSession(sessionId));
  trustedHandle("editor:open-csv", (_event, kind: "partition" | "nvs", projectPath: string) => openCsvEditor(kind, projectPath));
  trustedHandle("editor:read-text", (_event, file: string) => readEditorText(file));
  trustedHandle("editor:save-text", (_event, file: string, content: string) => saveEditorText(file, content));
  trustedHandle("editor:choose-key", (_event, projectPath: string) => chooseKeyFile(projectPath));
  trustedHandle("nvs:generate", (_event, idfPath: string, csvFile: string, options: { encrypt: boolean; encryptKeyPath: string; generateKey: boolean; partitionSize: string }) => generateNvsPartition(idfPath, csvFile, options));
  trustedHandle("size:analyze", (_event, projectPath: string, idfPath: string, buildDir?: string) => analyzeProjectSize(projectPath, idfPath, buildDir));
  trustedHandle("shell:open-external", (_event, url: string) => openApprovedExternal(url));
  trustedHandle("notification:completion-sound", () => {
    shell.beep();
    return true;
  });
  trustedHandle("tool:install-qemu", (_event, projectPath: string, idfPath: string) => {
    const setup = inspectSetup(idfPath);
    return openActivatedTerminal(setup, projectPath, "ESP-IDF QEMU Installer", [`"${setup.pythonPath}" "${path.join(idfPath, "tools", "idf_tools.py")}" install qemu-xtensa qemu-riscv32`], true);
  });
  trustedHandle("tool:install-manager", async (_event, idfPath: string) => {
    const setup = inspectSetup(idfPath);
    const executable = findExecutable(buildEnvironment(setup), ["eim", "idf-eim", "esp-idf-manager"]);
    if (executable) {
      const child = spawn(executable, [], { detached: true, windowsHide: false, stdio: "ignore" });
      child.unref();
      return true;
    }
    await openApprovedExternal("https://docs.espressif.com/projects/idf-im-ui/en/latest/");
    return false;
  });
  trustedHandle("tool:install-adf", async (_event, projectPath: string, idfPath: string) => {
    const setup = inspectSetup(idfPath);
    const capabilities = getCapabilities(setup);
    if (!capabilities.git) throw new Error("缺少 Git，无法安装 ESP-ADF");
    const selected = await dialog.showOpenDialog({ title: "选择 ESP-ADF 安装目录", properties: ["openDirectory", "createDirectory"] });
    if (selected.canceled || !selected.filePaths[0]) return false;
    const destination = path.join(selected.filePaths[0], "esp-adf");
    if (existsSync(destination)) throw new Error(`目标目录已存在：${destination}`);
    return openActivatedTerminal(setup, projectPath, "ESP-ADF Installer", [`"${capabilities.git}" clone --recursive https://github.com/espressif/esp-adf.git "${destination}"`], true);
  });
  trustedHandle("serial:start", async (_event, portPath: string, baud: number) => {
    await openMonitor(portPath, baud);
    return true;
  });
  trustedHandle("serial:stop", async (_event, portPath?: string) => {
    await closeMonitor(portPath);
    send("serial:data", { type: "status", port: portPath, message: portPath ? `${portPath} 监视器已停止` : "串口监视器已停止" });
    return true;
  });
  trustedHandle("serial:write", async (_event, portPath: string, data: string, mode: "text" | "hex") => {
    const session = monitorSessions.get(portPath);
    if (!session?.port.isOpen) throw new Error("串口尚未连接");
    const payload = mode === "hex"
      ? Buffer.from(data.trim().split(/\s+/).filter(Boolean).map((value) => Number.parseInt(value, 16)))
      : Buffer.from(data, "utf8");
    await new Promise<void>((resolve, reject) => session.port.write(payload, (error) => error ? reject(error) : resolve()));
    return true;
  });
  trustedHandle("log:save", async (_event, content: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: `esp-idf-log-${Date.now()}.txt`, filters: [{ name: "文本日志", extensions: ["txt", "log"] }] });
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, content, "utf8");
    return true;
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#f5f4ee",
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const external = approvedExternalUrl(url);
      void shell.openExternal(external.href).catch((error) => diagnosticLog(`open-external failed: ${error.message}`));
    } catch (error) {
      diagnosticLog(`blocked new window: ${url} (${error instanceof Error ? error.message : String(error)})`);
    }
    return { action: "deny" };
  });
  const preventUntrustedNavigation = (event: Electron.Event, url: string) => {
    if (trustedAppUrl(url)) return;
    event.preventDefault();
    diagnosticLog(`blocked main-window navigation: ${url}`);
  };
  mainWindow.webContents.on("will-navigate", (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) preventUntrustedNavigation(event, url);
  });
  mainWindow.webContents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) preventUntrustedNavigation(event, url);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    diagnosticLog(`renderer[${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    diagnosticLog(`preload-error ${preloadPath}: ${error.stack || error.message}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    diagnosticLog(`render-process-gone: ${JSON.stringify(details)}`);
    closeKconfigSession();
  });
  mainWindow.webContents.once("destroyed", () => closeKconfigSession());
  mainWindow.once("closed", () => {
    closeKconfigSession();
    mainWindow = null;
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    if (!trustedAppUrl(devUrl)) throw new Error("VITE_DEV_SERVER_URL 必须是本机 HTTP 地址");
    await mainWindow.loadURL(devUrl);
  }
  else await mainWindow.loadFile(path.join(currentDir, "..", "dist", "index.html"));
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  closeKconfigSession();
  void closeMonitor();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => closeKconfigSession());
