<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface ExtensionCommand { command: string; title: string; category: string; }
interface TaskEntry { command: string; title: string; description: string; group: string; }
interface MainEntry { id: string; title: string; description: string; location: string; aliases: string[]; }

const props = defineProps<{ readyCommands: string[] }>();
const emit = defineEmits<{ run: [command: string] }>();
const commands = ref<ExtensionCommand[]>([]);
const commandLoadError = ref("");
const search = ref("");
const mode = ref<"tools" | "main" | "compat">("tools");
const showTechnicalIds = ref(false);
const ready = computed(() => new Set(props.readyCommands));

const advancedTools: TaskEntry[] = [
  { command: "esp.webview.open.partition-table", title: "分区表编辑器", description: "读取、编辑并保存当前工程的分区表 CSV", group: "工程与配置" },
  { command: "espIdf.webview.nvsPartitionEditor", title: "NVS 分区编辑器", description: "编辑 NVS CSV，并生成普通或加密分区文件", group: "工程与配置" },
  { command: "espIdf.createIdfTerminal", title: "ESP-IDF 终端", description: "在当前工程目录打开已激活环境的独立终端", group: "工程与配置" },
  { command: "espIdf.createNewComponent", title: "创建 ESP-IDF 组件", description: "在当前工程中创建一个新的组件目录", group: "工程与配置" },
  { command: "espIdf.idfReconfigureTask", title: "重新配置工程", description: "重新运行 CMake 配置并更新构建文件", group: "工程与配置" },
  { command: "espIdf.saveDefSdkconfig", title: "保存默认配置", description: "生成可复用的 sdkconfig.defaults", group: "工程与配置" },
  { command: "espIdf.customTask", title: "自定义任务", description: "保存并运行你自己的 ESP-IDF 命令", group: "工程与配置" },
  { command: "espIdf.buildApp", title: "仅构建应用程序", description: "不重建其他目标，只生成应用程序镜像", group: "高级构建与烧录" },
  { command: "espIdf.flashAppUart", title: "仅烧录应用程序", description: "通过 UART 更新应用程序分区", group: "高级构建与烧录" },
  { command: "espIdf.buildBootloader", title: "仅构建 Bootloader", description: "单独构建引导加载程序", group: "高级构建与烧录" },
  { command: "espIdf.flashBootloaderUart", title: "仅烧录 Bootloader", description: "通过 UART 更新 Bootloader", group: "高级构建与烧录" },
  { command: "espIdf.buildPartitionTable", title: "构建分区表", description: "单独生成分区表二进制文件", group: "高级构建与烧录" },
  { command: "espIdf.flashPartitionTableUart", title: "仅烧录分区表", description: "通过 UART 更新设备分区表", group: "高级构建与烧录" },
  { command: "espIdf.flashAndEncryptDevice", title: "加密烧录", description: "使用 ESP-IDF 的 encrypted-flash 流程", group: "高级构建与烧录" },
  { command: "espIdf.size", title: "二进制大小分析", description: "按内存区域、归档和文件查看固件占用", group: "分析与诊断" },
  { command: "espIdf.doctorCommand", title: "环境诊断中心", description: "检查工程、工具链、调试器和外部依赖", group: "分析与诊断" },
  { command: "esp.efuse.summary", title: "读取 eFuse 摘要", description: "通过当前端口读取芯片 eFuse 信息", group: "分析与诊断" },
  { command: "espIdf.openOCDCommand", title: "启动 OpenOCD", description: "使用当前开发板配置启动调试服务器", group: "调试与仿真" },
  { command: "espIdf.qemuCommand", title: "启动 QEMU", description: "使用已安装的 Espressif QEMU 运行当前工程", group: "调试与仿真" },
  { command: "espIdf.installManager", title: "ESP-IDF 安装管理器", description: "打开本机可用的 Espressif 安装管理工具", group: "组件与集成" },
  { command: "espIdf.getEspAdf", title: "安装 ESP-ADF", description: "下载并安装 Espressif Audio Development Framework", group: "组件与集成" },
  { command: "espIdf.createDevContainer", title: "添加 Dev Container", description: "为工程生成可选的容器开发配置", group: "组件与集成" },
  { command: "espIdf.createVsCodeFolder", title: "添加 VS Code 支持", description: "为需要 IDE 协作的工程生成可选配置", group: "组件与集成" }
];

