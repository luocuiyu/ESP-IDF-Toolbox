<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import KconfigEditor from "./components/KconfigEditor.vue";
import EspressifWebview from "./components/EspressifWebview.vue";
import ExtensionFeatureCenter from "./components/ExtensionFeatureCenter.vue";
import ComponentRegistry from "./components/ComponentRegistry.vue";
import "@vscode/codicons/dist/codicon.css";
import "./kconfig.css";

type RegistryActionResult = { status: "started" | "completed" | "cancelled" | "error"; message: string };
type LogTone = "plain" | "error" | "warning" | "success" | "command" | "progress" | "info";

const setups = ref<IdfSetup[]>([]);
const selectedIdfPath = ref("");
const projectPath = ref("");
const targets = ref<Array<{ target: string; preview: boolean }>>([]);
const ports = ref<PortInfo[]>([]);
const target = ref("esp32s3");
const flashPort = ref("");
const monitorPort = ref("");
const jtagDevices = ref<JtagDevice[]>([]);
const jtagSerial = ref("");
const flashMethod = ref<"UART" | "JTAG" | "DFU">("UART");
const flashBaud = ref(460800);
const monitorBaud = ref(115200);
const autoMonitor = ref(true);
const completionSound = ref(true);
const activeProfile = ref("default");
const profiles = ref(["default"]);
const openOcdConfig = ref("board/esp32s3-builtin.cfg");
const customTasks = ref<Array<{ name: string; command: string }>>([]);
const capabilities = ref<ToolCapabilities>({ git: "", openocd: "", dfuUtil: "", qemuXtensa: "", qemuRiscv: "", gdb: "" });

const taskRunning = ref(false);
const taskStopping = ref(false);
const currentTask = ref("");
const taskLog = ref("");
const componentLog = ref("");
let captureComponentLog = false;
const serialLogs = ref<Record<string, string>>({});
const monitoredPorts = ref<string[]>([]);
const activeMonitorPort = ref("");
const activeLog = ref<"task" | "serial">("task");
const monitorRunning = computed(() => monitoredPorts.value.length > 0);
const serialLogPorts = computed(() => [...new Set([...monitoredPorts.value, ...Object.keys(serialLogs.value)])]);
const serialInput = ref("");
const serialMode = ref<"text" | "hex">("text");
const timestamps = ref(true);
const serialFilter = ref("");
const status = ref("正在初始化…");
const errorMessage = ref("");
const logElement = ref<HTMLElement | null>(null);
const autoFollowLog = ref(true);
const workflowQueue = ref<TaskRequest["action"][]>([]);
let completionWorkflow: "none" | "build-flash-monitor" = "none";
const activeWorkspace = ref<"workbench" | "registry">("workbench");

const createVisible = ref(false);
const advancedVisible = ref(false);
const customTaskVisible = ref(false);
const doctorVisible = ref(false);
const sdkVisible = ref(false);
const partitionVisible = ref(false);
const nvsVisible = ref(false);
const sizeVisible = ref(false);
const editorMaximized = ref(true);
const sizeWebviewMessage = ref<Record<string, unknown>>({ command: "initialLoad", overview: {}, archives: {}, files: {} });
const csvEditor = ref<{ kind: "partition" | "nvs"; path: string; csv: string }>({ kind: "partition", path: "", csv: "" });
const csvWebviewMessage = ref<Record<string, unknown>>({ command: "loadInitialData", csv: "" });
const projectName = ref("hello_world");
const projectKind = ref<"blank" | "example">("blank");
const examples = ref<Array<{ name: string; path: string; group: string }>>([]);
const selectedExample = ref("");
const doctorChecks = ref<DoctorCheck[]>([]);
const sdkEntries = ref<SdkconfigEntry[]>([]);
const sdkOriginalEntries = ref<SdkconfigEntry[]>([]);
const sdkFilter = ref("");
const sdkMode = ref<"graphical" | "raw">("graphical");
const sdkLoading = ref(false);
const kconfigSyncing = ref(false);
const kconfigCommitting = ref(false);
const kconfigState = ref<KconfigState | null>(null);
const kconfigPath = ref<KconfigNode[]>([]);
const kconfigSearch = ref("");
const kconfigChanges = ref<Record<string, KconfigValue>>({});
const kconfigOriginalValues = ref<Record<string, KconfigValue>>({});
const kconfigQuick = ref(true);
let kconfigPreviewTimer: ReturnType<typeof setTimeout> | null = null;
let kconfigPendingUpdates: Record<string, KconfigValue> = {};
let kconfigPreviewTail: Promise<void> = Promise.resolve();
let kconfigPreviewError: unknown = null;
let kconfigSessionEpoch = 0;
let kconfigEditSequence = 0;
let kconfigPreviewJobs = 0;
let kconfigSessionId = "";
let projectGeneration = 0;
const projectContextSwitching = ref(false);
let settingsPersistTail: Promise<void> = Promise.resolve();
const kconfigEditVersions = new Map<string, number>();
const customName = ref("");
const customCommand = ref("");
const supportedExtensionCommands = [
  "esp.webview.open.partition-table", "espIdf.webview.nvsPartitionEditor", "espIdf.createIdfTerminal", "espIdf.createNewComponent",
  "espIdf.idfReconfigureTask", "espIdf.saveDefSdkconfig", "espIdf.customTask", "espIdf.buildApp", "espIdf.flashAppUart",
  "espIdf.buildBootloader", "espIdf.flashBootloaderUart", "espIdf.buildPartitionTable", "espIdf.flashPartitionTableUart",
  "espIdf.flashAndEncryptDevice", "espIdf.size", "espIdf.doctorCommand", "esp.efuse.summary", "espIdf.openOCDCommand",
  "espIdf.qemuCommand", "esp.component-manager.ui.show", "espIdf.installManager", "espIdf.getEspAdf", "espIdf.createDevContainer", "espIdf.createVsCodeFolder"
];
const readyExtensionCommands = computed(() => supportedExtensionCommands.filter((command) => {
  if (command === "espIdf.openOCDCommand") return Boolean(capabilities.value.openocd);
  if (command === "espIdf.qemuCommand") return Boolean(capabilities.value.qemuXtensa || capabilities.value.qemuRiscv);
  if (command === "espIdf.getEspAdf") return Boolean(capabilities.value.git);
  if (["espIdf.flashAppUart", "espIdf.flashBootloaderUart", "espIdf.flashPartitionTableUart", "espIdf.flashAndEncryptDevice", "esp.efuse.summary"].includes(command)) return Boolean(flashPort.value);
  return true;
}));

