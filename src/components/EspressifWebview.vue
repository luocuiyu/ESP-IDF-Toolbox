<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";

const props = defineProps<{ bundle: string; rootId?: string; initialMessage: Record<string, unknown>; reloadOnRequest?: boolean }>();
const emit = defineEmits<{ message: [message: Record<string, unknown>] }>();
const frame = ref<HTMLIFrameElement | null>(null);
const requestCommands = new Set(["initDataRequest", "getInitialData", "requestInitialValues", "requestInitValues", "getInitialValues", "webviewLoad", "loadCMakeListSchema", "requestImageData"]);
const initialResponseCommands = new Set(["loadInitialData", "initialLoad", "loadElements", "loadEmptyElements", "updateImage", "updateImageWithProperties"]);
const clonePayload = (message: Record<string, unknown>) => JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
const initialSnapshot = shallowRef(clonePayload(props.initialMessage));
let requestSeen = false;
let initialDelivered = false;

const html = computed(() => `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root {
  color-scheme: light;
  --vscode-font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif;
  --vscode-font-size: 14px;
  --vscode-font-weight: 400;
  --vscode-foreground: #27363a;
  --vscode-editor-foreground: #27363a;
  --vscode-settings-headerForeground: #17272c;
  --vscode-descriptionForeground: #4f6267;
  --vscode-disabledForeground: #758488;
  --vscode-editor-background: #fbfaf6;
  --vscode-editorWidget-background: #fbfaf6;
  --vscode-editorWidget-border: #bdc7c5;
  --vscode-sideBar-background: #efeee8;
  --vscode-sideBar-foreground: #27363a;
  --vscode-sideBar-dropBackground: #d8ece9;
  --vscode-input-background: #ffffff;
  --vscode-input-foreground: #17272c;
  --vscode-input-border: #aebbb8;
  --vscode-input-placeholderForeground: #627479;
  --vscode-inputOption-activeBorder: #087d79;
  --vscode-button-background: #087d79;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #075d5b;
  --vscode-button-secondaryBackground: #efeee8;
  --vscode-button-secondaryForeground: #27363a;
  --vscode-button-secondaryHoverBackground: #d8ece9;
  --vscode-dropdown-background: #ffffff;
  --vscode-dropdown-foreground: #17272c;
  --vscode-dropdown-border: #aebbb8;
  --vscode-settings-dropdownBorder: #aebbb8;
  --vscode-settings-dropdownBackground: #ffffff;
  --vscode-settings-dropdownForeground: #17272c;
  --vscode-settings-numberInputBackground: #ffffff;
  --vscode-settings-numberInputForeground: #17272c;
  --vscode-settings-numberInputBorder: #aebbb8;
  --vscode-settings-textInputBackground: #ffffff;
  --vscode-settings-textInputForeground: #17272c;
  --vscode-settings-textInputBorder: #aebbb8;
  --vscode-settings-rowHoverBackground: #edf5f3;
  --vscode-settings-modifiedItemIndicator: #087d79;
  --vscode-panel-border: #bdc7c5;
  --vscode-focusBorder: #087d79;
  --vscode-list-hoverBackground: #e5f1ef;
  --vscode-list-activeSelectionBackground: #d8ece9;
  --vscode-list-activeSelectionForeground: #075d5b;
  --vscode-list-inactiveSelectionBackground: #e9eeea;
  --vscode-list-inactiveSelectionForeground: #27363a;
  --vscode-tab-activeBackground: #fbfaf6;
  --vscode-tab-activeForeground: #17272c;
  --vscode-tab-inactiveBackground: #efeee8;
  --vscode-tab-inactiveForeground: #4f6267;
  --vscode-notifications-background: #fbfaf6;
  --vscode-notifications-foreground: #27363a;
  --vscode-notifications-border: #bdc7c5;
  --vscode-badge-background: #087d79;
  --vscode-badge-foreground: #ffffff;
  --vscode-checkbox-background: #ffffff;
  --vscode-checkbox-border: #8d9b98;
  --vscode-checkbox-foreground: #ffffff;
  --vscode-checkbox-hoverBackground: #edf5f3;
  --vscode-checkbox-selectBackground: #087d79;
  --vscode-checkbox-selectBorder: #075d5b;
  --vscode-settings-checkboxBackground: #ffffff;
  --vscode-settings-checkboxBorder: #8d9b98;
  --vscode-settings-checkboxForeground: #ffffff;
  --vscode-textLink-foreground: #075d5b;
  --vscode-textLink-activeForeground: #064b49;
  --vscode-icon-foreground: #4f6267;
  --vscode-toolbar-hoverBackground: #d8ece9;
  --vscode-scrollbarSlider-background: rgba(98, 116, 121, .34);
  --vscode-scrollbarSlider-hoverBackground: rgba(79, 98, 103, .48);
  --vscode-scrollbarSlider-activeBackground: rgba(79, 98, 103, .62);
  --vscode-errorForeground: #a1453e;
}

* { box-sizing: border-box; }
html, body, #${props.rootId || "app"} {
  width: 100%;
  height: 100%;
  margin: 0;
  color: #27363a;
  background: #fbfaf6;
  font-family: var(--vscode-font-family);
  font-size: 14px;
}

body { overflow: auto; }
button, input, select { font-size: 14px !important; }
input, select { color: #17272c; }
input::placeholder { color: #627479; opacity: 1; }
input[type="checkbox"] { accent-color: #087d79; }
a { color: #075d5b; }

*:focus-visible {
  outline-color: #087d79 !important;
  outline-offset: 1px;
}

::-webkit-scrollbar { width: 11px; height: 11px; }
::-webkit-scrollbar-track { background: #efeee8; }
::-webkit-scrollbar-thumb { border: 3px solid #efeee8; border-radius: 8px; background: #9caaa7; }
::-webkit-scrollbar-thumb:hover { background: #758784; }

.vscode-checkbox .icon {
  border-color: var(--vscode-settings-checkboxBorder, #8d9b98) !important;
  color: var(--vscode-settings-checkboxForeground, #fff) !important;
  background-color: var(--vscode-settings-checkboxBackground, #fff) !important;
}

.vscode-checkbox:has(input:checked) .icon,
.vscode-checkbox input:checked + .icon {
  border-color: #075d5b !important;
  color: #fff !important;
  background-color: #087d79 !important;
}

.container {
  width: 100% !important;
  max-width: none !important;
  padding: 24px !important;
  color: #27363a !important;
  background: #fbfaf6 !important;
}

.settings-header-title {
  align-items: flex-start !important;
  gap: 18px !important;
  flex-wrap: wrap !important;
}

.settings-title {
  flex: 1 1 300px !important;
  color: #17272c !important;
  white-space: nowrap !important;
}

.settings-header-actions { flex: 0 1 auto !important; flex-wrap: wrap !important; }
.settings-table-content { width: 100% !important; max-width: 100% !important; overflow: auto !important; }
.settings-table-content table { min-width: 820px !important; color: #27363a !important; border-color: #bdc7c5 !important; }
.settings-table-content th, .settings-table-content td { border-color: #d7d9d3 !important; color: #27363a !important; white-space: nowrap !important; }
.settings-table-content th { color: #17272c !important; background: #efeee8 !important; }
.settings-table-content tbody tr:hover { background: #edf5f3 !important; }

@media (max-width: 850px) {
  .container { padding: 16px !important; }
  .settings-header-title { display: grid !important; }
  .settings-title { white-space: normal !important; }
  .settings-header-actions { width: 100% !important; }
  .settings-header-actions .vscode-button { flex: 1 1 auto !important; justify-content: center !important; }
  .settings-table-content table { min-width: 720px !important; }
}
</style></head><body><div id="${props.rootId || "app"}"></div><script src="./espressif/webview-bridge.js"><\/script><script src="./espressif/${props.bundle}"><\/script></body></html>`);