const mainEntries: MainEntry[] = [
  { id: "open", title: "打开或导入工程", description: "原扩展的“选择工作区”和“导入工程”在独立软件中是同一个任务。", location: "主界面 · 当前工程", aliases: ["espIdf.pickAWorkspaceFolder", "espIdf.importProject"] },
  { id: "new", title: "新建工程", description: "两个创建命令已合并为一个新建工程入口。", location: "主界面 · 新建工程", aliases: ["espIdf.newProject.start", "espIdf.createNewProject"] },
  { id: "environment", title: "ESP-IDF 版本与目标芯片", description: "选择版本、目标芯片和配置保存位置都属于工程环境。", location: "主界面 · 开发环境/设备配置", aliases: ["espIdf.selectCurrentIdfVersion", "espIdf.setTarget", "espIdf.selectConfTarget"] },
  { id: "ports", title: "串口与监视端口", description: "检测和选择端口已合并在设备配置中。", location: "主界面 · 设备配置", aliases: ["espIdf.selectPort", "espIdf.selectMonitorPort", "espIdf.detectSerialPort"] },
  { id: "build", title: "构建、烧录与监视", description: "UART、JTAG、DFU 是同一烧录任务的方式选项，不再重复成多个菜单项。", location: "主界面 · 工程操作", aliases: ["espIdf.buildDevice", "espIdf.flashDevice", "espIdf.flashUart", "espIdf.flashDFU", "espIdf.jtag_flash", "espIdf.selectFlashMethodAndFlash", "espIdf.monitorDevice", "espIdf.buildFlashMonitor"] },
  { id: "registry", title: "ESP 组件注册表", description: "浏览官方组件、添加工程依赖，并从组件示例创建新工程。", location: "主界面 · 组件注册表", aliases: ["esp.component-manager.ui.show"] },
  { id: "config", title: "SDK 与工程配置", description: "图形配置、字符 menuconfig 和工程配置档均已有固定入口。", location: "主界面 · 工程操作/工程配置", aliases: ["espIdf.menuconfig.start", "espIdf.createClassicMenuconfig", "espIdf.projectConfigurationEditor", "espIdf.projectConf"] },
  { id: "maintenance", title: "擦除与完全清理", description: "属于主工作流中的维护操作，不再重复出现在高级列表。", location: "主界面 · 工程操作", aliases: ["espIdf.eraseFlash", "espIdf.fullClean"] }
];

const plannedCommands = new Set([
  "espIdf.addArduinoAsComponentToCurFolder", "espIdf.cmakeListsEditor.start", "espIdf.apptrace", "espIdf.heaptrace",
  "espIdf.flashBinaryToPartition", "espIdf.apptrace.archive.showReport", "espIdf.apptrace.customize", "espIdf.getCoverageReport",
  "espIdf.launchWSServerAndMonitor", "espIdf.selectOpenOcdConfigFiles", "espIdf.troubleshootPanel", "espIdf.ninja.summary",
  "espIdf.setGcovConfig", "espIdf.monitorQemu", "espIdf.qemuDebug",
  "espIdf.unitTest.buildFlashUnitTestApp", "espIdf.unitTest.buildUnitTestApp", "espIdf.unitTest.flashUnitTestApp",
  "espIdf.createSbom", "espIdf.openImageViewer", "espIdf.loadImageFromFile", "espIdf.setClangSettings"
]);
const mainAliases = new Set(mainEntries.flatMap((entry) => entry.aliases));

function compatState(command: string) {
  if (mainAliases.has(command)) return "主界面已有";
  if (advancedTools.some((tool) => tool.command === command)) return ready.value.has(command) ? "可用" : "当前环境不可用";
  if (plannedCommands.has(command) || command.startsWith("esp.rainmaker.")) return "计划模块";
  if (/errorHints|\.clear|\.refresh|disposeConfserver|removeCoverage|viewAsHex|viewVariableAsImage|hexView|AdapterStatusBar|selectNotificationMode/i.test(command)) return "VS Code / 内部";
  if (/openWalkthrough|welcome\.start|openDocUrl|searchInEspIdfDocs/i.test(command)) return "帮助入口";
  return "需宿主或待评估";
}

const normalizedSearch = computed(() => search.value.trim().toLowerCase());
const visibleTools = computed(() => advancedTools.filter((item) => !normalizedSearch.value || `${item.title} ${item.description} ${item.command} ${item.group}`.toLowerCase().includes(normalizedSearch.value)));
const visibleMain = computed(() => mainEntries.filter((item) => !normalizedSearch.value || `${item.title} ${item.description} ${item.location} ${item.aliases.join(" ")}`.toLowerCase().includes(normalizedSearch.value)));
const visibleCompat = computed(() => commands.value.filter((item) => !normalizedSearch.value || `${item.title} ${item.command} ${compatState(item.command)}`.toLowerCase().includes(normalizedSearch.value)));
const visibleCount = computed(() => mode.value === "tools" ? visibleTools.value.length : mode.value === "main" ? visibleMain.value.length : visibleCompat.value.length);

