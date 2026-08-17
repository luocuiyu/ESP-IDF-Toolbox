<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import "@vscode/codicons/dist/codicon.css";

type InstallRequest = { dependency: string; component: string };
type RegistryActionResult = { status: "started" | "completed" | "cancelled" | "error"; message: string };

const props = defineProps<{
  projectPath: string;
  busy?: boolean;
  log: string;
  installDependency: (request: InstallRequest) => Promise<RegistryActionResult>;
  clearLog: () => void;
}>();

const registryUrl = "https://components.espressif.com";
const logElement = ref<HTMLElement | null>(null);
const manualDependency = ref("");
const manualComponent = ref("main");
const formMessage = ref("");
const formMessageKind = ref<"info" | "error">("info");
const actionBusy = ref(false);
const hasProject = computed(() => Boolean(props.projectPath.trim()));
const interactionsDisabled = computed(() => Boolean(props.busy || actionBusy.value));
let lastRequest = { signature: "", at: 0 };

function isSafeText(value: unknown, maximum: number): value is string {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return Boolean(text) && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text);
}

function isDependency(value: unknown): value is string {
  if (!isSafeText(value, 320)) return false;
  return /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?(?:[~^=<>!*,|0-9A-Za-z.+-]*)?$/.test(value.trim());
}

function isComponent(value: unknown): value is string {
  return isSafeText(value, 80) && /^[A-Za-z0-9_-]+$/.test(value.trim());
}