const selectedSetup = computed(() => setups.value.find((setup) => setup.idfPath === selectedIdfPath.value));
const ready = computed(() => Boolean(selectedSetup.value?.valid && projectPath.value && !projectContextSwitching.value));
const buildDir = computed(() => activeProfile.value === "default" ? "build" : `build-${activeProfile.value.replace(/[^A-Za-z0-9_-]/g, "-")}`);
const kconfigRuntimeKey = computed(() => [projectPath.value, selectedIdfPath.value, buildDir.value, target.value].join("\u0000"));
const currentProjectName = computed(() => projectPath.value.split(/[\\/]/).filter(Boolean).at(-1) || "未打开工程");
const dfuTargetSupported = computed(() => /^(esp32s2|esp32s3|esp32p4)$/i.test(target.value));
const flashReady = computed(() => {
  if (!ready.value || taskRunning.value) return false;
  if (flashMethod.value === "UART") return Boolean(flashPort.value);
  if (flashMethod.value === "JTAG") return Boolean(capabilities.value.openocd && openOcdConfig.value.trim() && jtagSerial.value);
  return Boolean(dfuTargetSupported.value && capabilities.value.dfuUtil);
});
const flashSummary = computed(() => {
  if (flashMethod.value === "UART") return `${flashPort.value || "未选端口"} · ${flashBaud.value} baud`;
  if (flashMethod.value === "JTAG") return capabilities.value.openocd ? (selectedJtagDevice.value?.label || "请选择绑定串口") : "缺少 OpenOCD";
  return dfuTargetSupported.value ? (capabilities.value.dfuUtil ? "USB DFU 已就绪" : "缺少 dfu-util") : "当前芯片不支持 DFU";
});
const selectedJtagDevice = computed(() => jtagDevices.value.find((device) => device.serial === jtagSerial.value));
const ansiEscapePattern = /\x1B(?:[@-_]|\[[0-?]*[ -/]*[@-~])/g;
function cleanLogText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(ansiEscapePattern, "").replace(/\x08/g, "");
}
function classifyLogLine(line: string): LogTone {
  const text = line.trim();
  if (!text) return "plain";
  const hasZeroErrors = /\b0\s+errors?\b/i.test(text);
  if (!hasZeroErrors && (/\b(error|fatal|failed|failure|exception)\b/i.test(text)
    || /(undefined reference|ninja: build stopped|traceback|guru meditation|panic(?:'ed)?|abort\(\)|no such file or directory|cannot find|could not open)/i.test(text)
    || /\[(失败|错误)\]|任务失败|执行失败|编译失败|烧录失败/i.test(text))) return "error";
  if (/\b(warning|warn|deprecated)\b|\bcould not find\b|\bnot found\b|\[警告\]|警告/i.test(text)) return "warning";
  if (/\[(成功|完成)\]|\b(success(?:ful(?:ly)?)?|completed?)\b|project (?:build|operation) complete|hash of data verified|hard resetting|任务执行成功/i.test(text)) return "success";
  if (/^(?:\$|>\s|\[开始\])|\bexecuting action:|\brunning ninja\b|\bexecuting ["']?(?:cmake|ninja)|\bidf\.py\b/i.test(text)) return "command";
  if (/^\[\s*\d+\s*\/\s*\d+\]|^\[\s*\d+%\]|^--\s|\bperforming (?:build|configure|install) step\b/i.test(text)) return "progress";
  if (/\[(信息|TX(?: HEX)?)\]|\b(info|note):/i.test(text)) return "info";
  return "plain";
}
const filteredSerialLog = computed(() => {
  const normalized = cleanLogText(serialLogs.value[activeMonitorPort.value] || "");
  return !serialFilter.value ? normalized : normalized.split("\n").filter((line) => line.toLowerCase().includes(serialFilter.value.toLowerCase())).join("\n");
});
const visibleLog = computed(() => activeLog.value === "task" ? taskLog.value : filteredSerialLog.value);
const visibleLogLines = computed(() => cleanLogText(visibleLog.value || "等待任务或串口数据…").split("\n").map((text) => ({ text: text || " ", tone: classifyLogLine(text) })));
const filteredSdkEntries = computed(() => {
  const query = sdkFilter.value.trim().toLowerCase();
  return (query ? sdkEntries.value.filter((entry) => `${entry.key} ${entry.value}`.toLowerCase().includes(query)) : sdkEntries.value).slice(0, 500);
});
const currentKconfigNode = computed(() => kconfigPath.value.at(-1));
const commonKconfigNames = ["ESP_DEFAULT_CPU_FREQ_MHZ", "ESPTOOLPY_FLASHSIZE", "SPIRAM", "FREERTOS_HZ", "LOG_DEFAULT_LEVEL"];
const kconfigChineseAliases: Record<string, string> = {
  ESP_DEFAULT_CPU_FREQ_MHZ: "CPU 主频 频率 时钟频率 处理器频率",
  ESPTOOLPY_FLASHSIZE: "Flash 容量 闪存大小",
  SPIRAM: "PSRAM 外部内存",
  FREERTOS_HZ: "FreeRTOS 系统节拍 时钟节拍",
  LOG_DEFAULT_LEVEL: "日志等级 默认日志"
};
function kconfigDisplayTitle(node: KconfigNode) {
  const localized: Record<string, string> = {
    ESP_DEFAULT_CPU_FREQ_MHZ: "CPU 主频",
    ESPTOOLPY_FLASHSIZE: "Flash 容量",
    SPIRAM: "PSRAM 外部内存",
    FREERTOS_HZ: "FreeRTOS 系统节拍频率",
    LOG_DEFAULT_LEVEL: "默认日志等级"
  };
  return (node.name && localized[node.name]) || node.title || node.name || "未命名配置";
}
const visibleKconfigNodes = computed(() => {
  const state = kconfigState.value;
  if (!state) return [];
  const query = kconfigSearch.value.trim().toLowerCase();
  const isVisible = (node: KconfigNode) => state.visible[node.id] !== false;
  const isPresentable = (node: KconfigNode) => Boolean(node.title && isVisible(node));
  if (!query && kconfigQuick.value) {
    const common: KconfigNode[] = [];
    const findCommon = (nodes: KconfigNode[], parentType?: KconfigNode["type"]) => {
      for (const node of nodes) {
        if (parentType !== "choice" && node.name && commonKconfigNames.includes(node.name) && isPresentable(node)) common.push(node);
        if (node.children?.length) findCommon(node.children, node.type);
      }
    };
    findCommon(state.menus);
    return common.sort((a, b) => commonKconfigNames.indexOf(a.name || "") - commonKconfigNames.indexOf(b.name || ""));
  }
  if (!query) return (currentKconfigNode.value?.children || state.menus).filter(isPresentable);
  const matched: KconfigNode[] = [];
  const visit = (nodes: KconfigNode[], parentType?: KconfigNode["type"]) => {
    for (const node of nodes) {
      const choiceText = node.type === "choice" ? node.children.map((child) => `${child.title || ""} ${child.name || ""}`).join(" ") : "";
      const aliases = node.name ? kconfigChineseAliases[node.name] || "" : "";
      if (parentType !== "choice" && isPresentable(node) && `${node.title} ${node.name || ""} ${node.help || ""} ${aliases} ${choiceText}`.toLowerCase().includes(query)) matched.push(node);
      if (matched.length < 300 && node.children?.length) visit(node.children, node.type);
      if (matched.length >= 300) return;
    }
  };
  visit(state.menus);
  return matched;
});
const kconfigChangeCount = computed(() => Object.keys(kconfigChanges.value).length);
const sdkRawDirty = computed(() => {
  const simplify = (items: SdkconfigEntry[]) => items.map(({ key, value, enabled }) => ({ key, value, enabled }));
  return JSON.stringify(simplify(sdkEntries.value)) !== JSON.stringify(simplify(sdkOriginalEntries.value));
});
const capabilityCount = computed(() => Object.values(capabilities.value).filter(Boolean).length);
const dialogVisible = computed(() => advancedVisible.value || customTaskVisible.value || doctorVisible.value || sdkVisible.value || createVisible.value || partitionVisible.value || nvsVisible.value || sizeVisible.value);
let dialogReturnFocus: HTMLElement | null = null;

function appendTask(text: string) { taskLog.value += text; scrollLog(); }
function appendSerial(port: string, text: string) {
  if (!port) return;
  if (!activeMonitorPort.value) activeMonitorPort.value = port;
  const prefix = timestamps.value ? `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ` : "";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  serialLogs.value = { ...serialLogs.value, [port]: `${serialLogs.value[port] || ""}${normalized.split("\n").map((line, index, all) => line.length > 0 || index < all.length - 1 ? `${prefix}${line}` : "").join("\n")}` };
  if (/Guru Meditation Error|panic'ed|Backtrace:|abort\(\)/i.test(text)) serialLogs.value = { ...serialLogs.value, [port]: `${serialLogs.value[port]}\n[警告] 检测到程序崩溃信息，请保留此段日志用于地址解析。\n` };
  scrollLog();
}

function isMonitoring(port: string) { return Boolean(port) && monitoredPorts.value.includes(port); }
function scrollLog() { if (autoFollowLog.value) void nextTick(() => { if (logElement.value) logElement.value.scrollTop = logElement.value.scrollHeight; }); }
function handleLogScroll() { const el = logElement.value; if (el) autoFollowLog.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 24; }
function handleLogWheel(event: WheelEvent) { const el = logElement.value; if (el) { el.scrollTop += event.deltaY; handleLogScroll(); } }
function handleGlobalKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "a") return;
  if (document.querySelector(".modal-backdrop .modal")) return;
  const target = event.target;
  if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
  const terminal = logElement.value;
  if (!terminal) return;
  event.preventDefault();
  terminal.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(terminal);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
function selectLog(tab: "task" | "serial") { activeLog.value = tab; autoFollowLog.value = true; scrollLog(); }
function resumeLogFollow() { autoFollowLog.value = true; scrollLog(); }
function formatError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/i, "");
}
function showError(error: unknown) {
  errorMessage.value = formatError(error);
  appendTask(`\n[错误] ${errorMessage.value}\n`);
  activeLog.value = "task";
}
function resetWorkflow() {
  workflowQueue.value = [];
  completionWorkflow = "none";
}
async function playCompletionSound() {
  if (!completionSound.value) return;
  try { await window.idfApi.playCompletionSound(); }
  catch { /* A notification failure must not turn a successful task into a failed task. */ }
}

async function refreshIdf() {
  setups.value = await window.idfApi.discoverIdf();
  if (!setups.value.some((setup) => setup.idfPath === selectedIdfPath.value)) selectedIdfPath.value = setups.value.find((setup) => setup.valid)?.idfPath || setups.value[0]?.idfPath || "";
}
async function chooseIdf() {
  try {
    const setup = await window.idfApi.chooseIdf();
    if (!setup) return;
    const index = setups.value.findIndex((item) => item.id === setup.id);
    if (index >= 0) setups.value[index] = setup; else setups.value.push(setup);
    selectedIdfPath.value = setup.idfPath;
  } catch (error) { showError(error); }
}
function normalizedProjectKey(value: string) {
  return value.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

function findProjectSettings(settings: Record<string, ProjectSettings>, selected: string) {
  const exact = settings[selected];
  if (exact) return exact;
  const wanted = normalizedProjectKey(selected);
  const matched = Object.entries(settings).find(([candidate]) => normalizedProjectKey(candidate) === wanted);
  return matched?.[1];
}

function defaultProjectSettings(idfPath = selectedIdfPath.value, configuredTarget = "esp32"): ProjectSettings {
  return {
    idfPath,
    target: configuredTarget || "esp32",
    flashPort: "",
    monitorPort: "",
    jtagSerial: "",
    flashMethod: "UART",
    flashBaud: 460800,
    monitorBaud: 115200,
    autoMonitor: true,
    completionSound: true,
    activeProfile: "default",
    profiles: ["default"],
    openOcdConfig: `board/${configuredTarget || "esp32"}-builtin.cfg`,
    customTasks: []
  };
}

async function configuredTargetForProject(selected: string) {
  try {
    const entries = await window.idfApi.readSdkconfig(selected);
    const configured = entries.find((entry) => entry.key === "CONFIG_IDF_TARGET" && entry.enabled)?.value || "";
    return configured.replace(/^"|"$/g, "");
  } catch {
    return "";
  }
}

function clearProjectBoundViews() {
  doctorVisible.value = false;
  doctorChecks.value = [];
  partitionVisible.value = false;
  nvsVisible.value = false;
  sizeVisible.value = false;
  csvEditor.value = { kind: "partition", path: "", csv: "" };
  csvWebviewMessage.value = { command: "loadInitialData", csv: "" };
  sizeWebviewMessage.value = { command: "initialLoad", overview: {}, archives: {}, files: {} };
}

function resetProjectSessionState() {
  resetWorkflow();
  taskRunning.value = false;
  taskStopping.value = false;
  currentTask.value = "";
  taskLog.value = "";
  componentLog.value = "";
  captureComponentLog = false;
  serialLogs.value = {};
  monitoredPorts.value = [];
  activeMonitorPort.value = "";
  activeLog.value = "task";
  activeWorkspace.value = "workbench";
  serialInput.value = "";
  serialFilter.value = "";
  autoFollowLog.value = true;
  errorMessage.value = "";
  advancedVisible.value = false;
  customTaskVisible.value = false;
}

function clearKconfigRendererState(resetMode = true) {
  kconfigState.value = null;
  kconfigOriginalValues.value = {};
  kconfigChanges.value = {};
  kconfigPath.value = [];
  kconfigSearch.value = "";
  kconfigQuick.value = true;
  sdkEntries.value = [];
  sdkOriginalEntries.value = [];
  sdkFilter.value = "";
  if (resetMode) sdkMode.value = "graphical";
}

async function teardownKconfigForProjectSwitch() {
  const sessionId = kconfigSessionId;
  kconfigSessionId = "";
  sdkVisible.value = false;
  invalidateKconfigPreview();
  clearKconfigRendererState();
  if (sessionId) {
    try { await window.idfApi.closeKconfig(sessionId); }
    catch { /* A newer session must not be affected by cleanup of the old project. */ }
  }
  await kconfigPreviewTail;
  sdkLoading.value = false;
  kconfigCommitting.value = false;
  kconfigSyncing.value = false;
}

async function refreshTargetsForSelection(idfPath: string) {
  if (!idfPath) {
    targets.value = [];
    return;
  }
  targets.value = await window.idfApi.getTargets(idfPath);
  if (!targets.value.some((item) => item.target === target.value)) target.value = targets.value[0]?.target || "";
}

function confirmProjectSwitch() {
  const currentUnsaved = sdkMode.value === "graphical" ? Boolean(kconfigChangeCount.value) : sdkRawDirty.value;
  return !sdkVisible.value || !currentUnsaved || window.confirm("当前工程还有未保存的 SDK 配置。切换工程会丢弃这些修改，是否继续？");
}

async function activateProject(selected: string, allSettings?: { projects: Record<string, ProjectSettings> }, projectSwitchConfirmed = false) {
  if (!projectSwitchConfirmed && !confirmProjectSwitch()) return false;

  projectContextSwitching.value = true;
  projectGeneration += 1;
  const generation = projectGeneration;
  try {
    try { await window.idfApi.stopMonitor(); }
    catch { /* Continue switching: the new project must not inherit a stale monitor UI state. */ }
    await teardownKconfigForProjectSwitch();
    clearProjectBoundViews();
    resetProjectSessionState();

    const stored = findProjectSettings(allSettings?.projects || {}, selected);
    const configuredTarget = await configuredTargetForProject(selected);
    if (generation !== projectGeneration) return false;
    projectPath.value = selected;
    const nextSettings = stored
      ? { ...stored, target: configuredTarget || stored.target }
      : defaultProjectSettings(selectedIdfPath.value, configuredTarget || "esp32");
    applyProjectSettings(nextSettings);
    await refreshTargetsForSelection(selectedIdfPath.value);
    if (!openOcdConfig.value || /board\/esp32.*-builtin\.cfg/.test(openOcdConfig.value)) openOcdConfig.value = `board/${target.value}-builtin.cfg`;
    await refreshPorts();
    await refreshJtagDevices();
    await refreshCapabilities();
  } finally {
    if (generation === projectGeneration) projectContextSwitching.value = false;
  }
  await persist();
  return generation === projectGeneration;
}

async function openProject() {
  if (projectContextSwitching.value) return;
  if (taskRunning.value) return showError("任务正在运行，请等待任务结束后再切换工程");
  try {
    const selected = await window.idfApi.chooseProject();
    if (!selected) return;
    const settings = await window.idfApi.loadSettings();
    if (!await activateProject(selected, settings)) return;
    status.value = "工程已加载，SDK 配置已按当前工程重新载入";
  } catch (error) { showError(error); }
}
async function showCreateProject() {
  if (projectContextSwitching.value) return;
  if (!selectedIdfPath.value) return showError("请先选择 ESP-IDF");
  try {
    examples.value = await window.idfApi.listExamples(selectedIdfPath.value);
    selectedExample.value = examples.value[0]?.path || "";
    createVisible.value = true;
  } catch (error) { showError(error); }
}
async function createProject() {
  if (projectContextSwitching.value) return;
  try {
    const created = await window.idfApi.createProject({ name: projectName.value, examplePath: projectKind.value === "example" ? selectedExample.value : undefined });
    if (!created) return;
    createVisible.value = false;
    const settings = await window.idfApi.loadSettings();
    if (!await activateProject(created, settings)) return;
    status.value = "新工程已创建";
  } catch (error) { showError(error); }
}

function applyProjectSettings(settings?: ProjectSettings) {
  const next = settings || defaultProjectSettings();
  if (next.idfPath) selectedIdfPath.value = next.idfPath;
  target.value = next.target || "esp32";
  flashPort.value = next.flashPort || next.port || "";
  monitorPort.value = next.monitorPort || next.port || next.flashPort || "";
  jtagSerial.value = next.jtagSerial || "";
  flashMethod.value = next.flashMethod || "UART";
  flashBaud.value = next.flashBaud || 460800;
  monitorBaud.value = next.monitorBaud || 115200;
  autoMonitor.value = next.autoMonitor ?? true;
  completionSound.value = next.completionSound ?? true;
  profiles.value = next.profiles?.length ? [...next.profiles] : ["default"];
  activeProfile.value = next.activeProfile && profiles.value.includes(next.activeProfile) ? next.activeProfile : "default";
  openOcdConfig.value = next.openOcdConfig || `board/${target.value}-builtin.cfg`;
  customTasks.value = (next.customTasks || []).map(({ name, command }) => ({ name, command }));
}
async function persist() {
  if (!projectPath.value || projectContextSwitching.value) return;
  const generation = projectGeneration;
  const selected = projectPath.value;
  const snapshot: ProjectSettings = {
    idfPath: selectedIdfPath.value, target: target.value, flashPort: flashPort.value, monitorPort: monitorPort.value, jtagSerial: jtagSerial.value,
    flashMethod: flashMethod.value, flashBaud: flashBaud.value, monitorBaud: monitorBaud.value, autoMonitor: autoMonitor.value,
    completionSound: completionSound.value,
    activeProfile: activeProfile.value, profiles: [...profiles.value], openOcdConfig: openOcdConfig.value,
    customTasks: customTasks.value.map(({ name, command }) => ({ name, command }))
  };
  settingsPersistTail = settingsPersistTail.catch(() => undefined).then(async () => {
    if (generation !== projectGeneration || selected !== projectPath.value || projectContextSwitching.value) return;
    await window.idfApi.saveProjectSettings(selected, snapshot);
  });
  await settingsPersistTail;
}
async function refreshPorts() {
  try {
    ports.value = await window.idfApi.getPorts();
    if (!flashPort.value && ports.value.length) flashPort.value = ports.value[0].path;
    if (!monitorPort.value && ports.value.length) monitorPort.value = ports.value[0].path;
    status.value = `发现 ${ports.value.length} 个串口`;
  } catch (error) { showError(error); }
}
async function refreshJtagDevices() {
  try {
    jtagDevices.value = await window.idfApi.getJtagDevices();
    syncJtagDeviceToPort();
  } catch (error) { showError(error); }
}
function syncJtagDeviceToPort() {
  const bindingPort = flashPort.value || monitorPort.value;
  const matchingDevice = jtagDevices.value.find((device) => device.port === bindingPort);
  if (matchingDevice) {
    jtagSerial.value = matchingDevice.serial;
  } else if (!jtagDevices.value.some((device) => device.serial === jtagSerial.value)) {
    jtagSerial.value = jtagDevices.value.length === 1 ? jtagDevices.value[0].serial : "";
  }
}
async function refreshCapabilities() {
  if (!selectedIdfPath.value) return;
  try { capabilities.value = await window.idfApi.getCapabilities(selectedIdfPath.value, target.value); } catch (error) { showError(error); }
}

async function synchronizeAfterTargetChange(succeeded: boolean) {
  const generation = projectGeneration;
  const selected = projectPath.value;
  if (!selected) return;
  projectContextSwitching.value = true;
  try {
    // set-target replaces sdkconfig and regenerates the build configuration.
    // A kconfserver opened for the old target must never survive that change.
    await teardownKconfigForProjectSwitch();
    const configuredTarget = await configuredTargetForProject(selected);
    if (generation !== projectGeneration || selected !== projectPath.value) return;
    if (configuredTarget) target.value = configuredTarget;
    if (!openOcdConfig.value || /board\/esp32.*-builtin\.cfg/.test(openOcdConfig.value)) {
      openOcdConfig.value = `board/${target.value}-builtin.cfg`;
    }
    await Promise.all([refreshCapabilities(), refreshJtagDevices()]);
    if (generation !== projectGeneration || selected !== projectPath.value) return;
    status.value = succeeded
      ? `目标芯片已切换为 ${target.value.toUpperCase()}，SDK 配置会话已刷新`
      : `目标切换未完成，已按磁盘中的 ${target.value.toUpperCase()} 配置刷新 SDK 会话`;
  } finally {
    if (generation === projectGeneration && selected === projectPath.value) projectContextSwitching.value = false;
  }
  await persist();
}

async function runTask(action: TaskRequest["action"], custom = "") {
  if (!ready.value) { showError("请先选择有效的 ESP-IDF 并打开工程"); return false; }
  if ((action === "flash" && flashMethod.value === "UART" || action === "erase") && !flashPort.value) { showError("请先选择烧录端口"); return false; }
  if (action === "flash" && flashMethod.value === "JTAG" && !capabilities.value.openocd) { showError("当前环境缺少 OpenOCD，无法使用 JTAG 烧录"); return false; }
  if (action === "flash" && flashMethod.value === "JTAG" && !jtagSerial.value) { showError("请先选择具体的 USB-JTAG 设备"); return false; }
  if (action === "flash" && flashMethod.value === "DFU" && !dfuTargetSupported.value) { showError("DFU 烧录支持 ESP32-S2、ESP32-S3 和 ESP32-P4"); return false; }
  if (action === "flash" && flashMethod.value === "DFU" && !capabilities.value.dfuUtil) { showError("当前环境缺少 dfu-util，无法使用 DFU 烧录"); return false; }
  if (action === "set-target" && !window.confirm("设置目标芯片会清理当前配置的构建结果，并关闭旧目标的 SDK 配置会话，是否继续？")) return false;
  try {
    const usesFlashPort = action === "erase" || ["flash", "app-flash", "bootloader-flash", "partition-table-flash", "encrypted-flash"].includes(action) && flashMethod.value === "UART";
    if (usesFlashPort && isMonitoring(flashPort.value)) {
      await stopMonitorPort(flashPort.value);
    }
    activeLog.value = "task";
    autoFollowLog.value = true;
    appendTask(`\n[开始] 执行：${action}${activeProfile.value !== "default" ? ` [${activeProfile.value}]` : ""}\n`);
    await window.idfApi.runTask({
      action, projectPath: projectPath.value, idfPath: selectedIdfPath.value, port: flashPort.value, target: target.value,
      baud: flashBaud.value, buildDir: buildDir.value, flashMethod: flashMethod.value, openOcdConfig: openOcdConfig.value, jtagSerial: jtagSerial.value, customCommand: custom
    });
    await persist();
    return true;
  } catch (error) { resetWorkflow(); showError(error); return false; }
}
async function runBuildFlashMonitor() {
  if (!monitorPort.value) return showError("请先选择监视端口");
  completionWorkflow = "build-flash-monitor";
  workflowQueue.value = ["flash"];
  if (!await runTask("build")) resetWorkflow();
}
async function eraseFlash() {
  if (!flashPort.value) return showError("请先选择烧录端口");
  if (!window.confirm(`将擦除 ${flashPort.value} 上芯片的全部 Flash 数据，包含程序、分区和已保存的数据。此操作无法恢复，是否继续？`)) return;
  showWorkbench("task");
  await runTask("erase");
}
async function openMenuconfig() { try { await window.idfApi.openMenuconfig(projectPath.value, selectedIdfPath.value); status.value = "menuconfig 已在独立终端中打开"; } catch (error) { showError(error); } }
async function openIdfTerminal() { try { await window.idfApi.openIdfTerminal(projectPath.value, selectedIdfPath.value); status.value = "ESP-IDF 终端已打开"; } catch (error) { showError(error); } }
async function openGdb() { try { await window.idfApi.openGdb(projectPath.value, selectedIdfPath.value, buildDir.value); status.value = "GDB 调试终端已打开"; } catch (error) { showError(error); } }
async function cancelTask() {
  if (!taskRunning.value || taskStopping.value) return;
  resetWorkflow();
  taskStopping.value = true;
  try {
    const stopping = await window.idfApi.cancelTask();
    if (!stopping) {
      taskRunning.value = false;
      taskStopping.value = false;
      currentTask.value = "";
      status.value = "未检测到正在运行的任务，界面已恢复";
      appendTask("\n[信息] 后台没有正在运行的任务，已解除任务锁定。\n");
      return;
    }
    status.value = "正在停止任务…";
    appendTask("\n[信息] 已发送停止请求，正在等待命令退出…\n");
  } catch (error) {
    taskStopping.value = false;
    showError(error);
  }
}
async function toggleMonitor() {
  if (!monitorPort.value) return showError("请先选择监视端口");
  try {
    if (isMonitoring(monitorPort.value)) {
      await stopMonitorPort(monitorPort.value);
    } else {
      await window.idfApi.startMonitor(monitorPort.value, monitorBaud.value);
      monitoredPorts.value = [...new Set([...monitoredPorts.value, monitorPort.value])];
      activeMonitorPort.value = monitorPort.value;
      activeLog.value = "serial";
    }
    await persist();
  } catch (error) { showError(error); }
}
async function stopMonitorPort(port: string) {
  await window.idfApi.stopMonitor(port);
  monitoredPorts.value = monitoredPorts.value.filter((item) => item !== port);
  appendSerial(port, "[信息] 串口监视已停止，历史数据保留在此处。\n");
  if (!activeMonitorPort.value) activeMonitorPort.value = port;
}
function clearCurrentLog() {
  if (activeLog.value === "task") taskLog.value = "";
  else if (activeMonitorPort.value) serialLogs.value = { ...serialLogs.value, [activeMonitorPort.value]: "" };
}
function clearComponentLog() { componentLog.value = ""; }
async function sendSerial() {
  if (!serialInput.value) return;
  if (!activeMonitorPort.value || !isMonitoring(activeMonitorPort.value)) return showError("请先启动要发送数据的串口监视");
  try { await window.idfApi.writeSerial(activeMonitorPort.value, serialInput.value, serialMode.value); appendSerial(activeMonitorPort.value, `${serialMode.value === "hex" ? "[TX HEX]" : "[TX]"} ${serialInput.value}\n`); serialInput.value = ""; } catch (error) { showError(error); }
}
async function saveCurrentLog() { try { await window.idfApi.saveLog(cleanLogText(visibleLog.value)); } catch (error) { showError(error); } }

function showWorkbench(tab: "task" | "serial" = "task") {
  activeWorkspace.value = "workbench";
  selectLog(tab);
}

function chooseFlashMethod(method: "UART" | "JTAG" | "DFU") {
  if (method === "DFU" && !dfuTargetSupported.value) return showError("DFU 烧录支持 ESP32-S2、ESP32-S3 和 ESP32-P4");
  flashMethod.value = method;
  status.value = `已选择 ${method} 烧录`;
}

async function installRegistryComponent(payload: { dependency: string; component: string }): Promise<RegistryActionResult> {
  if (!ready.value) {
    const message = "请先选择有效的 ESP-IDF 并打开工程";
    showError(message);
    return { status: "error", message };
  }
  if (taskRunning.value) {
    const message = "当前有任务正在运行，请等待任务结束后再安装组件";
    showError(message);
    return { status: "error", message };
  }
  const dependency = payload.dependency.trim();
  const component = payload.component.trim() || "main";
  if (!dependency) {
    const message = "组件依赖不能为空";
    showError(message);
    return { status: "error", message };
  }
  if (!window.confirm(`将 ${dependency} 添加到当前工程的 ${component} 组件，并执行 reconfigure。\n\n当前工程：${projectPath.value}\n\n是否继续？`)) {
    return { status: "cancelled", message: "已取消组件安装，工程文件没有由本次操作修改。" };
  }
  try {
    activeWorkspace.value = "registry";
    componentLog.value = `[准备] 添加依赖：${dependency} → ${component}\n`;
    captureComponentLog = true;
    appendTask(`\n[组件] 添加依赖：${dependency} → ${component}\n`);
    status.value = `正在提交组件 ${dependency}`;
    await window.idfApi.addComponentDependency(projectPath.value, selectedIdfPath.value, dependency, component, buildDir.value);
    status.value = `正在添加组件 ${dependency}`;
    return { status: "started", message: `已开始添加 ${dependency}；执行进度和结果显示在左侧日志中。` };
  } catch (error) {
    captureComponentLog = false;
    componentLog.value += `\n[错误] ${formatError(error)}\n`;
    showError(error);
    return { status: "error", message: `${formatError(error)}。如果任务在重新配置阶段失败，idf_component.yml 可能已写入依赖，请修正问题后重试。` };
  }
}

async function createRegistryExample(payload: { example: string }): Promise<RegistryActionResult> {
  if (!selectedSetup.value?.valid) {
    const message = "请先选择有效的 ESP-IDF 环境";
    showError(message);
    return { status: "error", message };
  }
  if (taskRunning.value) {
    const message = "当前有任务正在运行，请等待任务结束后再创建示例工程";
    showError(message);
    return { status: "error", message };
  }
  if (!confirmProjectSwitch()) return { status: "cancelled", message: "已取消创建，当前工程和未保存配置均保持不变。" };
  try {
    const created = await window.idfApi.createProjectFromComponentExample(selectedIdfPath.value, payload.example);
    if (!created) return { status: "cancelled", message: "已取消选择保存目录，没有创建示例工程。" };
    const settings = await window.idfApi.loadSettings();
    if (!await activateProject(created, settings, true)) return { status: "error", message: `示例工程已创建到 ${created}，但未能切换为当前工程。` };
    activeWorkspace.value = "workbench";
    status.value = "组件示例工程已创建并打开";
    return { status: "completed", message: `示例工程已创建并打开：${created}` };
  } catch (error) {
    showError(error);
    return { status: "error", message: formatError(error) };
  }
}

async function runDoctor() {
  const generation = projectGeneration;
  const selected = projectPath.value;
  try {
    const checks = await window.idfApi.runDoctor(selectedIdfPath.value, selected, target.value);
    if (generation !== projectGeneration || selected !== projectPath.value) return;
    doctorChecks.value = checks;
    doctorVisible.value = true;
  } catch (error) { if (generation === projectGeneration && selected === projectPath.value) showError(error); }
}
async function loadKconfigEditor() {
  const previousSessionId = kconfigSessionId;
  kconfigSessionId = "";
  sdkLoading.value = true;
  invalidateKconfigPreview();
  const epoch = kconfigSessionEpoch;
  const generation = projectGeneration;
  try {
    clearKconfigRendererState(false);
    if (previousSessionId) await window.idfApi.closeKconfig(previousSessionId);
    await kconfigPreviewTail;
    const context = {
      epoch,
      generation,
      projectPath: projectPath.value,
      idfPath: selectedIdfPath.value,
      buildDir: buildDir.value
    };
    if (!sdkVisible.value || !isKconfigContextCurrent(context, false)) return false;
    const graphical = await window.idfApi.readKconfig(context.projectPath, context.idfPath, context.buildDir);
    if (!sdkVisible.value || !isKconfigContextCurrent(context, false)) {
      await window.idfApi.closeKconfig(graphical.sessionId);
      return false;
    }
    let raw: SdkconfigEntry[];
    try { raw = await window.idfApi.readSdkconfig(context.projectPath); }
    catch (error) {
      await window.idfApi.closeKconfig(graphical.sessionId);
      throw error;
    }
    if (!sdkVisible.value || !isKconfigContextCurrent(context, false)) {
      await window.idfApi.closeKconfig(graphical.sessionId);
      return false;
    }
    kconfigSessionId = graphical.sessionId;
    kconfigState.value = graphical;
    kconfigOriginalValues.value = { ...graphical.values };
    sdkEntries.value = raw;
    sdkOriginalEntries.value = raw.map((entry) => ({ ...entry }));
    kconfigPath.value = [];
    kconfigChanges.value = {};
    kconfigQuick.value = true;
    return true;
  } finally {
    if (epoch === kconfigSessionEpoch && generation === projectGeneration) sdkLoading.value = false;
  }
}
async function openSdkEditor() {
  if (sdkLoading.value || sdkVisible.value || projectContextSwitching.value) return;
  const generation = projectGeneration;
  sdkVisible.value = true;
  sdkMode.value = "graphical";
  try {
    const loaded = await loadKconfigEditor();
    if (!loaded && generation === projectGeneration) {
      sdkVisible.value = false;
      clearKconfigRendererState();
    }
  }
  catch (error) {
    if (generation === projectGeneration) {
      sdkVisible.value = false;
      clearKconfigRendererState();
      showError(error);
    }
  }
}
function normalizeEditorCsv(kind: "partition" | "nvs", csv: string) {
  const normalized = csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const headerOk = kind === "partition"
    ? /#\s*Name,\s*Type,\s*SubType,\s*Offset,\s*Size,\s*Flags/i.test(normalized)
    : /(?:^|\n)\s*key,\s*type,\s*encoding,\s*value/i.test(normalized);
  if (!headerOk) throw new Error(kind === "partition" ? "分区表缺少标准表头：# Name, Type, SubType, Offset, Size, Flags" : "NVS CSV 缺少标准表头：key,type,encoding,value");
  return normalized;
}
async function openCsvTool(kind: "partition" | "nvs") {
  const generation = projectGeneration;
  const selected = projectPath.value;
  try {
    const opened = await window.idfApi.openCsvEditor(kind, selected);
    if (generation !== projectGeneration || selected !== projectPath.value) return;
    const editorCsv = normalizeEditorCsv(kind, opened.csv);
    csvEditor.value = { kind, path: opened.path, csv: editorCsv };
    csvWebviewMessage.value = { command: "loadInitialData", csv: editorCsv };
    if (kind === "partition") partitionVisible.value = true; else nvsVisible.value = true;
  } catch (error) { if (generation === projectGeneration && selected === projectPath.value) showError(error); }
}
async function openSizeAnalysis() {
  const generation = projectGeneration;
  const selected = projectPath.value;
  const idfPath = selectedIdfPath.value;
  const selectedBuildDir = buildDir.value;
  try {
    status.value = "正在读取链接映射并生成大小分析…";
    const data = await window.idfApi.analyzeSize(selected, idfPath, selectedBuildDir);
    if (generation !== projectGeneration || selected !== projectPath.value || idfPath !== selectedIdfPath.value || selectedBuildDir !== buildDir.value) return;
    sizeWebviewMessage.value = { command: "initialLoad", ...data };
    sizeVisible.value = true;
    status.value = "大小分析已生成";
  } catch (error) { if (generation === projectGeneration && selected === projectPath.value) showError(error); }
}
async function handleCsvEditorMessage(message: Record<string, unknown>) {
  try {
    const refreshRequested = (csvEditor.value.kind === "partition" && message.command === "initDataRequest") || (csvEditor.value.kind === "nvs" && message.command === "getInitialData");
    if (refreshRequested) {
      const freshCsv = normalizeEditorCsv(csvEditor.value.kind, await window.idfApi.readEditorText(csvEditor.value.path));
      csvEditor.value.csv = freshCsv;
      csvWebviewMessage.value = { command: "loadInitialData", csv: freshCsv };
      status.value = `${csvEditor.value.kind === "partition" ? "分区表" : "NVS CSV"}已从磁盘重新加载`;
    } else if (message.command === "saveDataRequest" && typeof message.csv === "string") {
      await window.idfApi.saveEditorText(csvEditor.value.path, message.csv);
      csvEditor.value.csv = message.csv;
      csvWebviewMessage.value = { command: "loadInitialData", csv: normalizeEditorCsv(csvEditor.value.kind, message.csv) };
      status.value = `${csvEditor.value.kind === "partition" ? "分区表" : "NVS CSV"}已保存`;
    } else if (message.command === "showErrorMessage") showError(String(message.error || "编辑器校验失败"));
    else if (message.command === "commandLink") {
      const command = String(message.target || "");
      if (command === "espIdf.buildDevice") await runTask("build");
      else if (command === "espIdf.flashDevice") await runTask("flash");
      else if (command === "espIdf.selectFlashMethodAndFlash") status.value = "请在主工作流顶部选择烧录方式";
    } else if (message.command === "openKeyFile") {
      const keyFilePath = await window.idfApi.chooseKeyFile(projectPath.value);
      if (keyFilePath) csvWebviewMessage.value = { command: "openKeyFile", keyFilePath };
    } else if (message.command === "genNvsPartition") {
      const generated = await window.idfApi.generateNvsPartition(selectedIdfPath.value, csvEditor.value.path, {
        encrypt: Boolean(message.encrypt), encryptKeyPath: String(message.encryptKeyPath || ""), generateKey: Boolean(message.generateKey), partitionSize: String(message.partitionSize || "")
      });
      appendTask(`\n${generated.log}\n生成文件：${generated.output}\n`);
      status.value = `NVS 分区已生成：${generated.output}`;
    }
  } catch (error) { showError(error); }
}
async function runExtensionCommand(command: string) {
  const taskMap: Record<string, TaskRequest["action"]> = {
    "espIdf.buildDevice": "build", "espIdf.buildApp": "app", "espIdf.buildBootloader": "bootloader", "espIdf.buildPartitionTable": "partition-table",
    "espIdf.flashDevice": "flash", "espIdf.flashAppUart": "app-flash", "espIdf.flashBootloaderUart": "bootloader-flash", "espIdf.flashPartitionTableUart": "partition-table-flash", "espIdf.flashAndEncryptDevice": "encrypted-flash", "esp.efuse.summary": "efuse-summary", "espIdf.fullClean": "fullclean", "espIdf.eraseFlash": "erase",
    "espIdf.idfReconfigureTask": "reconfigure", "espIdf.saveDefSdkconfig": "save-defconfig", "espIdf.openOCDCommand": "openocd", "espIdf.qemuCommand": "qemu"
  };
  try {
    if (taskMap[command]) return void await runTask(taskMap[command]);
    switch (command) {
      case "esp.webview.open.partition-table": return void await openCsvTool("partition");
      case "espIdf.webview.nvsPartitionEditor": return void await openCsvTool("nvs");
      case "espIdf.menuconfig.start": return void await openSdkEditor();
      case "espIdf.createClassicMenuconfig": return void await openMenuconfig();
      case "espIdf.createIdfTerminal": return void await openIdfTerminal();
      case "espIdf.setTarget": return void await runTask("set-target");
      case "espIdf.selectPort": case "espIdf.selectMonitorPort": case "espIdf.detectSerialPort": return void await refreshPorts();
      case "espIdf.monitorDevice": return void await toggleMonitor();
      case "espIdf.size": return void await openSizeAnalysis();
      case "espIdf.buildFlashMonitor": return void await runBuildFlashMonitor();
      case "espIdf.flashUart": flashMethod.value = "UART"; return void await runTask("flash");
      case "espIdf.flashDFU": flashMethod.value = "DFU"; return void await runTask("flash");
      case "espIdf.jtag_flash": flashMethod.value = "JTAG"; return void await runTask("flash");
      case "espIdf.selectFlashMethodAndFlash": activeWorkspace.value = "workbench"; advancedVisible.value = false; status.value = "请在主工作流顶部选择 UART、JTAG 或 DFU，然后执行烧录"; return;
      case "esp.component-manager.ui.show": activeWorkspace.value = "registry"; advancedVisible.value = false; return;
      case "espIdf.doctorCommand": return void await runDoctor();
      case "espIdf.createNewComponent": return void await createComponent();
      case "espIdf.newProject.start": case "espIdf.createNewProject": return void await showCreateProject();
      case "espIdf.installManager": return void await openInstallManager();
      case "espIdf.getEspAdf": return void await installAdf();
      case "espIdf.createDevContainer": return void await addSupportFiles("devcontainer");
      case "espIdf.createVsCodeFolder": return void await addSupportFiles("vscode");
      case "espIdf.customTask": advancedVisible.value = false; customTaskVisible.value = true; return;
      case "espIdf.qemuDebug": return void await openGdb();
      case "espIdf.projectConf": status.value = "工程配置位于主界面左侧的“工程配置”区域"; advancedVisible.value = false; return;
      case "espIdf.searchInEspIdfDocs": case "espIdf.openDocUrl": return void await window.idfApi.openExternal("https://docs.espressif.com/projects/esp-idf/zh_CN/v5.5.4/");
      case "espIdf.openWalkthrough": case "espIdf.welcome.start": return void await window.idfApi.openExternal("https://github.com/espressif/vscode-esp-idf-extension/blob/master/docs/tutorial/basic_use.md");
      default: showError(`“${command}”依赖 VS Code 调试器、树视图、云登录或尚未安装的外部工具；功能入口已收录，后续将改写为桌面等价实现。`);
    }
  } catch (error) { showError(error); }
}
function findKconfigPath(target: KconfigNode) {
  const visit = (nodes: KconfigNode[], parents: KconfigNode[]): KconfigNode[] | null => {
    for (const node of nodes) {
      if (node.id === target.id) return [...parents, node];
      const found = visit(node.children || [], [...parents, node]);
      if (found) return found;
    }
    return null;
  };
  return visit(kconfigState.value?.menus || [], []) || [];
}
function openKconfigMenu(node: KconfigNode) {
  kconfigPath.value = findKconfigPath(node);
  kconfigSearch.value = "";
  kconfigQuick.value = false;
}
function goKconfigLevel(index: number) { kconfigQuick.value = false; kconfigPath.value = index < 0 ? [] : kconfigPath.value.slice(0, index + 1); }
function showKconfigQuick() { kconfigQuick.value = true; kconfigPath.value = []; kconfigSearch.value = ""; }

function invalidateKconfigPreview() {
  kconfigSessionEpoch += 1;
  if (kconfigPreviewTimer) clearTimeout(kconfigPreviewTimer);
  kconfigPreviewTimer = null;
  kconfigPendingUpdates = {};
  kconfigPreviewError = null;
  kconfigEditVersions.clear();
  if (!kconfigPreviewJobs) kconfigSyncing.value = false;
}

type KconfigRequestContext = {
  epoch: number;
  generation: number;
  projectPath: string;
  idfPath: string;
  buildDir: string;
  sessionId?: string;
};

function captureKconfigContext(): KconfigRequestContext {
  return {
    epoch: kconfigSessionEpoch,
    generation: projectGeneration,
    projectPath: projectPath.value,
    idfPath: selectedIdfPath.value,
    buildDir: buildDir.value,
    sessionId: kconfigSessionId
  };
}

function isKconfigContextCurrent(context: KconfigRequestContext, requireSession = true) {
  return context.epoch === kconfigSessionEpoch
    && context.generation === projectGeneration
    && context.projectPath === projectPath.value
    && context.idfPath === selectedIdfPath.value
    && context.buildDir === buildDir.value
    && (!requireSession || Boolean(context.sessionId) && context.sessionId === kconfigSessionId);
}

function recalculateKconfigChanges() {
  const state = kconfigState.value;
  if (!state) return;
  const next: Record<string, KconfigValue> = {};
  for (const [name, value] of Object.entries(state.values)) {
    if (!Object.is(value, kconfigOriginalValues.value[name])) next[name] = value;
  }
  kconfigChanges.value = next;
}

function mergeKconfigState(next: KconfigState, reapplyChangesAfter?: number) {
  const current = kconfigState.value;
  if (next.sessionId !== kconfigSessionId || current && current.sessionId !== next.sessionId) return;
  if (!current) {
    kconfigState.value = next;
    recalculateKconfigChanges();
    return;
  }
  const newerValues = new Map<string, KconfigValue>();
  let hasNewerEdits = false;
  if (reapplyChangesAfter !== undefined) {
    for (const [name, version] of kconfigEditVersions) {
      if (version > reapplyChangesAfter) {
        hasNewerEdits = true;
        if (name in current.values) newerValues.set(name, current.values[name]);
      }
    }
  }
  Object.assign(current.values, next.values);
  // A response older than a pending local edit must not temporarily hide/show
  // controls for the old dependency state. The next full response is authoritative.
  if (!hasNewerEdits) {
    Object.assign(current.ranges, next.ranges);
    Object.assign(current.visible, next.visible);
  }
  for (const [name, value] of newerValues) current.values[name] = value;
  recalculateKconfigChanges();
}

function flushKconfigPreview() {
  if (kconfigPreviewTimer) clearTimeout(kconfigPreviewTimer);
  kconfigPreviewTimer = null;
  const updates = kconfigPendingUpdates;
  kconfigPendingUpdates = {};
  if (Object.keys(updates).length) {
    const context = captureKconfigContext();
    const requestSequence = kconfigEditSequence;
    kconfigPreviewJobs += 1;
    kconfigSyncing.value = true;
    kconfigPreviewTail = kconfigPreviewTail
      .then(async () => {
        if (!isKconfigContextCurrent(context) || !sdkVisible.value || !kconfigState.value) return;
        const next = await window.idfApi.updateKconfig(context.sessionId!, context.projectPath, context.idfPath, updates, context.buildDir);
        if (!isKconfigContextCurrent(context) || !sdkVisible.value || !kconfigState.value) return;
        mergeKconfigState(next, requestSequence);
        kconfigPreviewError = null;
        if (next.errors?.length) showError(new Error(next.errors.join("；")));
      })
      .catch((error) => {
        if (isKconfigContextCurrent(context) && sdkVisible.value) {
          for (const [name, value] of Object.entries(updates)) {
            if ((kconfigEditVersions.get(name) || 0) <= requestSequence && !(name in kconfigPendingUpdates)) kconfigPendingUpdates[name] = value;
          }
          kconfigPreviewError = error;
          showError(error);
        }
      })
      .finally(() => {
        kconfigPreviewJobs = Math.max(0, kconfigPreviewJobs - 1);
        if (!kconfigPreviewJobs) kconfigSyncing.value = false;
      });
  }
  return kconfigPreviewTail;
}

function setKconfigValue(name: string | undefined, value: KconfigValue, immediate = false, localValues?: Record<string, KconfigValue>) {
  if (!name || !kconfigState.value || kconfigCommitting.value) return;
  kconfigEditSequence += 1;
  for (const [localName, localValue] of Object.entries(localValues || { [name]: value })) {
    kconfigState.value.values[localName] = localValue;
    kconfigEditVersions.set(localName, kconfigEditSequence);
  }
  kconfigPendingUpdates[name] = value;
  recalculateKconfigChanges();
  if (immediate) void flushKconfigPreview();
  else {
    if (kconfigPreviewTimer) clearTimeout(kconfigPreviewTimer);
    kconfigPreviewTimer = setTimeout(() => void flushKconfigPreview(), 180);
  }
}

function resetKconfigValue(name: string, value: KconfigValue, localValues?: Record<string, KconfigValue>) {
  setKconfigValue(name, value, false, localValues);
}

async function discardKconfigChanges() {
  if (kconfigCommitting.value || sdkLoading.value) return;
  kconfigCommitting.value = true;
  try {
    if (sdkMode.value === "raw") {
      await loadKconfigEditor();
      status.value = "已重新载入 sdkconfig";
      return;
    }
    invalidateKconfigPreview();
    const context = captureKconfigContext();
    await kconfigPreviewTail;
    if (!isKconfigContextCurrent(context)) throw new Error("当前工程或 SDK 配置会话已变化，请重新打开编辑器");
    const next = await window.idfApi.discardKconfig(context.sessionId!, context.projectPath, context.idfPath, context.buildDir);
    if (!isKconfigContextCurrent(context)) return;
    mergeKconfigState(next);
    if (next.errors?.length) throw new Error(next.errors.join("；"));
    kconfigOriginalValues.value = { ...next.values };
    kconfigChanges.value = {};
    const raw = await window.idfApi.readSdkconfig(context.projectPath);
    if (!isKconfigContextCurrent(context)) return;
    sdkEntries.value = raw;
    sdkOriginalEntries.value = raw.map((entry) => ({ ...entry }));
    status.value = "已丢弃未保存修改并重新载入 sdkconfig";
  } catch (error) { showError(error); }
  finally { kconfigCommitting.value = false; }
}

async function resetKconfigToDefaults() {
  if (kconfigCommitting.value || sdkLoading.value || !kconfigState.value) return;
  if (!window.confirm("将当前图形配置恢复为 ESP-IDF/Kconfig 默认值？这会覆盖本次所有未保存修改，但只有点击“保存”才会写入项目的 sdkconfig。")) return;
  kconfigCommitting.value = true;
  try {
    invalidateKconfigPreview();
    const context = captureKconfigContext();
    await kconfigPreviewTail;
    if (!isKconfigContextCurrent(context)) throw new Error("当前工程或 SDK 配置会话已变化，请重新打开编辑器");
    const next = await window.idfApi.resetKconfigToDefaults(context.sessionId!, context.projectPath, context.idfPath, context.buildDir);
    if (!isKconfigContextCurrent(context)) return;
    mergeKconfigState(next);
    if (next.errors?.length) throw new Error(next.errors.join("；"));
    // Keep kconfigOriginalValues as the project-file baseline: the editor can
    // correctly show every defaulted value as pending until the user saves.
    recalculateKconfigChanges();
    kconfigEditVersions.clear();
    kconfigPreviewError = null;
    status.value = "已在预览中恢复 ESP-IDF 默认值；点击保存才会写入 sdkconfig";
  } catch (error) { showError(error); }
  finally { kconfigCommitting.value = false; }
}

async function saveSdkEditor() {
  if (kconfigCommitting.value || sdkLoading.value) return;
  kconfigCommitting.value = true;
  try {
    const context = captureKconfigContext();
    if (!isKconfigContextCurrent(context)) throw new Error("当前工程或 SDK 配置会话已变化，请重新打开编辑器");
    if (sdkMode.value === "raw") {
      await window.idfApi.saveSdkconfig(context.projectPath, sdkEntries.value.map(({ key, value, enabled }) => ({ key, value, enabled })));
      if (!isKconfigContextCurrent(context)) return;
      invalidateKconfigPreview();
      kconfigSessionId = "";
      await window.idfApi.closeKconfig(context.sessionId!);
      await kconfigPreviewTail;
      try {
        const reloaded = await loadKconfigEditor();
        if (!reloaded) throw new Error("配置会话未重新建立");
      } catch (error) {
        sdkVisible.value = false;
        clearKconfigRendererState();
        throw new Error(`sdkconfig 已保存，但图形配置会话重新启动失败，请重新打开编辑器：${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (kconfigChangeCount.value) {
      await flushKconfigPreview();
      if (!isKconfigContextCurrent(context)) throw new Error("当前工程或 SDK 配置会话已变化，请重新打开编辑器");
      if (kconfigPreviewError) throw kconfigPreviewError;
      const next = await window.idfApi.saveKconfig(context.sessionId!, context.projectPath, context.idfPath, context.buildDir);
      if (!isKconfigContextCurrent(context)) return;
      mergeKconfigState(next);
      if (next.errors?.length) throw new Error(next.errors.join("；"));
      kconfigOriginalValues.value = { ...next.values };
      kconfigChanges.value = {};
      kconfigEditVersions.clear();
      const raw = await window.idfApi.readSdkconfig(context.projectPath);
      if (!isKconfigContextCurrent(context)) return;
      sdkEntries.value = raw;
      sdkOriginalEntries.value = raw.map((entry) => ({ ...entry }));
    }
    status.value = "sdkconfig 已由 ESP-IDF 配置服务器保存";
  } catch (error) { showError(error); }
  finally { kconfigCommitting.value = false; }
}

async function closeSdkEditor(confirmUnsaved = true) {
  if (kconfigCommitting.value || sdkLoading.value) return;
  const hasUnsaved = sdkMode.value === "graphical" ? Boolean(kconfigChangeCount.value) : sdkRawDirty.value;
  if (confirmUnsaved && hasUnsaved && !window.confirm("还有未保存的 SDK 配置修改。关闭后这些修改会丢失，是否继续？")) return;
  const sessionId = kconfigSessionId;
  kconfigSessionId = "";
  sdkVisible.value = false;
  invalidateKconfigPreview();
  clearKconfigRendererState();
  try { if (sessionId) await window.idfApi.closeKconfig(sessionId); }
  catch (error) { showError(error); }
  await kconfigPreviewTail;
}

async function switchSdkMode(mode: "graphical" | "raw") {
  if (mode === sdkMode.value || sdkLoading.value || kconfigCommitting.value) return;
  if (sdkMode.value === "graphical" && kconfigChangeCount.value) {
    if (!window.confirm("图形配置还有未保存修改。切换模式前要丢弃这些修改吗？")) return;
    await discardKconfigChanges();
    if (kconfigChangeCount.value) return;
  } else if (sdkMode.value === "raw" && sdkRawDirty.value) {
    if (!window.confirm("原始键值还有未保存修改。切换模式会丢弃这些修改，是否继续？")) return;
    sdkEntries.value = sdkOriginalEntries.value.map((entry) => ({ ...entry }));
  }
  sdkMode.value = mode;
}
async function createComponent() { const name = window.prompt("请输入组件名称"); if (!name) return; try { advancedVisible.value = false; await window.idfApi.createComponent(projectPath.value, selectedIdfPath.value, name, buildDir.value); } catch (error) { showError(error); } }
async function addSupportFiles(kind: "vscode" | "devcontainer") { if (!window.confirm(`此操作会向工程添加 .${kind} 目录，是否继续？`)) return; try { const folder = await window.idfApi.addSupportFiles(projectPath.value, kind); status.value = `已添加：${folder}`; } catch (error) { showError(error); } }
async function installQemu() { if (!window.confirm("将通过 ESP-IDF 工具管理器联网安装 QEMU，是否继续？")) return; try { await window.idfApi.installQemu(projectPath.value, selectedIdfPath.value); } catch (error) { showError(error); } }
async function installAdf() { if (!window.confirm("将联网下载 ESP-ADF，是否继续？")) return; try { await window.idfApi.installAdf(projectPath.value, selectedIdfPath.value); } catch (error) { showError(error); } }
async function openInstallManager() { try { await window.idfApi.openInstallManager(selectedIdfPath.value); } catch (error) { showError(error); } }
function addProfile() { const name = window.prompt("新配置名称（例如 release、debug）"); if (!name || profiles.value.includes(name)) return; profiles.value.push(name); activeProfile.value = name; void persist(); }
function removeProfile() { if (activeProfile.value === "default") return; if (!window.confirm(`删除配置 ${activeProfile.value}？仅删除软件配置，不删除构建目录。`)) return; profiles.value = profiles.value.filter((name) => name !== activeProfile.value); activeProfile.value = "default"; void persist(); }
function addCustomTask() { if (!customName.value.trim() || !customCommand.value.trim()) return; customTasks.value.push({ name: customName.value.trim(), command: customCommand.value.trim() }); customName.value = ""; customCommand.value = ""; void persist(); }
function removeCustomTask(index: number) { customTasks.value.splice(index, 1); void persist(); }

function closeActiveDialog() {
  if (partitionVisible.value) partitionVisible.value = false;
  else if (nvsVisible.value) nvsVisible.value = false;
  else if (sizeVisible.value) sizeVisible.value = false;
  else if (sdkVisible.value) void closeSdkEditor();
  else if (doctorVisible.value) doctorVisible.value = false;
  else if (customTaskVisible.value) customTaskVisible.value = false;
  else if (advancedVisible.value) advancedVisible.value = false;
  else if (createVisible.value) createVisible.value = false;
}

function handleDialogKeydown(event: KeyboardEvent) {
  const dialog = document.querySelector<HTMLElement>(".modal-backdrop .modal");
  if (!dialog) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeActiveDialog();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.offsetParent !== null);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

watch(dialogVisible, async (open, wasOpen) => {
  if (open && !wasOpen) {
    dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    document.querySelector<HTMLElement>(".modal-backdrop .modal")?.focus();
  } else if (!open && wasOpen) {
    dialogReturnFocus?.focus();
    dialogReturnFocus = null;
  }
});

let removeTaskOutput = () => {};
let removeTaskState = () => {};
let removeSerialData = () => {};
onMounted(async () => {
  document.addEventListener("keydown", handleDialogKeydown);
  document.addEventListener("keydown", handleGlobalKeydown);
  removeTaskOutput = window.idfApi.onTaskOutput(({ text }) => {
    appendTask(text);
    if (captureComponentLog) componentLog.value += text;
  });
  removeTaskState = window.idfApi.onTaskState(async ({ running, code, action }) => {
    taskRunning.value = running;
    taskStopping.value = false;
    currentTask.value = running ? action || "任务" : "";
    if (action === "component-add") {
      if (running) {
        captureComponentLog = true;
      } else {
        componentLog.value += `\n[${code === 0 ? "成功" : "失败"}] 添加依赖任务结束，退出码：${code}\n`;
        captureComponentLog = false;
      }
    }
    if (!running) {
      const success = code === 0;
      appendTask(`\n[${success ? "成功" : "失败"}] 任务结束，退出码：${code}\n`);
      status.value = success ? "任务执行成功" : `任务失败（退出码 ${code}）`;
      if (!success) {
        // ESP-IDF can rename/recreate sdkconfig before a set-target failure is
        // reported. Never leave the renderer attached to that former context.
        if (action === "set-target") {
          taskRunning.value = true;
          currentTask.value = "同步目标配置";
          try { await synchronizeAfterTargetChange(false); }
          catch (error) { showError(error); }
          finally { taskRunning.value = false; currentTask.value = ""; }
        }
        resetWorkflow();
        return;
      }
      if (action === "set-target") {
        // Keep all workflow controls disabled until the UI has discarded the
        // old target's Kconfig session and read back the new sdkconfig target.
        taskRunning.value = true;
        currentTask.value = "刷新目标配置";
        try { await synchronizeAfterTargetChange(true); }
        catch (error) { showError(error); }
        finally { taskRunning.value = false; currentTask.value = ""; }
      }
      if (success && workflowQueue.value.length) { const next = workflowQueue.value.shift()!; await runTask(next); return; }
      workflowQueue.value = [];
      const completedWorkflow = completionWorkflow;
      completionWorkflow = "none";
      if (action === "build" && completedWorkflow === "none") {
        await playCompletionSound();
      } else if (action === "flash" && completedWorkflow === "build-flash-monitor") {
        try {
          if (!monitorPort.value) throw new Error("完整工作流需要先选择监视端口");
          const started = await window.idfApi.startMonitor(monitorPort.value, monitorBaud.value);
          if (!started) throw new Error("串口监视器未能启动");
          monitoredPorts.value = [...new Set([...monitoredPorts.value, monitorPort.value])];
          activeMonitorPort.value = monitorPort.value;
          activeLog.value = "serial";
          await playCompletionSound();
        } catch (error) { showError(error); }
      } else if (action === "flash") {
        if (autoMonitor.value && monitorPort.value) {
          try { await window.idfApi.startMonitor(monitorPort.value, monitorBaud.value); monitoredPorts.value = [...new Set([...monitoredPorts.value, monitorPort.value])]; activeMonitorPort.value = monitorPort.value; activeLog.value = "serial"; } catch (error) { showError(error); }
        }
        await playCompletionSound();
      }
    }
  });
  removeSerialData = window.idfApi.onSerialData((event) => {
    const port = event.port || activeMonitorPort.value || monitorPort.value;
    if (event.type === "data" && event.data) appendSerial(port, event.data);
    if (event.message) appendSerial(port, `[${event.type === "error" ? "错误" : "信息"}] ${event.message}\n`);
  });
  try {
    projectContextSwitching.value = true;
    const settings = await window.idfApi.loadSettings();
    await refreshIdf();
    projectContextSwitching.value = false;
    if (settings.lastProject) await activateProject(settings.lastProject, settings);
    else {
      projectContextSwitching.value = true;
      applyProjectSettings(defaultProjectSettings(selectedIdfPath.value, "esp32"));
      await refreshTargetsForSelection(selectedIdfPath.value);
      await refreshPorts();
      await refreshJtagDevices();
      await refreshCapabilities();
      projectContextSwitching.value = false;
    }
    status.value = setups.value.length ? "环境检测完成" : "未发现 ESP-IDF，请手动选择";
  } catch (error) {
    projectContextSwitching.value = false;
    showError(error);
  }
});
watch(selectedIdfPath, async (value) => {
  if (!value || projectContextSwitching.value) return;
  const generation = projectGeneration;
  const selected = projectPath.value;
  try {
    await refreshTargetsForSelection(value);
    if (generation !== projectGeneration || selected !== projectPath.value || value !== selectedIdfPath.value) return;
    await refreshCapabilities();
    if (generation === projectGeneration && selected === projectPath.value) await persist();
  } catch (error) { showError(error); }
});
watch(kconfigRuntimeKey, (current, previous) => {
  if (!previous || current === previous || projectContextSwitching.value || (!sdkVisible.value && !kconfigSessionId)) return;
  // This is a final safety net for profile/IDF/target changes initiated by a
  // future feature: old Kconfig menu data must not be reused across contexts.
  void (async () => {
    const generation = projectGeneration;
    const selected = projectPath.value;
    projectContextSwitching.value = true;
    try {
      await teardownKconfigForProjectSwitch();
      if (generation === projectGeneration && selected === projectPath.value) status.value = "配置上下文已变化，旧 SDK 配置会话已关闭；请重新打开配置编辑器";
    } catch (error) {
      if (generation === projectGeneration && selected === projectPath.value) showError(error);
    } finally {
      if (generation === projectGeneration && selected === projectPath.value) projectContextSwitching.value = false;
    }
  })();
});
watch(target, async () => {
  if (projectContextSwitching.value) return;
  if (flashMethod.value === "DFU" && !dfuTargetSupported.value) {
    flashMethod.value = "UART";
    status.value = "当前目标不支持 DFU，已切换为 UART 烧录";
  }
  const generation = projectGeneration;
  const selected = projectPath.value;
  if (!openOcdConfig.value || /board\/esp32.*-builtin\.cfg/.test(openOcdConfig.value)) openOcdConfig.value = `board/${target.value}-builtin.cfg`;
  await refreshCapabilities();
  if (generation !== projectGeneration || selected !== projectPath.value) return;
});
watch([target, flashPort, monitorPort, jtagSerial, flashMethod, flashBaud, monitorBaud, autoMonitor, completionSound, activeProfile, openOcdConfig], () => {
  syncJtagDeviceToPort();
  if (!projectContextSwitching.value) void persist();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleDialogKeydown);
  document.removeEventListener("keydown", handleGlobalKeydown);
  removeTaskOutput();
  removeTaskState();
  removeSerialData();
  invalidateKconfigPreview();
  const sessionId = kconfigSessionId;
  kconfigSessionId = "";
  if (sessionId) void window.idfApi.closeKconfig(sessionId);
});
</script>

<template>
  <div class="app-frame">
    <header class="topbar">
          <div class="brand"><div class="brand-mark">IDF</div><div class="brand-copy"><h1>ESP-IDF 工具箱</h1><p>工程与设备工作台 <small class="app-version">v0.8.10</small></p></div></div>
      <div class="breadcrumbs"><span>当前工程</span><i class="codicon codicon-chevron-right" /><strong>{{ currentProjectName }}</strong><span>/</span><b>{{ activeWorkspace === 'registry' ? '组件注册表' : '工作台' }}</b></div>
      <div class="top-actions"><div class="top-status"><i :class="['codicon', ready ? 'codicon-pass-filled' : 'codicon-warning']" /><span>{{ status }}</span></div><button class="top-icon-button" aria-label="高级工具" title="高级工具" @click="advancedVisible = true"><i class="codicon codicon-tools" /></button></div>
    </header>

    <main class="app-shell">
      <aside class="project-sidebar" aria-label="工程导航">
        <p class="section-kicker">Project</p>
        <button class="project-switch" :disabled="projectContextSwitching || taskRunning" @click="openProject">
          <i class="codicon codicon-folder-opened" />
          <span><strong>{{ currentProjectName }}</strong><small :title="projectPath">{{ projectPath || '点击打开 ESP-IDF 工程' }}</small></span>
          <i class="codicon codicon-chevron-down" />
        </button>
        <div class="profile-control"><select v-model="activeProfile" aria-label="工程配置"><option v-for="name in profiles" :key="name" :value="name">{{ name }} · {{ name === 'default' ? 'build' : `build-${name}` }}</option></select><button aria-label="添加工程配置" title="添加工程配置" @click="addProfile"><i class="codicon codicon-add" /></button><button :disabled="activeProfile === 'default'" aria-label="删除工程配置" title="删除工程配置" @click="removeProfile"><i class="codicon codicon-remove" /></button></div>

        <p class="section-kicker navigation-kicker">Workspace</p>
        <nav class="nav-list">
          <button :class="['nav-item', { active: activeWorkspace === 'workbench' && activeLog === 'task' }]" :aria-current="activeWorkspace === 'workbench' && activeLog === 'task' ? 'page' : undefined" @click="showWorkbench('task')"><i class="codicon codicon-home" /><span>工作台</span><i class="codicon codicon-chevron-right" /></button>
          <button class="nav-item" :disabled="!ready" @click="openSdkEditor"><i class="codicon codicon-settings-gear" /><span>SDK 配置</span><i class="codicon codicon-chevron-right" /></button>
          <button class="nav-item" :disabled="!ready" @click="openMenuconfig"><i class="codicon codicon-terminal" /><span>menuconfig</span><i class="codicon codicon-chevron-right" /></button>
          <button class="nav-item" :disabled="!ready" @click="openCsvTool('partition')"><i class="codicon codicon-list-tree" /><span>分区表编辑器</span><i class="codicon codicon-chevron-right" /></button>
          <button :class="['nav-item', { active: activeWorkspace === 'registry' }]" :aria-current="activeWorkspace === 'registry' ? 'page' : undefined" @click="activeWorkspace = 'registry'"><i class="codicon codicon-package" /><span>组件注册表</span><i class="codicon codicon-chevron-right" /></button>
          <button :class="['nav-item', { active: activeWorkspace === 'workbench' && activeLog === 'serial' }]" :aria-current="activeWorkspace === 'workbench' && activeLog === 'serial' ? 'page' : undefined" @click="showWorkbench('serial')"><i class="codicon codicon-plug" /><span>串口监视</span><i class="codicon codicon-chevron-right" /></button>
          <button class="nav-item" @click="advancedVisible = true"><i class="codicon codicon-tools" /><span>高级工具</span><i class="codicon codicon-chevron-right" /></button>
        </nav>
        <div class="sidebar-actions"><button :disabled="projectContextSwitching || taskRunning" @click="showCreateProject"><i class="codicon codicon-new-folder" />新建工程</button></div>
        <div class="sidebar-note"><strong>ESP-IDF {{ selectedSetup ? `v${selectedSetup.version}` : '未选择' }}</strong><span>{{ target.toUpperCase() }} · {{ buildDir }}</span><span>{{ projectPath ? '配置仅属于当前工程' : '等待打开工程' }}</span></div>
      </aside>

      <section class="center-stage">
        <section class="workflow-panel" aria-labelledby="workflow-title">
          <div class="workflow-heading">
            <div><h2 id="workflow-title">工程工作流</h2><p>常用操作保持在同一条路径内，运行结果集中显示</p></div>
            <div class="flash-method-control">
              <span>烧录方式</span>
              <div class="flash-method-tabs" role="group" aria-label="选择烧录方式">
                <button v-for="method in (['UART', 'JTAG', 'DFU'] as const)" :key="method" :class="{ active: flashMethod === method }" :aria-pressed="flashMethod === method" :disabled="method === 'DFU' && !dfuTargetSupported" @click="chooseFlashMethod(method)">{{ method }}</button>
              </div>
              <small>{{ flashSummary }}</small>
            </div>
          </div>
          <div class="command-strip" aria-label="工程命令">
            <button class="command" title="构建工程（CMake + Ninja）" :disabled="!ready || taskRunning" @click="showWorkbench('task'); runTask('build')"><i class="codicon codicon-tools" /><span><strong>构建</strong><small>CMake + Ninja</small></span></button>
            <button class="command" title="彻底清除当前配置的构建目录" :disabled="!ready || taskRunning" @click="showWorkbench('task'); runTask('fullclean')"><i class="codicon codicon-clear-all" /><span><strong>清除构建</strong><small>删除 build 缓存</small></span></button>
            <button class="command danger-command" title="擦除所选端口上芯片的全部 Flash 数据" :disabled="!ready || taskRunning || !flashPort" @click="eraseFlash"><i class="codicon codicon-trash" /><span><strong>擦除 Flash</strong><small>{{ flashPort || '未选端口' }} · 清空芯片数据</small></span></button>
            <button class="command amber" :title="`烧录工程（${flashMethod} · ${flashSummary}）`" :disabled="!flashReady" @click="showWorkbench('task'); runTask('flash')"><i class="codicon codicon-zap" /><span><strong>烧录</strong><small>{{ flashMethod }} · {{ flashSummary }}</small></span></button>
            <button class="command" :title="`${isMonitoring(monitorPort) ? '停止' : '启动'}串口监视（${monitorPort || '未选端口'} · ${monitorBaud}）`" :disabled="!monitorPort" @click="showWorkbench('serial'); toggleMonitor()"><i class="codicon codicon-plug" /><span><strong>{{ isMonitoring(monitorPort) ? '停止监视' : '监视' }}</strong><small>{{ monitorPort || '未选端口' }} · {{ monitorBaud }}</small></span></button>
            <button class="command primary-command" :title="monitorPort ? '构建、烧录并启动串口监视' : '请先选择监视端口'" :disabled="!flashReady || !monitorPort" @click="showWorkbench('task'); runBuildFlashMonitor()"><i class="codicon codicon-play-circle" /><span><strong>构建 · 烧录 · 监视</strong><small>完整工作流</small></span></button>
            <button class="command" title="打开字符配置终端 menuconfig" :disabled="!ready || taskRunning" @click="openMenuconfig"><i class="codicon codicon-terminal" /><span><strong>menuconfig</strong><small>字符配置</small></span></button>
            <button class="command" title="打开图形 SDK 配置编辑器" :disabled="!ready || taskRunning" @click="openSdkEditor"><i class="codicon codicon-settings-gear" /><span><strong>SDK 配置</strong><small>图形配置</small></span></button>
          </div>
        </section>

        <div v-if="activeWorkspace === 'workbench'" :class="['console-panel', { 'has-monitor-sessions': activeLog === 'serial' && serialLogPorts.length > 0 }]">
          <div class="console-toolbar">
            <button v-if="taskRunning || taskStopping" class="task-stop-button" :disabled="taskStopping" @click="cancelTask"><i class="codicon codicon-debug-stop" />{{ taskStopping ? '正在停止…' : `停止当前任务${currentTask ? `：${currentTask}` : ''}` }}</button>
            <div class="tabs" role="tablist" aria-label="输出视图"><button role="tab" :aria-selected="activeLog === 'task'" :class="{ active: activeLog === 'task' }" @click="selectLog('task')">任务输出</button><button role="tab" :aria-selected="activeLog === 'serial'" :class="{ active: activeLog === 'serial' }" @click="selectLog('serial')">串口监视器 <span :class="['mini-dot', { online: monitorRunning }]" /></button></div>
            <div class="console-actions"><div v-if="activeLog === 'task'" class="log-legend" aria-label="日志颜色说明"><span class="error"><i />错误</span><span class="warning"><i />警告</span><span class="success"><i />成功</span></div><input v-if="activeLog === 'serial'" v-model="serialFilter" class="filter" placeholder="过滤关键字" /><label v-if="activeLog === 'serial'" class="tiny-check"><input v-model="timestamps" type="checkbox" />时间戳</label><button v-if="!autoFollowLog" class="follow-button" @click="resumeLogFollow">回到底部</button><button @click="clearCurrentLog">清空</button><button @click="saveCurrentLog">保存</button><button :class="isMonitoring(monitorPort) ? 'danger' : 'monitor-button'" :disabled="!monitorPort" @click="toggleMonitor">{{ isMonitoring(monitorPort) ? '停止监视' : '启动监视' }}</button></div>
          </div>
          <div v-if="activeLog === 'serial' && serialLogPorts.length" class="monitor-session-tabs" aria-label="串口监视日志">
            <div v-for="port in serialLogPorts" :key="port" :class="['monitor-session', { active: activeMonitorPort === port, stopped: !isMonitoring(port) }]">
              <button :title="`查看 ${port} 的监视输出`" @click="activeMonitorPort = port"><i class="codicon codicon-plug" />{{ port }}</button>
              <button v-if="isMonitoring(port)" class="monitor-session-close" :title="`停止 ${port} 的监视`" @click="stopMonitorPort(port)"><i class="codicon codicon-close" /></button>
              <span v-else class="monitor-session-state">已停止</span>
            </div>
          </div>
          <div class="terminal-frame"><pre ref="logElement" class="terminal" tabindex="0" :aria-label="activeLog === 'task' ? '任务输出日志' : '串口监视日志'" @scroll="handleLogScroll" @wheel.prevent.stop="handleLogWheel"><span v-for="(line, index) in visibleLogLines" :key="index" :class="['terminal-line', `log-${line.tone}`]">{{ line.text }}</span></pre></div>
          <div v-if="activeLog === 'serial'" class="serial-send"><select v-model="serialMode"><option value="text">文本</option><option value="hex">HEX</option></select><input v-model="serialInput" :placeholder="activeMonitorPort ? (serialMode === 'hex' ? `发送到 ${activeMonitorPort}，例如：48 65 6C 6C 6F` : `发送到 ${activeMonitorPort}`) : '请先启动串口监视'" @keyup.enter="sendSerial" /><button class="primary" :disabled="!activeMonitorPort || !isMonitoring(activeMonitorPort)" @click="sendSerial">发送</button></div>
        </div>
        <ComponentRegistry v-else :key="projectPath" :project-path="projectPath" :busy="taskRunning" :log="componentLog" :install-dependency="installRegistryComponent" :clear-log="clearComponentLog" />
      </section>

      <aside class="environment-inspector" aria-label="设备与环境">
        <div class="inspector-heading"><h2>设备与环境</h2><button @click="refreshIdf(); refreshPorts(); refreshJtagDevices(); refreshCapabilities()">刷新</button></div>
        <section class="inspect-group">
          <h3>Development</h3>
          <div class="field"><label for="idf-version">ESP-IDF 版本</label><select id="idf-version" v-model="selectedIdfPath"><option value="" disabled>选择 ESP-IDF</option><option v-for="setup in setups" :key="setup.id" :value="setup.idfPath">v{{ setup.version }}{{ setup.valid ? '' : '（不完整）' }}</option></select></div>
          <div class="field"><label>安装目录</label><div class="field-value path-value" :title="selectedIdfPath">{{ selectedIdfPath || '尚未选择' }}</div></div>
          <button class="inspector-action" @click="chooseIdf"><i class="codicon codicon-folder-opened" />选择其他安装目录</button>
        </section>
        <section class="inspect-group">
          <h3>Target device</h3>
          <div class="field"><label for="target-chip">目标芯片</label><div class="target-select-row"><select id="target-chip" v-model="target"><option v-for="item in targets" :key="item.target" :value="item.target">{{ item.target.toUpperCase() }}{{ item.preview ? '（预览）' : '' }}</option></select><button :disabled="!ready || taskRunning" title="应用目标芯片" aria-label="应用目标芯片" @click="runTask('set-target')"><i class="codicon codicon-check" /></button></div></div>
          <div class="field"><label>当前烧录方式</label><div class="field-value flash-method-summary"><strong>{{ flashMethod }}</strong><span>{{ flashSummary }}</span></div></div>
          <template v-if="flashMethod === 'UART'">
            <div class="field"><label for="flash-port">烧录端口</label><select id="flash-port" v-model="flashPort"><option value="">请选择</option><option v-for="item in ports" :key="item.path" :value="item.path">{{ item.path }} · {{ item.manufacturer || '未知设备' }}</option></select></div>
            <div class="field"><label for="flash-baud">烧录波特率</label><select id="flash-baud" v-model="flashBaud"><option :value="115200">115200</option><option :value="460800">460800</option><option :value="921600">921600</option></select></div>
          </template>
          <template v-else-if="flashMethod === 'JTAG'">
            <div class="field"><label for="jtag-port">绑定串口</label><div class="target-select-row"><select id="jtag-port" v-model="flashPort"><option value="">请选择这块开发板的 COM 口</option><option v-for="item in ports" :key="item.path" :value="item.path">{{ item.path }} · {{ item.manufacturer || '未知设备' }}</option></select><button title="刷新设备对应关系" aria-label="刷新设备对应关系" @click="refreshPorts(); refreshJtagDevices()"><i class="codicon codicon-refresh" /></button></div><small class="field-hint">仅用于识别对应开发板；JTAG 烧录本身不经过 COM 口</small></div>
            <div class="field"><label>已自动绑定的 USB-JTAG</label><div class="field-value flash-method-summary"><strong>{{ selectedJtagDevice?.label || '未找到与该 COM 口对应的 USB-JTAG' }}</strong><span>{{ selectedJtagDevice ? '可直接烧录，无需辨认硬件号' : '请确认开发板已连接并点击刷新' }}</span></div></div>
            <div class="field"><label for="openocd-config">OpenOCD 配置</label><input id="openocd-config" v-model="openOcdConfig" placeholder="board/esp32s3-builtin.cfg" /><small class="field-hint">{{ capabilities.openocd ? 'OpenOCD 已就绪，烧录前会先构建工程' : '当前环境缺少 OpenOCD' }}</small></div>
          </template>
          <div v-else class="method-notice" :class="{ bad: !dfuTargetSupported || !capabilities.dfuUtil }"><i class="codicon codicon-usb" /><span>{{ dfuTargetSupported ? (capabilities.dfuUtil ? 'USB DFU 已就绪' : '缺少 dfu-util') : '当前芯片不支持 DFU' }}</span></div>
          <div class="field"><label for="monitor-port">监视端口</label><select id="monitor-port" v-model="monitorPort"><option value="">请选择</option><option v-for="item in ports" :key="item.path" :value="item.path">{{ item.path }} · {{ item.manufacturer || '未知设备' }}</option></select></div>
          <div class="field"><label for="monitor-baud">监视波特率</label><select id="monitor-baud" v-model="monitorBaud"><option :value="9600">9600</option><option :value="115200">115200</option><option :value="921600">921600</option></select></div>
          <label class="check-row standalone-check"><input v-model="autoMonitor" type="checkbox" /><span>烧录成功后自动监视</span></label>
          <label class="check-row standalone-check"><input v-model="completionSound" type="checkbox" /><span>构建或烧录成功后播放提示音</span></label>
        </section>
        <section class="inspect-group">
          <h3>Environment check</h3>
          <div class="check-row"><i :class="['codicon', selectedSetup?.valid ? 'codicon-pass-filled' : 'codicon-error']" /><span>ESP-IDF / Python</span><small>{{ selectedSetup?.valid ? '可用' : '缺失' }}</small></div>
          <div class="check-row"><i :class="['codicon', ready ? 'codicon-pass-filled' : 'codicon-circle-outline']" /><span>当前工程</span><small>{{ ready ? '已载入' : '未就绪' }}</small></div>
          <div class="check-row"><i :class="['codicon', ports.length ? 'codicon-pass-filled' : 'codicon-warning']" /><span>串口设备</span><small>{{ ports.length }} 个</small></div>
          <div class="check-row"><i :class="['codicon', flashReady ? 'codicon-pass-filled' : 'codicon-warning']" /><span>烧录链路</span><small>{{ flashMethod }}</small></div>
        </section>
        <button class="inspector-action" :disabled="!selectedIdfPath" @click="runDoctor"><i class="codicon codicon-pulse" />运行完整环境诊断</button>
      </aside>
    </main>

    <footer class="statusbar"><div>ESP-IDF {{ selectedSetup ? `v${selectedSetup.version}` : '未选择' }}</div><div><span :class="{ good: ready }">{{ status }}</span> · {{ currentProjectName }}</div><div>{{ target.toUpperCase() }} · {{ flashMethod }} {{ flashMethod === 'UART' ? flashPort : '' }} · {{ flashMethod === 'UART' ? `${flashBaud} baud` : flashSummary }}</div></footer>

    <div v-if="advancedVisible" class="modal-backdrop" @click.self="advancedVisible = false"><div class="modal modal-wide advanced-modal" role="dialog" aria-modal="true" aria-label="高级工具" tabindex="-1">
      <div class="modal-head"><div><h2>高级工具</h2><p>检测到 {{ capabilityCount }}/6 类外部工具；缺少依赖的功能会给出明确提示</p></div><button aria-label="关闭" title="关闭" @click="advancedVisible = false"><i class="codicon codicon-close" /></button></div>
      <div class="capabilities"><span :class="{ ok: capabilities.git }">Git</span><span :class="{ ok: capabilities.openocd }">OpenOCD</span><span :class="{ ok: capabilities.dfuUtil }">DFU</span><span :class="{ ok: capabilities.qemuXtensa || capabilities.qemuRiscv }">QEMU</span><span :class="{ ok: capabilities.gdb }">GDB</span></div>
      <ExtensionFeatureCenter :ready-commands="readyExtensionCommands" @run="runExtensionCommand" />
      <div class="tool-sections legacy-tools">
        <section class="ported-editors"><h3>Espressif 专用编辑器</h3><div class="tool-grid"><button @click="openCsvTool('partition')">打开分区表编辑器 UI</button><button @click="openCsvTool('nvs')">打开 NVS 分区编辑器</button><button @click="openSdkEditor">SDK 配置编辑器</button></div></section>
        <section><h3>工程与配置</h3><div class="tool-grid"><button @click="openIdfTerminal">ESP-IDF 终端</button><button @click="runTask('reconfigure')">重新配置</button><button @click="runTask('save-defconfig')">保存默认配置</button><button @click="createComponent">创建组件</button><button @click="addSupportFiles('vscode')">添加 .vscode</button><button @click="addSupportFiles('devcontainer')">添加 .devcontainer</button></div></section>
        <section><h3>构建与分析</h3><div class="tool-grid"><button @click="runTask('app')">只构建 App</button><button @click="runTask('bootloader')">只构建 Bootloader</button><button @click="runTask('partition-table')">构建分区表</button><button @click="runTask('size')">基础大小分析</button><button @click="runTask('size-components')">按组件分析</button><button @click="runTask('size-files')">按文件分析</button><button @click="runDoctor">环境诊断中心</button><button @click="runTask('diag')">生成 IDF 诊断报告</button></div></section>
        <section><h3>调试与仿真</h3><div class="tool-grid"><button :disabled="!capabilities.openocd" @click="runTask('openocd')">启动 OpenOCD</button><button :disabled="!capabilities.gdb" @click="openGdb">GDB 调试终端</button><button :disabled="!(capabilities.qemuXtensa || capabilities.qemuRiscv)" @click="runTask('qemu')">启动 QEMU</button><button @click="installQemu">安装 QEMU</button></div></section>
        <section><h3>安装与管理</h3><div class="tool-grid"><button @click="openInstallManager">ESP-IDF 安装管理器</button><button @click="installAdf">安装 ESP-ADF</button></div></section>
        <section><h3>自定义任务</h3><div class="custom-create"><input v-model="customName" placeholder="任务名称" /><input v-model="customCommand" placeholder="命令，例如 idf.py docs" /><button @click="addCustomTask">添加</button></div><div class="custom-list"><div v-for="(item, index) in customTasks" :key="`${item.name}-${index}`"><button @click="runTask('custom', item.command)">{{ item.name }}</button><code>{{ item.command }}</code><button class="danger-mini" aria-label="删除任务" title="删除任务" @click="removeCustomTask(index)"><i class="codicon codicon-trash" /></button></div></div></section>
      </div>
    </div></div>

    <div v-if="customTaskVisible" class="modal-backdrop" @click.self="customTaskVisible = false"><div class="modal modal-wide custom-task-modal" role="dialog" aria-modal="true" aria-label="自定义任务" tabindex="-1">
      <div class="modal-head"><div><h2>自定义任务</h2><p>命令在当前工程和当前 ESP-IDF 环境中运行</p></div><button aria-label="关闭" title="关闭" @click="customTaskVisible = false"><i class="codicon codicon-close" /></button></div>
      <div class="custom-create"><input v-model="customName" placeholder="任务名称" /><input v-model="customCommand" placeholder="命令，例如 idf.py docs" /><button class="primary" @click="addCustomTask">添加任务</button></div>
      <div class="custom-list"><div v-for="(item, index) in customTasks" :key="`${item.name}-${index}`"><button @click="customTaskVisible = false; runTask('custom', item.command)">{{ item.name }}</button><code>{{ item.command }}</code><button class="danger-mini" aria-label="删除任务" title="删除任务" @click="removeCustomTask(index)"><i class="codicon codicon-trash" /></button></div><div v-if="!customTasks.length" class="kconfig-empty">还没有自定义任务</div></div>
    </div></div>

    <div v-if="doctorVisible" class="modal-backdrop" @click.self="doctorVisible = false"><div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="环境诊断中心" tabindex="-1"><div class="modal-head"><div><h2>环境诊断中心</h2><p>只报告缺失或可用状态，不自动修改系统</p></div><button aria-label="关闭" title="关闭" @click="doctorVisible = false"><i class="codicon codicon-close" /></button></div><div class="doctor-list"><div v-for="check in doctorChecks" :key="check.name" :class="{ ok: check.ok }"><strong><i :class="['codicon', check.ok ? 'codicon-pass-filled' : 'codicon-warning']" /> {{ check.name }}</strong><span>{{ check.detail }}</span></div></div></div></div>

    <div v-if="sdkVisible" class="modal-backdrop" @click.self="closeSdkEditor()"><div class="modal modal-kconfig" role="dialog" aria-modal="true" aria-label="SDK 配置编辑器" tabindex="-1">
      <div class="modal-head"><div><h2>SDK 配置编辑器</h2><p>开关与依赖项即时联动；只有点击“保存”才会写入 sdkconfig</p><p class="sdk-project-scope" :title="projectPath">当前工程：{{ projectPath }}</p></div><button aria-label="关闭" title="关闭" :disabled="sdkLoading || kconfigCommitting" @click="closeSdkEditor()"><i class="codicon codicon-close" /></button></div>
      <div class="sdk-toolbar">
        <div class="segmented sdk-mode"><button :disabled="sdkLoading || kconfigCommitting" :aria-pressed="sdkMode === 'graphical'" :class="{ active: sdkMode === 'graphical' }" @click="switchSdkMode('graphical')">图形配置</button><button :disabled="sdkLoading || kconfigCommitting" :aria-pressed="sdkMode === 'raw'" :class="{ active: sdkMode === 'raw' }" @click="switchSdkMode('raw')">原始键值</button></div>
        <div v-if="sdkMode === 'graphical'" class="sdk-layout-note">与 Espressif 扩展一致：左侧分类树，右侧完整配置页</div>
        <input v-else v-model="sdkFilter" class="sdk-search" aria-label="搜索 SDK 配置原始键值" placeholder="搜索 CONFIG_ 名称或值" />
      </div>
      <div v-if="sdkLoading" class="sdk-loading"><span class="sdk-spinner"></span><strong>正在启动 ESP-IDF 配置服务器…</strong><small>首次载入可能需要几秒钟</small></div>
      <KconfigEditor v-else-if="sdkMode === 'graphical' && kconfigState" :state="kconfigState" :baseline-values="kconfigOriginalValues" :loading="sdkLoading || kconfigCommitting" :change-count="kconfigChangeCount" @change="setKconfigValue" @reset="resetKconfigValue" @save="saveSdkEditor" @discard="discardKconfigChanges" @restore-defaults="resetKconfigToDefaults" />
      <div v-else-if="sdkMode === 'raw'" class="sdk-list"><div v-for="entry in filteredSdkEntries" :key="entry.key"><input v-model="entry.enabled" type="checkbox" :aria-label="`启用 ${entry.key}`" /><code>{{ entry.key }}</code><input v-model="entry.value" :disabled="!entry.enabled" :aria-label="`${entry.key} 的值`" /></div></div>
      <div v-else class="sdk-loading"><strong>当前工程的 SDK 配置会话不可用</strong><small>请关闭编辑器后重新打开</small></div>
      <div class="modal-footer"><span v-if="sdkMode === 'graphical'">{{ kconfigCommitting ? '正在处理…' : kconfigSyncing ? '正在计算依赖关系…' : kconfigChangeCount ? `有 ${kconfigChangeCount} 项待保存（尚未写入文件）` : '配置已同步' }}</span><span v-else>{{ sdkRawDirty ? '原始键值有未保存修改 · ' : '' }}显示 {{ filteredSdkEntries.length }} / {{ sdkEntries.length }} 项</span><button v-if="sdkMode === 'raw'" :disabled="sdkLoading || kconfigCommitting || !sdkRawDirty" @click="discardKconfigChanges">丢弃并重载</button><button :disabled="sdkLoading || kconfigCommitting" @click="closeSdkEditor()">关闭</button><button v-if="sdkMode === 'raw'" class="primary" :disabled="sdkLoading || kconfigCommitting || !sdkRawDirty" @click="saveSdkEditor">保存 sdkconfig</button></div>
    </div></div>

    <div v-if="createVisible" class="modal-backdrop" @click.self="createVisible = false"><div class="modal" role="dialog" aria-modal="true" aria-label="新建 ESP-IDF 工程" tabindex="-1"><div class="modal-head"><div><h2>新建 ESP-IDF 工程</h2><p>选择空白模板或官方示例</p></div><button aria-label="关闭" title="关闭" @click="createVisible = false"><i class="codicon codicon-close" /></button></div><label for="new-project-name">工程名称</label><input id="new-project-name" v-model="projectName" /><span class="form-label">工程类型</span><div class="segmented"><button :aria-pressed="projectKind === 'blank'" :class="{ active: projectKind === 'blank' }" @click="projectKind = 'blank'">最小空白工程</button><button :aria-pressed="projectKind === 'example'" :class="{ active: projectKind === 'example' }" @click="projectKind = 'example'">ESP-IDF 官方示例</button></div><template v-if="projectKind === 'example'"><label for="new-project-example">选择示例</label><select id="new-project-example" v-model="selectedExample"><option v-for="example in examples" :key="example.path" :value="example.path">{{ example.group }} / {{ example.name }}</option></select></template><div class="modal-footer"><button @click="createVisible = false">取消</button><button class="primary" @click="createProject">选择目录并创建</button></div></div></div>
    <div v-if="errorMessage" class="toast" role="alert"><span>{{ errorMessage }}</span><button aria-label="关闭错误提示" title="关闭" @click="errorMessage = ''"><i class="codicon codicon-close" aria-hidden="true" /></button></div>
    <div v-if="partitionVisible" class="modal-backdrop editor-backdrop"><div class="modal ported-editor-modal" :class="{ 'is-maximized': editorMaximized }" role="dialog" aria-modal="true" aria-label="ESP-IDF 分区表编辑器" tabindex="-1">
      <div class="modal-head"><div><h2>ESP-IDF 分区表编辑器</h2><p>{{ csvEditor.path }}</p></div><div class="editor-window-actions"><span>右下角可调整大小</span><button :aria-label="editorMaximized ? '还原窗口' : '最大化窗口'" :title="editorMaximized ? '还原窗口' : '最大化窗口'" @click="editorMaximized = !editorMaximized"><i :class="['codicon', editorMaximized ? 'codicon-chrome-restore' : 'codicon-chrome-maximize']" /></button><button aria-label="关闭" title="关闭" @click="partitionVisible = false"><i class="codicon codicon-close" /></button></div></div>
      <EspressifWebview bundle="partition_table-bundle.js" :initial-message="csvWebviewMessage" reload-on-request @message="handleCsvEditorMessage" />
    </div></div>
    <div v-if="nvsVisible" class="modal-backdrop editor-backdrop"><div class="modal ported-editor-modal" :class="{ 'is-maximized': editorMaximized }" role="dialog" aria-modal="true" aria-label="ESP-IDF NVS 分区编辑器" tabindex="-1">
      <div class="modal-head"><div><h2>ESP-IDF NVS 分区编辑器</h2><p>{{ csvEditor.path }}</p></div><div class="editor-window-actions"><span>右下角可调整大小</span><button :aria-label="editorMaximized ? '还原窗口' : '最大化窗口'" :title="editorMaximized ? '还原窗口' : '最大化窗口'" @click="editorMaximized = !editorMaximized"><i :class="['codicon', editorMaximized ? 'codicon-chrome-restore' : 'codicon-chrome-maximize']" /></button><button aria-label="关闭" title="关闭" @click="nvsVisible = false"><i class="codicon codicon-close" /></button></div></div>
      <EspressifWebview bundle="nvsPartitionTable-bundle.js" :initial-message="csvWebviewMessage" reload-on-request @message="handleCsvEditorMessage" />
    </div></div>
    <div v-if="sizeVisible" class="modal-backdrop editor-backdrop"><div class="modal ported-editor-modal" :class="{ 'is-maximized': editorMaximized }" role="dialog" aria-modal="true" aria-label="ESP-IDF 二进制大小分析" tabindex="-1">
      <div class="modal-head"><div><h2>ESP-IDF 二进制大小分析</h2><p>来源：当前工程 {{ buildDir }} 目录中的链接映射文件</p></div><div class="editor-window-actions"><span>右下角可调整大小</span><button :aria-label="editorMaximized ? '还原窗口' : '最大化窗口'" :title="editorMaximized ? '还原窗口' : '最大化窗口'" @click="editorMaximized = !editorMaximized"><i :class="['codicon', editorMaximized ? 'codicon-chrome-restore' : 'codicon-chrome-maximize']" /></button><button aria-label="关闭" title="关闭" @click="sizeVisible = false"><i class="codicon codicon-close" /></button></div></div>
      <EspressifWebview bundle="newSize-bundle.js" :initial-message="sizeWebviewMessage" @message="message => message.command === 'flash' && runTask('flash')" />
    </div></div>
  </div>
</template>