function changeMode(next: "tools" | "main" | "compat") { mode.value = next; search.value = ""; }
function isCommandManifest(value: unknown): value is { commands: ExtensionCommand[] } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { commands?: unknown }).commands)) return false;
  return (value as { commands: unknown[] }).commands.every((item) => Boolean(item) && typeof item === "object"
    && typeof (item as ExtensionCommand).command === "string"
    && typeof (item as ExtensionCommand).title === "string"
    && typeof (item as ExtensionCommand).category === "string");
}

async function loadCommandManifest() {
  const candidates = [new URL("./espressif/commands.zh-cn.json", window.location.href).href];
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    candidates.push(new URL("/espressif/commands.zh-cn.json", window.location.origin).href);
  }
  for (const url of [...new Set(candidates)]) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const manifest: unknown = await response.json();
      if (!isCommandManifest(manifest)) continue;
      commands.value = manifest.commands;
      commandLoadError.value = "";
      return;
    } catch {
      // Try the next location. Packaged file:// builds and nested preview pages use different bases.
    }
  }
  commandLoadError.value = "原扩展命令清单暂时无法载入；可用工具和主界面功能不受影响。";
}

onMounted(loadCommandManifest);
</script>

<template>
  <div class="extension-feature-center">
    <div class="tool-center-tabs" role="tablist" aria-label="高级工具视图">
      <button role="tab" :aria-selected="mode === 'tools'" :class="{ active: mode === 'tools' }" @click="changeMode('tools')">可用高级工具 <b>{{ advancedTools.length }}</b></button>
      <button role="tab" :aria-selected="mode === 'main'" :class="{ active: mode === 'main' }" @click="changeMode('main')">主界面已合并 <b>{{ mainEntries.length }}</b></button>
      <button role="tab" :aria-selected="mode === 'compat'" :class="{ active: mode === 'compat' }" @click="changeMode('compat')">原扩展兼容性清单 <b>{{ commands.length }}</b></button>
    </div>
    <div class="extension-command-search">
      <input v-model="search" :placeholder="mode === 'compat' ? '搜索原扩展命令、状态或技术标识' : '搜索用户任务或功能名称'" />
      <label v-if="mode === 'compat'"><input v-model="showTechnicalIds" type="checkbox" />显示技术标识</label>
      <b>{{ visibleCount }} 项</b>
    </div>
    <section v-if="mode === 'tools'" class="tool-task-list">
      <button v-for="item in visibleTools" :key="item.command" class="tool-task-row" :disabled="!ready.has(item.command)" @click="emit('run', item.command)">
        <span><small>{{ item.group }}</small><strong>{{ item.title }}</strong><p>{{ item.description }}</p><code v-if="showTechnicalIds">{{ item.command }}</code></span>
        <em :class="{ ready: ready.has(item.command) }">{{ ready.has(item.command) ? '可用' : '当前不可用' }}</em>
      </button>
      <div v-if="!visibleTools.length" class="kconfig-empty">没有匹配的高级工具</div>
    </section>
    <section v-else-if="mode === 'main'" class="tool-task-list">
      <div v-for="item in visibleMain" :key="item.id" class="tool-task-row is-main-entry">
        <span><small>{{ item.location }}</small><strong>{{ item.title }}</strong><p>{{ item.description }}</p><code v-if="showTechnicalIds">{{ item.aliases.join(' · ') }}</code></span>
        <em>已合并</em>
      </div>
      <div v-if="!visibleMain.length" class="kconfig-empty">没有匹配的主界面任务</div>
    </section>
    <section v-else class="extension-command-list compat-list">
      <div v-if="commandLoadError" class="compat-notice" role="status">{{ commandLoadError }}</div>
      <div class="compat-notice">这是开发者兼容性清单，不等于 98 个独立功能。只有“可用”项可以直接执行。</div>
      <button v-for="item in visibleCompat" :key="item.command" class="extension-command-row" :disabled="compatState(item.command) !== '可用'" @click="emit('run', item.command)">
        <span><strong>{{ item.title }}</strong><code v-if="showTechnicalIds">{{ item.command }}</code></span>
        <em :class="{ ready: compatState(item.command) === '可用' }">{{ compatState(item.command) }}</em>
      </button>
      <div v-if="!visibleCompat.length" class="kconfig-empty">没有匹配的兼容性记录</div>
    </section>
  </div>
</template>