function normalizeInstallRequest(dependencyValue: unknown, componentValue: unknown) {
  if (typeof dependencyValue !== "string") return null;
  let dependency = dependencyValue.trim().replace(/^\$\s*/, "");
  let component = typeof componentValue === "string" && componentValue.trim() ? componentValue.trim() : "main";
  const command = dependency.match(/^(?:python(?:\.exe)?\s+-m\s+)?idf(?:\.py)?\s+add-dependency\s+(.+)$/i);
  if (command) {
    let remainder = command[1].trim();
    const componentOption = remainder.match(/(?:^|\s)--component(?:=|\s+)([A-Za-z0-9_-]+)(?=\s|$)/i);
    if (componentOption) {
      component = componentOption[1];
      remainder = remainder.replace(componentOption[0], " ").trim();
    }
    const quoted = remainder.match(/^(["'])(.+)\1$/);
    dependency = (quoted?.[2] || remainder).trim();
  }
  return { dependency, component, fromCommand: Boolean(command) };
}

function setFormMessage(message: string, kind: "info" | "error" = "info") {
  formMessage.value = message;
  formMessageKind.value = kind;
}

function isDuplicate(signature: string) {
  const now = Date.now();
  if (lastRequest.signature === signature && now - lastRequest.at < 800) return true;
  lastRequest = { signature, at: now };
  return false;
}

async function requestInstall(dependencyValue: unknown, componentValue: unknown = "main") {
  if (!hasProject.value) return setFormMessage("请先打开一个 ESP-IDF 工程，再安装组件。", "error");
  if (interactionsDisabled.value) return setFormMessage("当前有任务正在运行，请等待任务结束后再安装组件。", "error");
  const normalized = normalizeInstallRequest(dependencyValue, componentValue);
  if (!normalized || !isDependency(normalized.dependency)) return setFormMessage("格式不正确。可填写 vgerwen/组件名^版本，也可以直接粘贴完整的 idf.py add-dependency 命令。", "error");
  if (!isComponent(normalized.component)) return setFormMessage("目标组件名称只能包含字母、数字、下划线和短横线。", "error");
  const request = { dependency: normalized.dependency, component: normalized.component };
  if (isDuplicate(`install:${request.component}:${request.dependency}`)) return setFormMessage("添加请求已经提交，请稍候查看任务输出。", "info");
  if (normalized.fromCommand) {
    manualDependency.value = request.dependency;
    manualComponent.value = request.component;
  }
  setFormMessage(`正在提交 ${request.dependency}，请稍候…`, "info");
  actionBusy.value = true;
  try {
    const result = await props.installDependency(request);
    setFormMessage(result.message, result.status === "error" ? "error" : "info");
  } catch (error) {
    setFormMessage(error instanceof Error ? error.message : String(error), "error");
  } finally {
    actionBusy.value = false;
  }
}

async function openExternal() {
  try {
    await window.idfApi.openExternal(registryUrl);
  } catch {
    setFormMessage("无法打开系统浏览器，请检查系统默认浏览器设置。", "error");
  }
}

watch(hasProject, (opened) => {
  formMessage.value = opened ? "" : "请先打开工程；官网仍会在系统浏览器中打开。";
});

watch(() => props.log, () => {
  void nextTick(() => {
    if (logElement.value) logElement.value.scrollTop = logElement.value.scrollHeight;
  });
});

onMounted(() => {
  void openExternal();
});
</script>

<template>
  <section class="component-registry" aria-labelledby="component-registry-title">
    <header class="registry-header">
      <div class="registry-heading">
        <span class="heading-icon codicon codicon-package" aria-hidden="true"></span>
        <div>
          <p class="eyebrow">COMPONENT MANAGER</p>
          <h2 id="component-registry-title">ESP 组件注册表</h2>
          <p>官网在系统浏览器中打开，添加依赖的过程集中显示在此页面。</p>
        </div>
      </div>
      <div class="header-actions">
        <button type="button" class="button secondary" :disabled="!log" @click="clearLog">
          <span class="codicon codicon-clear-all" aria-hidden="true"></span>
          清空日志
        </button>
        <button type="button" class="button secondary" @click="openExternal">
          <span class="codicon codicon-link-external" aria-hidden="true"></span>
          再次打开官网
        </button>
      </div>
    </header>

    <div :class="['project-context', { missing: !hasProject }]">
      <span :class="['codicon', hasProject ? 'codicon-folder-active' : 'codicon-warning']" aria-hidden="true"></span>
      <div>
        <strong>{{ hasProject ? '当前工程' : '尚未打开工程' }}</strong>
        <code v-if="hasProject" :title="projectPath">{{ projectPath }}</code>
        <span v-else>打开工程后，才能把注册表组件添加到项目中。</span>
      </div>
      <p v-if="hasProject">
        安装操作会修改当前工程目标组件的 <code>idf_component.yml</code>，并在重新配置时下载依赖。
      </p>
    </div>

    <div class="registry-body">
      <div class="browser-panel">
        <div class="browser-toolbar">
          <div class="browser-address">
            <span class="codicon codicon-output" aria-hidden="true"></span>
            <span>添加依赖日志</span>
          </div>
          <span v-if="busy" class="connection-state online"><span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span>任务执行中</span>
          <span v-else class="connection-state"><span class="codicon codicon-circle-outline" aria-hidden="true"></span>等待添加</span>
        </div>

        <div class="dependency-log-stage">
          <pre ref="logElement" class="dependency-log" tabindex="0">{{ log || '等待添加组件依赖…\n\n打开此页面时，官方组件注册表会自动在系统浏览器中打开。\n从官网复制依赖名称或完整的 idf.py add-dependency 命令，粘贴到右侧即可。' }}</pre>
        </div>
      </div>

      <aside class="manual-panel" aria-labelledby="manual-install-title">
        <div class="manual-heading">
          <span class="codicon codicon-terminal" aria-hidden="true"></span>
          <div><h3 id="manual-install-title">手动添加依赖</h3><p>网页按钮不可用时的安装兜底。</p></div>
        </div>

        <form @submit.prevent="requestInstall(manualDependency, manualComponent)">
          <label for="registry-dependency">依赖规范</label>
          <input
            id="registry-dependency"
            v-model.trim="manualDependency"
            autocomplete="off"
            spellcheck="false"
            placeholder="espressif/led_strip^3.0.0"
          />
          <small>支持组件名称、命名空间和版本约束。</small>
          <small>也可以直接粘贴完整的 <code>idf.py add-dependency "组件依赖"</code> 命令。</small>

          <label for="registry-component">添加到工程组件</label>
          <input
            id="registry-component"
            v-model.trim="manualComponent"
            autocomplete="off"
            spellcheck="false"
            placeholder="main"
          />
          <small>通常保持为 <code>main</code>；需要时可填写本地组件名称。</small>

          <button type="submit" class="button primary" :disabled="!hasProject || !manualDependency.trim() || interactionsDisabled">
            <span :class="['codicon', actionBusy ? 'codicon-loading codicon-modifier-spin' : 'codicon-cloud-download']" aria-hidden="true"></span>
            {{ interactionsDisabled ? '任务执行中' : '添加并重新配置' }}
          </button>
        </form>

        <p v-if="formMessage" :class="['form-message', formMessageKind]" :role="formMessageKind === 'error' ? 'alert' : 'status'" aria-live="polite">
          <span :class="['codicon', formMessageKind === 'error' ? 'codicon-error' : actionBusy ? 'codicon-loading codicon-modifier-spin' : 'codicon-info']" aria-hidden="true"></span>
          {{ formMessage }}
        </p>

        <div class="change-note">
          <span class="codicon codicon-info" aria-hidden="true"></span>
          <p>组件由当前工程选定的 ESP-IDF Python 环境下载。执行命令、下载进度和错误会显示在左侧日志中。</p>
        </div>

      </aside>
    </div>
  </section>
</template>

<style scoped>
.component-registry {
  --registry-canvas: #f5f4ee;
  --registry-surface: #fbfaf6;
  --registry-subtle: #efeee8;
  --registry-active: #e5f1ef;
  --registry-ink: #27363a;
  --registry-ink-strong: #17272c;
  --registry-muted: #4f6267;
  --registry-rule: #d7d9d3;
  --registry-rule-strong: #bdc7c5;
  --registry-teal: #087d79;
  --registry-teal-dark: #075d5b;
  --registry-teal-soft: #d8ece9;
  --registry-amber: #9a5b13;
  --registry-amber-soft: #f6ead7;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-height: 0;
  container-name: component-registry;
  container-type: inline-size;
  overflow: hidden;
  border: 1px solid var(--registry-rule-strong);
  border-radius: 7px;
  background: var(--registry-canvas);
  color: var(--registry-ink);
  font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif;
}

.registry-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 88px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--registry-rule);
  background: var(--registry-surface);
}

.registry-heading,
.manual-heading,
.header-actions,
.button,
.connection-state,
.project-context {
  display: flex;
  align-items: center;
}

.registry-heading { gap: 13px; min-width: 0; }
.heading-icon { color: var(--registry-teal); font-size: 27px; }
.eyebrow { margin: 0 0 3px; color: var(--registry-teal-dark); font-size: 10px; font-weight: 750; letter-spacing: 1.4px; }
.registry-heading h2 { margin: 0; color: var(--registry-ink-strong); font-size: 22px; line-height: 1.2; }
.registry-heading p:last-child { margin: 4px 0 0; color: var(--registry-muted); font-size: 13px; }
.header-actions { flex: 0 0 auto; gap: 8px; }

.button {
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--registry-rule-strong);
  border-radius: 4px;
  background: var(--registry-surface);
  color: var(--registry-ink-strong);
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.button:hover:not(:disabled) { border-color: var(--registry-teal); color: var(--registry-teal-dark); background: var(--registry-active); }
.button:focus-visible { outline: 2px solid var(--registry-teal); outline-offset: 2px; }
.button:disabled { cursor: not-allowed; opacity: .48; }
.button.primary { border-color: var(--registry-teal); background: var(--registry-teal); color: #fff; }
.button.primary:hover:not(:disabled) { border-color: var(--registry-teal-dark); background: var(--registry-teal-dark); color: #fff; }

.project-context {
  gap: 10px;
  min-height: 58px;
  padding: 9px 20px;
  border-bottom: 1px solid #c4d9d6;
  background: var(--registry-teal-soft);
  color: var(--registry-teal-dark);
}

.project-context > .codicon { flex: 0 0 auto; font-size: 18px; }
.project-context > div { display: grid; min-width: 0; gap: 2px; }
.project-context strong { font-size: 12px; }
.project-context code { overflow: hidden; color: var(--registry-ink-strong); font: 12px/1.45 Consolas, "Cascadia Mono", monospace; text-overflow: ellipsis; white-space: nowrap; }
.project-context > div > span { color: var(--registry-ink); font-size: 12px; }
.project-context > p { margin: 0 0 0 auto; color: var(--registry-muted); font-size: 12px; text-align: right; }
.project-context > p code { color: var(--registry-teal-dark); font-weight: 700; }
.project-context.missing { border-bottom-color: #e5cda7; background: var(--registry-amber-soft); color: var(--registry-amber); }

.registry-body { display: grid; grid-template-columns: minmax(0, 1fr) 292px; min-height: 0; }
.browser-panel { display: grid; grid-template-rows: 42px minmax(0, 1fr); min-width: 0; min-height: 0; border-right: 1px solid var(--registry-rule); background: #fff; }
.browser-toolbar { display: flex; align-items: center; gap: 12px; padding: 0 12px; border-bottom: 1px solid var(--registry-rule); background: var(--registry-subtle); }
.browser-address { display: flex; align-items: center; gap: 7px; min-width: 0; color: var(--registry-muted); font: 12px/1 Consolas, "Cascadia Mono", monospace; }
.browser-address .codicon { color: var(--registry-teal-dark); }
.browser-address span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connection-state { flex: 0 0 auto; gap: 5px; margin-left: auto; color: var(--registry-muted); font-size: 11px; font-weight: 650; }
.connection-state.online { color: var(--registry-teal-dark); }
.dependency-log-stage { min-height: 0; padding: 12px; overflow: hidden; background: #17282c; }
.dependency-log {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 15px;
  overflow: auto;
  border: 1px solid #355156;
  border-radius: 4px;
  outline: 0;
  background: #122226;
  color: #d8e8e7;
  font: 12px/1.65 Consolas, "Cascadia Mono", monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.dependency-log:focus { border-color: #4ca9a4; }

.manual-panel { min-width: 0; overflow: auto; padding: 18px; background: var(--registry-surface); }
.manual-heading { align-items: flex-start; gap: 10px; padding-bottom: 15px; border-bottom: 1px solid var(--registry-rule); }
.manual-heading > .codicon { margin-top: 2px; color: var(--registry-teal); font-size: 18px; }
.manual-heading h3 { margin: 0; color: var(--registry-ink-strong); font-size: 15px; }
.manual-heading p { margin: 4px 0 0; color: var(--registry-muted); font-size: 12px; }
.manual-panel form { display: grid; gap: 8px; margin-top: 17px; }
.manual-panel label { margin-top: 5px; color: var(--registry-ink-strong); font-size: 12px; font-weight: 700; }
.manual-panel input {
  width: 100%;
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--registry-rule-strong);
  border-radius: 4px;
  outline: 0;
  background: #fff;
  color: var(--registry-ink-strong);
  font: 13px Consolas, "Cascadia Mono", monospace;
}
.manual-panel input:focus { border-color: var(--registry-teal); box-shadow: 0 0 0 2px rgba(8, 125, 121, .13); }
.manual-panel input::placeholder { color: #596c70; }
.manual-panel small { margin: -2px 0 5px; color: var(--registry-muted); font-size: 11px; line-height: 1.5; }
.manual-panel small code { color: var(--registry-teal-dark); }
.manual-panel form .button { width: 100%; margin-top: 7px; }

.change-note,
.form-message { display: flex; align-items: flex-start; gap: 8px; padding: 11px; border: 1px solid var(--registry-rule); border-radius: 4px; }
.change-note { margin-top: 18px; background: var(--registry-subtle); }
.change-note .codicon { margin-top: 2px; color: var(--registry-teal); }
.change-note p { margin: 0; color: var(--registry-muted); font-size: 11px; line-height: 1.55; }
.form-message { margin: 10px 0 0; color: var(--registry-muted); background: var(--registry-active); font-size: 11px; line-height: 1.55; }
.form-message.error { border-color: #dfc08f; background: var(--registry-amber-soft); color: #74430d; }
.form-message .codicon { margin-top: 2px; }

@container component-registry (max-width: 720px) {
  .registry-body { grid-template-columns: 1fr; grid-template-rows: minmax(420px, 60vh) auto; overflow: auto; }
  .browser-panel { border-right: 0; border-bottom: 1px solid var(--registry-rule); }
  .manual-panel { overflow: visible; }
  .project-context { align-items: flex-start; flex-wrap: wrap; }
  .project-context > p { width: 100%; margin-left: 28px; text-align: left; }
}

@container component-registry (max-width: 520px) {
  .registry-header { align-items: flex-start; flex-direction: column; gap: 13px; }
  .header-actions { width: 100%; }
  .header-actions .button { flex: 1; }
  .registry-heading h2 { font-size: 19px; }
  .registry-heading p:last-child { line-height: 1.5; }
  .project-context { padding-inline: 14px; }
}
</style>