function post(message: Record<string, unknown>) {
  try { frame.value?.contentWindow?.postMessage(clonePayload(message), "*"); }
  catch (error) { console.error("ESP-IDF Webview 消息发送失败", error); }
}
function sendInitial() { initialDelivered = true; post(initialSnapshot.value); }
function receive(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || !event.data?.__espIdfBridge) return;
  const message = event.data.message as Record<string, unknown>;
  const command = String(message.command || "");
  if (command !== "__webviewReady") emit("message", clonePayload(message));
  if (requestCommands.has(command)) {
    requestSeen = true;
    if (!props.reloadOnRequest) sendInitial();
  } else if (command === "__webviewReady" && !requestSeen && !initialDelivered) sendInitial();
}
watch(() => props.initialMessage, (message) => {
  const cloned = clonePayload(message);
  if (initialResponseCommands.has(String(cloned.command))) initialSnapshot.value = cloned;
  post(cloned);
}, { deep: true });
onMounted(() => window.addEventListener("message", receive));
onBeforeUnmount(() => window.removeEventListener("message", receive));
function handleLoad() { if (!requestSeen && !initialDelivered) sendInitial(); }
</script>

<template><iframe ref="frame" class="espressif-webview-frame" :srcdoc="html" title="Espressif ESP-IDF editor" @load="handleLoad" /></template>
