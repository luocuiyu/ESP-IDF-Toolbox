<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import KconfigSection from "./KconfigSection.vue";
import KconfigTreeNode from "./KconfigTreeNode.vue";

type KconfigValue = boolean | number | string;
interface KconfigNode { id: string; name?: string; title?: string; type: "menu" | "choice" | "bool" | "int" | "hex" | "string"; help?: string; children: KconfigNode[]; }
interface KconfigState { sessionId: string; menus: KconfigNode[]; values: Record<string, KconfigValue>; ranges: Record<string, [number, number]>; visible: Record<string, boolean>; }

const props = defineProps<{ state: KconfigState; baselineValues: Record<string, KconfigValue>; loading: boolean; changeCount: number }>();
const emit = defineEmits<{ change: [name: string, value: KconfigValue, immediate?: boolean, localValues?: Record<string, KconfigValue>]; reset: [name: string, value: KconfigValue, localValues?: Record<string, KconfigValue>]; save: []; discard: []; restoreDefaults: [] }>();
const query = ref("");
const selectedId = ref("");
const expanded = ref(new Set<string>());
const content = ref<HTMLElement | null>(null);
watch(() => props.state.menus, (menus) => {
  const state = props.state;
  const roots = menus.filter((node) => node.type === "menu" && node.title && state.visible[node.id] !== false);
  expanded.value = new Set(roots.slice(0, 1).map((node) => node.id));
  selectedId.value = roots[0]?.id || "";
}, { immediate: true });

function matches(node: KconfigNode, needle: string) {
  return `${node.title || ""} ${node.name || ""} ${node.help || ""}`.toLowerCase().includes(needle);
}
function filterNode(node: KconfigNode, needle: string): KconfigNode | null {
  if (props.state.visible[node.id] === false || !node.title) return null;
  const children = node.children.map((child) => filterNode(child, needle)).filter(Boolean) as KconfigNode[];
  if (node.type === "choice" && needle && (matches(node, needle) || children.length)) {
    return { ...node, children: node.children.filter((child) => props.state.visible[child.id] !== false && child.title) };
  }
  if (!needle || matches(node, needle) || children.length) return { ...node, children: needle && !matches(node, needle) ? children : node.children.filter((child) => props.state.visible[child.id] !== false && child.title) };
  return null;
}
const filteredMenus = computed(() => {
  let needle = query.value.trim().toLowerCase();
  if (needle.startsWith("config_")) needle = needle.slice(7);
  return props.state.menus.map((node) => filterNode(node, needle)).filter(Boolean) as KconfigNode[];
});
const treeMenus = computed(() => filteredMenus.value.filter((node) => node.type === "menu"));
const changedNames = computed(() => new Set(Object.keys(props.state.values).filter((name) => props.state.values[name] !== props.baselineValues[name])));

watch(query, (value) => {
  if (!value.trim()) return;
  const ids = new Set<string>();
  const visit = (nodes: KconfigNode[]) => nodes.forEach((node) => { if (node.type === "menu") ids.add(node.id); visit(node.children); });
  visit(treeMenus.value);
  expanded.value = ids;
});
function toggle(id: string) { const next = new Set(expanded.value); next.has(id) ? next.delete(id) : next.add(id); expanded.value = next; }
function select(node: KconfigNode) {
  selectedId.value = node.id;
  expanded.value = new Set(expanded.value).add(node.id);
  void nextTick(() => content.value?.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(node.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}
function syncTreeSelection() {
  const root = content.value;
  if (!root) return;
  const top = root.getBoundingClientRect().top + 18;
  let nearest: HTMLElement | null = null;
  for (const section of root.querySelectorAll<HTMLElement>("[data-section-id]")) if (section.getBoundingClientRect().top <= top) nearest = section;
  if (nearest?.dataset.sectionId) selectedId.value = nearest.dataset.sectionId;
}
function resetNode(node: KconfigNode) {
  if (node.type === "choice") {
    const localValues = Object.fromEntries(node.children.filter((child) => child.name && child.name in props.baselineValues).map((child) => [child.name!, props.baselineValues[child.name!]]));
    const selected = node.children.find((child) => child.name && props.baselineValues[child.name] === true)?.name;
    if (selected) emit("reset", selected, true, localValues);
  } else if (node.name && node.name in props.baselineValues) emit("reset", node.name, props.baselineValues[node.name]);
}
function reloadSavedConfig() { emit("discard"); }
function forwardChange(name: string, value: KconfigValue, immediate?: boolean, localValues?: Record<string, KconfigValue>) { emit("change", name, value, immediate, localValues); }
</script>

<template>
  <div class="kconfig-port" :class="{ 'is-loading': loading }" :aria-busy="loading" :data-session-id="state.sessionId">
    <div class="kconfig-port-toolbar">
      <div class="k-search-wrap"><span>⌕</span><input v-model="query" autofocus placeholder="搜索设置、CONFIG_ 名称或帮助内容" /><kbd>Ctrl F</kbd></div>
      <button :disabled="loading || !changeCount" @click="emit('save')">保存</button>
      <button :disabled="loading || !changeCount" title="放弃本次未保存修改，并重新载入当前项目已保存的 sdkconfig" @click="reloadSavedConfig">重新载入已保存配置</button>
      <button :disabled="loading" title="在预览中恢复 ESP-IDF/Kconfig 默认值；只有点击保存才会写入 sdkconfig" @click="emit('restoreDefaults')">重置为默认值</button>
    </div>
    <div class="kconfig-port-body">
      <aside class="kconfig-port-tree">
        <div class="k-tree-caption">配置分类</div>
        <KconfigTreeNode v-for="menu in treeMenus" :key="menu.id" :node="menu" :selected-id="selectedId" :expanded="expanded" @select="select" @toggle="toggle" />
        <div v-if="!treeMenus.length" class="k-tree-empty">没有匹配的分类</div>
      </aside>
      <main ref="content" class="kconfig-port-content" @scroll.passive="syncTreeSelection">
        <div v-if="query" class="k-search-summary">搜索“{{ query }}”的结果</div>
        <KconfigSection v-for="node in filteredMenus" :key="node.id" :node="node" :values="state.values" :ranges="state.ranges" :visible="state.visible" :changed="changedNames" @change="forwardChange" @reset="resetNode" />
        <div v-if="!filteredMenus.length" class="kconfig-empty">没有匹配的可见配置项</div>
      </main>
    </div>
  </div>
</template>
